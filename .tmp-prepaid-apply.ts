import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

const VOUCHERS = [
    "IE-PDF-17020025E0005779",
    "IE-PDF-250927MH00049306"
];

(async () => {
    const vouchers = await prisma.voucher.findMany({
        where: { voucherNo: { in: VOUCHERS }, branchId: BRANCH },
        select: {
            id: true, voucherNo: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } } },
            journals: { select: { id: true, amount: true, direction: true, status: true } }
        }
    });
    const stats = { deletedEntries: 0, deletedJournals: 0, deletedVouchers: 0 };
    for (const v of vouchers) {
        if (v.entries.length) {
            await prisma.ledgerEntry.deleteMany({ where: { id: { in: v.entries.map(e => e.id) } } });
            stats.deletedEntries += v.entries.length;
        }
        if (v.journals.length) {
            await prisma.journal.deleteMany({ where: { id: { in: v.journals.map(j => j.id) } } });
            stats.deletedJournals += v.journals.length;
        }
        const leftover = await prisma.voucher.findUnique({
            where: { id: v.id },
            select: { entries: { select: { id: true } }, journals: { select: { id: true } } }
        });
        if (leftover && leftover.entries.length === 0 && leftover.journals.length === 0) {
            await prisma.voucher.delete({ where: { id: v.id } });
            stats.deletedVouchers += 1;
        }
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const prepaid = all.filter(x => /Prepaid Exp|CPCB EXPENSES|Prepaid Expenses|Prepaid Insurance|Prepaid Licen/i.test(x.path));
    const parent = all.find(x => x.path === "Current Assets > Prepaid Exp");
    const want = {
        "CPCB EXPENSES": { cd: 3500, od: 0 },
        "Prepaid Expenses": { cd: 157731.29, od: 168618.57 },
        "Prepaid Insurance": { cd: 1159741.62, od: 790379.2 },
        "Prepaid Licence": { cd: 94308.5, od: 57582.25 },
        "Prepaid License Fees Upto 31.12.30": { cd: 114800, od: 143500 }
    };
    const children = prepaid.filter(x => x.path.startsWith("Current Assets > Prepaid Exp > "));
    const mismatches = children.map(c => {
        const w = want[c.node.name as keyof typeof want];
        if (!w) return { name: c.node.name, issue: "extra", cd: c.node.closingDebit, cc: c.node.closingCredit };
        const ok = cents(c.node.closingDebit) === cents(w.cd) && cents(c.node.closingCredit) === 0 && cents(c.node.openingDebit) === cents(w.od);
        return ok ? null : { name: c.node.name, tb: { od: c.node.openingDebit, cd: c.node.closingDebit, cc: c.node.closingCredit }, want: w };
    }).filter(Boolean);
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Advance to S\. Creditors$|Sundry Debtors$/.test(x.path)
    ).map(x => ({ path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit }));

    console.log(JSON.stringify({
        stats,
        removed: vouchers.map(v => ({ no: v.voucherNo, entries: v.entries.map(e => ({ name: e.ledger.name, side: e.entryType, amt: Number(e.amount) })), journals: v.journals.length })),
        parent: parent && {
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        },
        parentOk: parent && cents(parent.node.closingDebit) === cents(1530081.41) && cents(parent.node.closingCredit) === 0
            && cents(parent.node.openingDebit) === cents(1160080.02),
        children: children.map(c => ({
            name: c.node.name, od: c.node.openingDebit, cd: c.node.closingDebit, cc: c.node.closingCredit
        })),
        mismatchN: mismatches.length,
        mismatches,
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
