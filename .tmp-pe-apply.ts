import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const NOS = ["IE-PDF-FACTORY-INS-PREPAID", "IE-PDF-INTERNET-PREPAID"];

(async () => {
    const vouchers = await prisma.voucher.findMany({
        where: { voucherNo: { in: NOS }, branchId: BRANCH },
        select: {
            id: true, voucherNo: true,
            entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { name: true } } } },
            journals: { select: { id: true } }
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
    const row = (path: string) => all.find(x => x.path === path)?.node;
    const want = [
        { path: "Current Assets > Prepaid Exp > Prepaid Expenses", od: 168618.57, cd: 157731.29 },
        { path: "Current Assets > Prepaid Exp > Prepaid Insurance", od: 790379.2, cd: 1159741.62 },
        { path: "Current Assets > Prepaid Exp > CPCB EXPENSES", od: 0, cd: 3500 },
        { path: "Current Assets > Prepaid Exp > Prepaid Licence", od: 57582.25, cd: 94308.5 },
        { path: "Current Assets > Prepaid Exp > Prepaid License Fees Upto 31.12.30", od: 143500, cd: 114800 }
    ];
    const mismatches = want.map(w => {
        const n = row(w.path);
        if (!n) return { path: w.path, issue: "missing" };
        const ok = cents(n.openingDebit) === cents(w.od) && cents(n.closingDebit) === cents(w.cd) && cents(n.closingCredit) === 0;
        return ok ? null : { path: w.path, tb: { od: n.openingDebit, cd: n.closingDebit, cc: n.closingCredit }, want: w };
    }).filter(Boolean);
    const parent = row("Current Assets > Prepaid Exp");
    const guards = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Advance to S\. Creditors$|Sundry Debtors$|BOM CA 60435349267$/.test(x.path)
    ).map(x => ({ path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit }));

    console.log(JSON.stringify({
        stats,
        removed: vouchers.map(v => ({ no: v.voucherNo, entries: v.entries.map(e => ({ name: e.ledger.name, side: e.entryType, amt: Number(e.amount) })) })),
        parent: parent && { od: parent.openingDebit, cd: parent.closingDebit, cc: parent.closingCredit },
        children: want.map(w => {
            const n = row(w.path);
            return n && { name: w.path.split(" > ").pop(), od: n.openingDebit, cd: n.closingDebit, cc: n.closingCredit };
        }),
        mismatches,
        guards
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
