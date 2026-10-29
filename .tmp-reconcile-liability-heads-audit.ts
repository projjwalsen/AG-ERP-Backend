import "dotenv/config";
import * as fs from "fs";
import * as XLSX from "xlsx";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, string> = {
    "Sundry Creditors": "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
    "Advance From S. Debtors": "6cfbfae5-9fb5-486b-a317-33d4ab097601"
};
const FILES: Array<[string, string]> = [
    ["Sundry Creditors", "C:/Users/razon/Downloads/Sundry_Creditors_Vouchers.xlsx"],
    ["Advance From S. Debtors", "C:/Users/razon/Downloads/Advance_From_S_Debtors.xlsx"]
];
const TYPE_ALIASES: Record<string, string[]> = {
    Payment: ["PAYMENT", "BANK_PAYMENT"],
    Receipt: ["RECEIPT", "BANK_RECEIPT"],
    Purchase: ["PURCHASE"],
    "RCM Purchase": ["RCM_PURCHASE"],
    Journal: ["JOURNAL"],
    "Journal Expenses": ["JOURNAL"],
    "Inward Debit Note": ["DEBIT_NOTE"],
    "Inward Credit Note": ["CREDIT_NOTE", "DEBIT_NOTE"],
    "RCM Debit Note": ["DEBIT_NOTE"],
    "CASH PAYMENT": ["CASH_PAYMENT"],
    "Salary Payment": ["PAYMENT", "BANK_PAYMENT"],
    "Tax Invoice": ["SALE"]
};

const norm = (value: unknown) =>
    String(value ?? "")
        .normalize("NFKD")
        .replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();
