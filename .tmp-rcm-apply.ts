import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const IDS: Record<string, string> = {
    "INPUT RCM CGST": "d0952654-53e8-4667-bd16-014166938cfb",
    "INPUT RCM SGST": "d09e0de1-20a0-412a-bf7b-94c456acc41f",
    "OUTPUT RCM CGST": "b4f6f655-1758-48af-8879-0f326003289c",
    "OUTPUT RCM SGST": "2ae9958b-2f62-4f2e-a9e1-88dbe618d789"
};
const SKIP_NOS = new Set(["233", "PDN/M/2526/030"]);

function indiaNoon(isoDate: string) {
    // Treat YYYY-MM-DD as start of that India day in UTC.
    return new Date(`${isoDate}T00:00:00.000+05:30`);
}

function dateFromNarration(narr: string, fallback: Date) {
    const n = narr || "";
    const m =
        n.match(/DATED?:\s*(\d{2})[./-](\d{2})[./-](\d{4})/i) ||
        n.match(/\bDT\s+(\d{2})[./-](\d{2})[./-](\d{4})/i) ||
        n.match(/DTD\s*[–-]\s*(\d{2})[./-](\d{2})[./-](\d{4})/i);
    if (m) return indiaNoon(`${m[3]}-${m[2]}-${m[1]}`);
    return fallback;
}

async function retotal(voucherId: string) {
    const v = await prisma.voucher.findUnique({
        where: { id: voucherId },
        select: { entries: { select: { entryType: true, amount: true } } }
    });
    if (!v) return;
    const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
    const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
    await prisma.voucher.update({ where: { id: voucherId }, data: { totalDebit: money(dr), totalCredit: money(cr) } });
}

