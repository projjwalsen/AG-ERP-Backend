import "dotenv/config";
import { spawnSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { BranchAccessType, EntryType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";
import { ImportResolver } from "../modules/import/import.resolver";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const PDF_PATH = "C:\\Program Files\\TallyPrime (1)\\indirectexpenses.pdf";
const apply = process.argv.includes("--apply");
const n = (value: unknown) => String(value ?? "").replace(/^Narration:\s*/i, "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const compact = (value: unknown) => n(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();
const money = (value: unknown) => {
    if (value == null || value === "") return 0;
    if (typeof value === "number") return Number(value.toFixed(2));
    const parsed = Number(String(value).replace(/,/g, "").replace(/Dr|Cr/gi, "").trim());
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};
const accountAlias = (value: unknown) => {
    const key = compact(value);
    if (["ROFF", "ROUNDOFF", "ROUNDOFFACCOUNT", "AMOUNTROFF"].includes(key)) return "ROUNDOFF";
    if (["CARRIAGEOUTWARDURD", "CARRIAGEOUTWARDSURD"].includes(key)) return "CARRIAGEOUTWARDURD";
    if (["CARRIAGEOUTWARDSRD", "CARRIAGEOUTWARDRD"].includes(key)) return "CARRIAGEOUTWARDRD";
    return key;
};
const fingerprintOf = (row: { voucherNo: string; account: string; debit: number; credit: number }) =>
    [compact(row.voucherNo), accountAlias(row.account), Math.abs(row.debit - row.credit).toFixed(2)].join("|");

function extractPdfText(): string {
    const py = `
from pypdf import PdfReader
reader = PdfReader(r"${PDF_PATH.replace(/\\/g, "\\\\")}")
print("\\n".join((page.extract_text() or "") for page in reader.pages))
`;
    const tmp = "src/scripts/_extract_ie_pdf.py";
    writeFileSync(tmp, py);
    const result = spawnSync("python", [tmp], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    try { unlinkSync(tmp); } catch {}
    if (result.status !== 0) throw new Error(result.stderr || "PDF extract failed");
    return result.stdout;
}

function parseAmount(text: string) {
    const match = text.match(/(\d{1,3}(?:,\d{2})+,\d{3}\.\d{2}|\d{1,3},\d{3}\.\d{2}|\d+\.\d{2})/);
    return match ? money(match[1]) : 0;
}

const SKIP_ACCOUNTS = new Set([
    "CASHPAYMENT", "PAYMENT", "JOURNAL", "JOURNALEXPENSES", "TAXINVOICE",
    "RCMPURCHASE", "INWARDDEBITNOTE", "INDIRECTEXPENSES", "INDIRECTEXPENSE", "EXPENSES"
]);

function parsePdfRows(text: string, knownAccounts: string[], groupNames: Set<string>) {
    const accounts = [...knownAccounts]
        .filter(name => !SKIP_ACCOUNTS.has(compact(name)))
        .sort((a, b) => compact(b).length - compact(a).length);
    const chunks = text.split(/(?=^\d+\s+\d{1,2}-\d{1,2}-\d{4})/m);
    const rows: any[] = [];
    for (const chunk of chunks) {
        const head = chunk.match(/^(\d+)\s+(\d{1,2}-\d{1,2}-\d{4})([\s\S]*?)\bIndirect\s+Expenses\b/i);
        if (!head) continue;
        const serial = head[1];
        const dateText = head[2];
        const date = ExcelImportService.toDate(dateText);
        const voucherNo = n(head[3]).replace(/\s+/g, "");
        const rest = chunk.slice(head[0].length);
        if (!date || !voucherNo) continue;
        const beingAt = rest.search(/\bBEING\b/i);
        const beforeBeing = beingAt >= 0 ? rest.slice(0, beingAt) : rest;
        const amountMatch = beforeBeing.match(/(\d{1,3}(?:,\d{2})+,\d{3}\.\d{2}|\d{1,3},\d{3}\.\d{2}|\d+\.\d{2})\s*$/);
        const amount = amountMatch ? money(amountMatch[1]) : parseAmount(beforeBeing);
        if (amount <= 0) continue;
        const label = compact(beforeBeing.slice(0, amountMatch ? beforeBeing.lastIndexOf(amountMatch[1]) : beforeBeing.length));
        const hits = accounts.filter(name => {
            const key = compact(name);
            return key.length >= 4 && label.includes(key);
        });
        const suffixHits = hits.filter(name => label.endsWith(compact(name)));
        const leaves = (suffixHits.length ? suffixHits : hits).filter(name => !groupNames.has(compact(name)));
        const account = leaves[0] || suffixHits[0] || hits[0] || (label.includes("PROFESSIONALFEE") ? "PROFESSIONAL FEES" : "");
        if (!account) continue;
        const typeMatch = rest.match(/\b(Journal Expenses|CASH PAYMENT|RCM Purchase|Inward Debit Note|Tax Invoice|Journal|Payment)\b/i);
        const voucherType = typeMatch ? n(typeMatch[1]) : "JOURNAL";
        const narration = beingAt >= 0 ? n(rest.slice(beingAt).split(/\n\d+\s+\d{1,2}-\d{1,2}-\d{4}/)[0]) : "";
        rows.push({
            excelRow: rows.length + 1,
            serial,
            date,
            dateKey: dateText,
            voucherNo,
            voucherType,
            journalGroup: "Indirect Expenses",
            account,
            debit: amount,
            credit: 0,
            narration,
            fingerprint: fingerprintOf({ voucherNo, account, debit: amount, credit: 0 })
        });
    }
    return rows;
}

async function main() {
    const groups = await prisma.ledgerGroup.findMany({ select: { id: true, name: true, parentId: true } });
    const roots = groups.filter(g => ["indirect expense", "indirect expenses"].includes(n(g.name).toLowerCase()));
    const ids = new Set(roots.map(g => g.id));
    let growing = true;
    while (growing) {
        growing = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); growing = true; }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true }
    });
    const ledgerName = new Map(ledgers.map(l => [l.id, l.name]));
    const knownAccounts = [...new Set(ledgers.map(l => l.name).filter(Boolean))];
    const extraNames = [
        "PROFESSIONAL FEES", "Carriage Outward-URD", "Carriage Outwards RD", "R/OFF",
        "OFFICE RENT 2401,2402,2403", "Salary & Wages", "O/D INTEREST"
    ];
    for (const name of extraNames) if (!knownAccounts.some(a => compact(a) === compact(name))) knownAccounts.push(name);
    const groupNames = new Set(
        groups.filter(g => ids.has(g.id)).map(g => compact(g.name)).filter(key => !SKIP_ACCOUNTS.has(key))
    );

    console.log(JSON.stringify({ extracting: true, knownAccounts: knownAccounts.length }));
    const text = extractPdfText();
    const pdfRows = parsePdfRows(text, knownAccounts, groupNames);
    const pdfNet = Number(pdfRows.reduce((s, r) => s + r.debit - r.credit, 0).toFixed(2));
    const pfPdf = pdfRows.filter(r => compact(r.account).includes("PROFESSIONALFEE"));
    const pfPdfNet = Number(pfPdf.reduce((s, r) => s + r.debit - r.credit, 0).toFixed(2));

    const entries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ledgers.map(l => l.id) } },
        select: { id: true, ledgerId: true, entryType: true, amount: true, voucher: { select: { id: true, voucherNo: true } } }
    });
    const dbRows = entries.map(e => {
        const debit = e.entryType === EntryType.DEBIT ? Number(e.amount) : 0;
        const credit = e.entryType === EntryType.CREDIT ? Number(e.amount) : 0;
        const account = ledgerName.get(e.ledgerId) || "";
        return {
            entryId: e.id,
            voucherId: e.voucher.id,
            fingerprint: fingerprintOf({ voucherNo: e.voucher.voucherNo, account, debit, credit }),
            voucherNo: n(e.voucher.voucherNo),
            account,
            debit,
            credit
        };
    });
    const dbByFp = new Map<string, typeof dbRows>();
    const dbByVoucherAmount = new Map<string, typeof dbRows>();
    for (const row of dbRows) {
        const list = dbByFp.get(row.fingerprint) || [];
        list.push(row);
        dbByFp.set(row.fingerprint, list);
        const alt = `${compact(row.voucherNo)}|${Math.abs(row.debit - row.credit).toFixed(2)}`;
        const altList = dbByVoucherAmount.get(alt) || [];
        altList.push(row);
        dbByVoucherAmount.set(alt, altList);
    }
    const used = new Set<string>();
    const missing: typeof pdfRows = [];
    const accountMismatch: any[] = [];
    for (const row of pdfRows) {
        const exact = (dbByFp.get(row.fingerprint) || []).filter(item => !used.has(item.entryId));
        if (exact[0]) {
            used.add(exact[0].entryId);
            continue;
        }
        const altKey = `${compact(row.voucherNo)}|${Math.abs(row.debit - row.credit).toFixed(2)}`;
        const alt = (dbByVoucherAmount.get(altKey) || []).filter(item => !used.has(item.entryId));
        if (alt[0]) {
            used.add(alt[0].entryId);
            accountMismatch.push({ voucherNo: row.voucherNo, pdfAccount: row.account, dbAccount: alt[0].account, amount: row.debit });
            continue;
        }
        missing.push(row);
    }

    const skippedPrepaid = missing.filter(r => compact(r.account).includes("PREPAID"));
    const toCreate = missing.filter(r => !compact(r.account).includes("PREPAID"));
    const missingPf = toCreate.filter(r => compact(r.account).includes("PROFESSIONALFEE"));
    const missingByAccount = Object.fromEntries(
        [...missing.reduce((map, row) => {
            const cur = map.get(row.account) || { count: 0, net: 0 };
            cur.count += 1;
            cur.net = Number((cur.net + row.debit - row.credit).toFixed(2));
            map.set(row.account, cur);
            return map;
        }, new Map<string, { count: number; net: number }>()).entries()]
            .sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))
            .slice(0, 20)
    );
    console.log(JSON.stringify({
        dryRun: !apply,
        pdfRows: pdfRows.length,
        pdfNet,
        pfPdfCount: pfPdf.length,
        pfPdfNet,
        dbRows: dbRows.length,
        accountMismatch: accountMismatch.length,
        accountMismatchRows: accountMismatch,
        missing: missing.length,
        missingNet: Number(missing.reduce((s, r) => s + r.debit - r.credit, 0).toFixed(2)),
        skippedPrepaid: skippedPrepaid.length,
        toCreate: toCreate.length,
        toCreateNet: Number(toCreate.reduce((s, r) => s + r.debit - r.credit, 0).toFixed(2)),
        missingPfCount: missingPf.length,
        missingPfNet: Number(missingPf.reduce((s, r) => s + r.debit - r.credit, 0).toFixed(2)),
        missingByAccount,
        missingPf: missingPf.map(r => ({ voucherNo: r.voucherNo, date: r.dateKey, amount: r.debit, type: r.voucherType })),
        missingSample: missing.slice(0, 20).map(r => ({ voucherNo: r.voucherNo, account: r.account, amount: r.debit, date: r.dateKey, type: r.voucherType }))
    }, null, 2));
    if (!apply) return;

    const user = await prisma.user.findFirst({ where: { email: "admin@ashtavinayaka.com" }, select: { id: true, branchId: true } });
    const branch = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!user || !branch) throw new Error("Admin or branch missing");
    const actor = { id: user.id, branchId: user.branchId || branch.id, branchAccessType: BranchAccessType.ALL };
    const cache = ImportResolver.createJournalImportCache();
    const created = [];
    for (const [index, row] of toCreate.entries()) {
      try {
        const result = await ImportResolver.importJournalRegisterRow(actor, {
            date: row.date,
            sourceSerialNo: `IE-PDF-${row.serial}-${row.voucherNo}-${index}`,
            importIndex: index + 1,
            sourceSheet: "Indirect Expenses PDF",
            sourceRow: index + 1,
            journalGroup: "Indirect Expenses",
            accountName: row.account,
            narration: row.narration,
            voucherNo: row.voucherNo,
            voucherType: row.voucherType || "JOURNAL",
            particulars: row.account,
            debitAmount: row.debit,
            creditAmount: row.credit
        }, { skipBalanceSync: true, cache });
        created.push({
            voucherNo: row.voucherNo,
            account: row.account,
            amount: row.debit,
            status: (result as any).__importStatus || "created",
            ledgerId: (result as any).ledgerId
        });
      } catch (error) {
        created.push({
            voucherNo: row.voucherNo,
            account: row.account,
            amount: row.debit,
            status: "error",
            error: error instanceof Error ? error.message : String(error)
        });
      }
        if ((index + 1) % 25 === 0) console.log(JSON.stringify({ createdSoFar: index + 1, of: toCreate.length }));
    }
    const ledgerIds = [...new Set(created.map(r => r.ledgerId).filter(Boolean))];
    for (const ledgerId of ledgerIds) await LedgerService.syncCachedBalance(prisma, ledgerId);
    const pfLedger = ledgers.filter(l => compact(l.name) === "PROFESSIONALFEES");
    const pfEntries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: pfLedger.map(l => l.id) } },
        select: { amount: true, entryType: true }
    });
    const pfNet = Number(pfEntries.reduce((s, e) => s + (e.entryType === EntryType.DEBIT ? Number(e.amount) : -Number(e.amount)), 0).toFixed(2));
    console.log(JSON.stringify({
        created: created.length,
        skipped: created.filter(r => r.status === "skipped").length,
        errors: created.filter(r => r.status === "error").length,
        errorSample: created.filter(r => r.status === "error").slice(0, 10),
        errors: created.filter(r => r.status === "error").length,
        errorSample: created.filter(r => r.status === "error").slice(0, 10),
        pfClosingAfter: pfNet,
        pfTarget: 2168349.23,
        pfGap: Number((pfNet - 2168349.23).toFixed(2)),
        createdPf: created.filter(r => compact(r.account).includes("PROFESSIONALFEE"))
    }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