const cents = (value: unknown) =>
    Math.round(Number(String(value ?? "0").replace(/[,?\s]/g, "").replace(/[^0-9.-]/g, "")) * 100) || 0;
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const excelDate = (value: unknown) => {
    const s = String(value ?? "").trim();
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const d = new Date(s);
    if (Number.isNaN(+d)) return s;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

type SourceRow = {
    head: string;
    row: number;
    date: string;
    agency: string;
    agencyNorm: string;
    type: string;
    types: string[];
    no: string;
    noNorm: string;
    particulars: string;
    side: "DEBIT" | "CREDIT";
    cents: number;
};

(async () => {
    const source: SourceRow[] = [];
    for (const [head, path] of FILES) {
        const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(path).Sheets["Voucher Details"], {
            header: 1,
            defval: null,
            raw: false
        });
        for (let i = 4; i < rows.length; i++) {
            const r = rows[i];
            if (!r?.[1]) continue;
            const debit = cents(r[5]);
            const credit = cents(r[6]);
            source.push({
                head,
                row: i + 1,
                date: excelDate(r[0]),
                agency: String(r[1]).trim(),
                agencyNorm: norm(r[1]),
                type: String(r[2] ?? "").trim(),
                types: TYPE_ALIASES[String(r[2] ?? "").trim()] || [],
                no: String(r[3] ?? "").trim(),
                noNorm: norm(r[3]),
                particulars: String(r[4] ?? "").trim(),
                side: debit ? "DEBIT" : "CREDIT",
                cents: Math.max(debit, credit)
            });
        }
    }

    const groups = await prisma.ledgerGroup.findMany();
    const descendants = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) {
                if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                    ids.add(g.id);
                    changed = true;
                }
            }
        }
        return ids;
    };
    const scopes = new Map(Object.entries(ROOTS).map(([head, id]) => [head, descendants(id)]));
    const allScopeIds = [...new Set([...scopes.values()].flatMap(s => [...s]))];

    const ledgers = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: { in: allScopeIds } },
        select: {
            id: true,
            name: true,
            groupId: true,
            nature: true,
            isActive: true,
            openingBalance: true,
            openingDebit: true,
            openingCredit: true,
            currentBalance: true
        }
    });
    const ledgerById = new Map(ledgers.map(l => [l.id, l]));
    const ledgersByHeadName = new Map<string, typeof ledgers>();
    for (const ledger of ledgers) {
        for (const [head, ids] of scopes) {
            if (!ids.has(ledger.groupId)) continue;
            const key = `${head}|${norm(ledger.name)}`;
            const arr = ledgersByHeadName.get(key) || [];
            arr.push(ledger);
            ledgersByHeadName.set(key, arr);
        }
    }

    const entries: any[] = [];
    for (let i = 0; i < ledgers.length; i += 200) {
        entries.push(
            ...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                include: { voucher: true, ledger: { select: { id: true, name: true, groupId: true } } }
            })
        );
    }

    const used = new Set<string>();
    const matched: any[] = [];
    const unmatched: SourceRow[] = [];
    const duplicateHits: any[] = [];

    const bucket = new Map<string, any[]>();
    for (const entry of entries) {
        const ledger = ledgerById.get(entry.ledgerId);
        if (!ledger) continue;
        const heads = [...scopes.entries()].filter(([, ids]) => ids.has(ledger.groupId)).map(([head]) => head);
        for (const head of heads) {
            const key = [
                head,
                norm(ledger.name),
                norm(entry.voucher.voucherNo),
                entry.voucher.voucherType,
                entry.entryType,
                cents(entry.amount),
                localDate(entry.voucher.voucherDate)
            ].join("|");
            const arr = bucket.get(key) || [];
            arr.push(entry);
            bucket.set(key, arr);
        }
    }

    for (const row of source) {
        const candidates: any[] = [];
        for (const type of row.types) {
            const key = [row.head, row.agencyNorm, row.noNorm, type, row.side, row.cents, row.date].join("|");
            for (const entry of bucket.get(key) || []) {
                if (!used.has(entry.id)) candidates.push(entry);
            }
        }
        if (candidates.length === 1) {
            used.add(candidates[0].id);
            matched.push({ row, entry: candidates[0] });
        } else if (candidates.length > 1) {
            used.add(candidates[0].id);
            matched.push({ row, entry: candidates[0] });
            duplicateHits.push({
                row,
                extras: candidates.slice(1).map((e: any) => ({
                    entryId: e.id,
                    voucherId: e.voucherId,
                    ledgerId: e.ledgerId,
                    ledger: e.ledger.name
                }))
            });
        } else {
            unmatched.push(row);
        }
    }

    const extra = entries.filter(e => !used.has(e.id) && e.voucher.voucherType !== "OPENING_BALANCE");
    const openingExtras = entries.filter(e => !used.has(e.id) && e.voucher.voucherType === "OPENING_BALANCE");

    const unmatchedNos = [...new Set(unmatched.map(r => r.no).filter(Boolean))];
    const globalHits: any[] = [];
    for (let i = 0; i < unmatchedNos.length; i += 400) {
        globalHits.push(
            ...await prisma.voucher.findMany({
                where: { branchId: BRANCH_ID, voucherNo: { in: unmatchedNos.slice(i, i + 400) } },
                include: { entries: { include: { ledger: { select: { id: true, name: true, groupId: true } } } } }
            })
        );
    }

    const classified = {
        exactElsewhere: [] as any[],
        sameNoTypeWrong: [] as any[],
        noVoucher: [] as SourceRow[],
        blankNo: unmatched.filter(r => !r.no)
    };
    for (const row of unmatched) {
        if (!row.no) continue;
        const vouchers = globalHits.filter(
            v => norm(v.voucherNo) === row.noNorm && row.types.includes(v.voucherType)
        );
        const exact = vouchers.flatMap((v: any) =>
            v.entries
                .filter((e: any) =>
                    e.entryType === row.side &&
                    cents(e.amount) === row.cents &&
                    localDate(v.voucherDate) === row.date
                )
                .map((e: any) => ({
                    voucherId: v.id,
                    entryId: e.id,
                    ledgerId: e.ledgerId,
                    ledger: e.ledger.name,
                    groupId: e.ledger.groupId,
                    date: localDate(v.voucherDate),
                    type: v.voucherType
                }))
        );
        if (exact.length) classified.exactElsewhere.push({ row, hits: exact });
        else if (vouchers.length) {
            classified.sameNoTypeWrong.push({
                row,
                hits: vouchers.slice(0, 3).map((v: any) => ({
                    voucherId: v.id,
                    type: v.voucherType,
                    date: localDate(v.voucherDate),
                    entries: v.entries.map((e: any) => ({
                        ledger: e.ledger.name,
                        groupId: e.ledger.groupId,
                        side: e.entryType,
                        cents: cents(e.amount)
                    }))
                }))
            });
        } else classified.noVoucher.push(row);
    }

    const headStats = (head: string) => {
        const src = source.filter(r => r.head === head);
        const db = entries.filter(e => scopes.get(head)?.has(e.ledger.groupId) && e.voucher.voucherType !== "OPENING_BALANCE");
        const dbOpening = entries.filter(e => scopes.get(head)?.has(e.ledger.groupId) && e.voucher.voucherType === "OPENING_BALANCE");
        const sum = (rows: { side?: string; cents: number; entryType?: string }[], side: string) =>
            rows.filter(r => (r.side || r.entryType) === side).reduce((s, r) => s + r.cents, 0);
        const excelDebit = sum(src, "DEBIT");
        const excelCredit = sum(src, "CREDIT");
        const dbDebit = sum(db.map(e => ({ entryType: e.entryType, cents: cents(e.amount) })), "DEBIT");
        const dbCredit = sum(db.map(e => ({ entryType: e.entryType, cents: cents(e.amount) })), "CREDIT");
        const openingLedgers = ledgers.filter(l => scopes.get(head)?.has(l.groupId));
        const opening = openingLedgers.reduce((s, l) => {
            const od = Number(l.openingDebit);
            const oc = Number(l.openingCredit);
            const legacy = Number(l.openingBalance);
            const signed = od || oc ? od - oc : l.nature === "CREDIT" ? -legacy : legacy;
            return s + Math.round(signed * 100);
        }, 0);
        const openingVoucher = dbOpening.reduce((s, e) => s + (e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount)), 0);
        return {
            excelRows: src.length,
            excelDebit: excelDebit / 100,
            excelCredit: excelCredit / 100,
            dbRows: db.length,
            dbDebit: dbDebit / 100,
            dbCredit: dbCredit / 100,
            debitDiff: (dbDebit - excelDebit) / 100,
            creditDiff: (dbCredit - excelCredit) / 100,
            ledgers: openingLedgers.length,
            ledgerOpeningSigned: opening / 100,
            openingVoucherSigned: openingVoucher / 100,
            matched: matched.filter(m => m.row.head === head).length,
            unmatched: unmatched.filter(r => r.head === head).length,
            extra: extra.filter(e => scopes.get(head)?.has(e.ledger.groupId)).length
        };
    };

    const agencyMismatches = [];
    const agencies = [...new Set(source.map(r => r.head + "|" + r.agencyNorm + "|" + r.agency))];
    for (const key of agencies) {
        const [head, agencyNorm, agency] = key.split("|");
        const src = source.filter(r => r.head === head && r.agencyNorm === agencyNorm);
        const dbLedgers = ledgersByHeadName.get(`${head}|${agencyNorm}`) || [];
        const dbEntries = entries.filter(e => dbLedgers.some(l => l.id === e.ledgerId) && e.voucher.voucherType !== "OPENING_BALANCE");
        const excelDebit = src.filter(r => r.side === "DEBIT").reduce((s, r) => s + r.cents, 0);
        const excelCredit = src.filter(r => r.side === "CREDIT").reduce((s, r) => s + r.cents, 0);
        const dbDebit = dbEntries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const dbCredit = dbEntries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        if (excelDebit !== dbDebit || excelCredit !== dbCredit || src.length !== dbEntries.length) {
            agencyMismatches.push({
                head,
                agency,
                ledgers: dbLedgers.map(l => ({ id: l.id, name: l.name, groupId: l.groupId, isActive: l.isActive })),
                excelRows: src.length,
                dbRows: dbEntries.length,
                excelDebit: excelDebit / 100,
                excelCredit: excelCredit / 100,
                dbDebit: dbDebit / 100,
                dbCredit: dbCredit / 100
            });
        }
    }

    const missingLedgers = [...new Set(source.map(r => r.head + "|" + r.agency))]
        .filter(key => {
            const [head, agency] = key.split("|");
            return !(ledgersByHeadName.get(`${head}|${norm(agency)}`) || []).length;
        })
        .map(key => {
            const [head, agency] = key.split("|");
            return { head, agency, rows: source.filter(r => r.head === head && r.agency === agency).length };
        });

    const extraByType: Record<string, number> = {};
    for (const e of extra) extraByType[e.voucher.voucherType] = (extraByType[e.voucher.voucherType] || 0) + 1;
    const unmatchedByType: Record<string, number> = {};
    for (const r of unmatched) unmatchedByType[`${r.head}|${r.type}`] = (unmatchedByType[`${r.head}|${r.type}`] || 0) + 1;

    const stats = {
        sourceRows: source.length,
        dbEntries: entries.length,
        matched: matched.length,
        unmatched: unmatched.length,
        duplicateHits: duplicateHits.length,
        extraNonOpening: extra.length,
        openingExtras: openingExtras.length,
        missingLedgers: missingLedgers.length,
        agencyMismatches: agencyMismatches.length,
        classified: {
            exactElsewhere: classified.exactElsewhere.length,
            sameNoTypeWrong: classified.sameNoTypeWrong.length,
            noVoucher: classified.noVoucher.length,
            blankNo: classified.blankNo.length
        },
        unmatchedByType,
        extraByType,
        heads: {
            "Sundry Creditors": headStats("Sundry Creditors"),
            "Advance From S. Debtors": headStats("Advance From S. Debtors")
        },
        missingLedgerSample: missingLedgers.slice(0, 30),
        unmatchedSample: unmatched.slice(0, 20),
        extraSample: extra.slice(0, 20).map(e => ({
            ledger: e.ledger.name,
            groupId: e.ledger.groupId,
            no: e.voucher.voucherNo,
            type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate),
            side: e.entryType,
            cents: cents(e.amount),
            voucherId: e.voucherId,
            entryId: e.id
        })),
        exactElsewhereSample: classified.exactElsewhere.slice(0, 15),
        noVoucherSample: classified.noVoucher.slice(0, 15)
    };

    fs.writeFileSync(
        ".tmp-reconcile-liability-heads-audit.json",
        JSON.stringify(
            {
                stats,
                unmatched,
                extra: extra.map(e => ({
                    entryId: e.id,
                    voucherId: e.voucherId,
                    ledgerId: e.ledgerId,
                    ledger: e.ledger.name,
                    groupId: e.ledger.groupId,
                    no: e.voucher.voucherNo,
                    type: e.voucher.voucherType,
                    date: localDate(e.voucher.voucherDate),
                    side: e.entryType,
                    cents: cents(e.amount)
                })),
                duplicateHits,
                classified,
                agencyMismatches,
                missingLedgers
            },
            null,
            2
        )
    );
    console.log(JSON.stringify(stats, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