(async () => {
    const missing = (JSON.parse(fs.readFileSync(".tmp-rcm-compare.json", "utf8")).missing as any[])
        .filter(m => !SKIP_NOS.has(m.no) && IDS[m.name]);

    const byNo = new Map<string, any[]>();
    for (const m of missing) {
        const rows = byNo.get(m.no) || [];
        rows.push(m);
        byNo.set(m.no, rows);
    }

    const template = await prisma.journal.findFirst({
        where: {
            voucher: { entries: { some: { ledgerId: IDS["INPUT RCM CGST"] } }, branchId: BRANCH },
            status: "APPROVED"
        },
        select: { journalHeadId: true, paymentMode: true, categoryId: true, createdById: true }
    });
    if (!template) throw new Error("No RCM journal template");

    const stats = { createdVouchers: 0, createdEntries: 0, skippedExisting: 0, deletedExtra: 0 };
    const existing = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: Object.values(IDS) }, voucher: { branchId: BRANCH, voucherNo: { in: [...byNo.keys()] } } },
        select: { ledgerId: true, entryType: true, amount: true, voucher: { select: { voucherNo: true } } }
    });
    const have = new Set(existing.map(e => `${e.voucher.voucherNo}|${e.ledgerId}|${e.entryType}|${cents(e.amount)}`));

    const hostDates = await prisma.voucher.findMany({
        where: { branchId: BRANCH, voucherNo: { in: [...byNo.keys()] } },
        select: { voucherNo: true, voucherDate: true },
        orderBy: { voucherDate: "asc" }
    });
    const dateByNo = new Map<string, Date>();
    for (const h of hostDates) if (!dateByNo.has(h.voucherNo)) dateByNo.set(h.voucherNo, h.voucherDate);

    for (const [no, rows] of byNo) {
        const toAdd = rows.filter(m => {
            const key = `${no}|${IDS[m.name]}|${m.side}|${cents(m.amt)}`;
            if (have.has(key)) {
                stats.skippedExisting += 1;
                return false;
            }
            return true;
        });
        if (!toAdd.length) continue;
        const fallback = dateByNo.get(no) || indiaNoon("2025-04-01");
        const voucherDate = dateFromNarration(toAdd[0].narr || "", fallback);
        const dr = toAdd.filter(m => m.side === "DEBIT").reduce((s, m) => s + cents(m.amt), 0);
        const cr = toAdd.filter(m => m.side === "CREDIT").reduce((s, m) => s + cents(m.amt), 0);
        const voucherId = randomUUID();
        await prisma.voucher.create({
            data: {
                id: voucherId,
                voucherNo: no,
                voucherType: "JOURNAL",
                sourceId: randomUUID(),
                branchId: BRANCH,
                narration: (toAdd[0].narr || `RCM ${no}`).slice(0, 500),
                voucherDate,
                totalDebit: money(dr),
                totalCredit: money(cr),
                entries: {
                    create: toAdd.map(m => ({
                        id: randomUUID(),
                        ledgerId: IDS[m.name],
                        branchId: BRANCH,
                        entryType: m.side,
                        amount: m.amt,
                        narration: (m.narr || `RCM ${m.name} ${no}`).slice(0, 500)
                    }))
                }
            }
        });
        await prisma.journal.create({
            data: {
                id: randomUUID(),
                branchId: BRANCH,
                journalHeadId: template.journalHeadId,
                paymentMode: template.paymentMode,
                direction: "OUTWARD",
                amount: money(Math.max(dr, cr)),
                status: "APPROVED",
                voucherId,
                voucherNo: no,
                journalDate: voucherDate,
                createdById: template.createdById || ACTOR,
                approvedById: ACTOR,
                approvedAt: new Date(),
                remarks: `RCM recon ${no}`,
                categoryId: template.categoryId
            }
        });
        stats.createdVouchers += 1;
        stats.createdEntries += toAdd.length;
        for (const m of toAdd) have.add(`${no}|${IDS[m.name]}|${m.side}|${cents(m.amt)}`);
    }

    const extra = await prisma.voucher.findMany({
        where: { voucherNo: "DUTIES-RCM-SGST-757", branchId: BRANCH },
        select: { id: true, entries: { select: { id: true } }, journals: { select: { id: true } } }
    });
    for (const v of extra) {
        if (v.entries.length) await prisma.ledgerEntry.deleteMany({ where: { id: { in: v.entries.map(e => e.id) } } });
        if (v.journals.length) await prisma.journal.deleteMany({ where: { id: { in: v.journals.map(j => j.id) } } });
        await prisma.voucher.delete({ where: { id: v.id } }).catch(() => undefined);
        stats.deletedExtra += 1;
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31", includeZero: true }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const row = (path: string) => all.find(x => x.path === path)?.node;
    const want = [
        { path: "Current Liabilities > Duties & Taxes > GST > RCM > INPUT RCM CGST", oc: 0, cc: 0, cd: 0 },
        { path: "Current Liabilities > Duties & Taxes > GST > RCM > INPUT RCM IGST", oc: 0, cc: 0, cd: 0 },
        { path: "Current Liabilities > Duties & Taxes > GST > RCM > INPUT RCM SGST", oc: 0, cc: 0, cd: 0 },
        { path: "Current Liabilities > Duties & Taxes > GST > RCM > OUTPUT RCM CGST", oc: 81594, cc: 137038, cd: 0 },
        { path: "Current Liabilities > Duties & Taxes > GST > RCM > OUTPUT RCM IGST", oc: 29367, cc: 48424.33, cd: 0 },
        { path: "Current Liabilities > Duties & Taxes > GST > RCM > OUTPUT RCM SGST", oc: 81594, cc: 137038, cd: 0 },
        { path: "Current Liabilities > Duties & Taxes > GST > RCM", oc: 192555, cc: 322500.33, cd: 0 }
    ];
    const mismatches = want.map(w => {
        const n = row(w.path);
        if (!n) return { path: w.path, issue: "missing" };
        const ok = cents(n.openingCredit) === cents(w.oc) && cents(n.closingCredit) === cents(w.cc) && cents(n.closingDebit) === cents(w.cd);
        return ok ? null : { path: w.path.split(" > ").pop(), tb: { od: n.openingDebit, oc: n.openingCredit, cd: n.closingDebit, cc: n.closingCredit }, want: w };
    }).filter(Boolean);
    const duties = row("Current Liabilities > Duties & Taxes");
    console.log(JSON.stringify({
        stats,
        mismatches,
        rcm: want.map(w => {
            const n = row(w.path);
            return n && { name: w.path.split(" > ").pop(), oc: n.openingCredit, cd: n.closingDebit, cc: n.closingCredit };
        }),
        duties: duties && { cd: duties.closingDebit, cc: duties.closingCredit }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
