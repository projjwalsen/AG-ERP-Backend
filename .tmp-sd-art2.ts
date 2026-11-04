import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ART = "0643bf95-4acb-4d80-adfd-9bea7f8bd47d";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: { name: { contains: "A G ART PETROCHEM", mode: "insensitive" } },
        select: {
            id: true, name: true, category: true, isActive: true, openingDebit: true, openingCredit: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    });
    const ids = ledgers.map(l => l.id);
    const allEntries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ids } },
        select: {
            ledgerId: true, entryType: true, amount: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });
    console.log(JSON.stringify({
        ledgers,
        entries: allEntries.map(e => ({
            ledgerId: e.ledgerId, side: e.entryType, amt: Number(e.amount),
            no: e.voucher.voucherNo, type: e.voucher.voucherType, date: e.voucher.voucherDate
        })).filter(e => Number(e.amt) > 1000000).slice(0, 30),
        n: allEntries.length
    }, null, 2));

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const row = walk(report.tree || []).find(x => /A G ART PETROCHEM/i.test(x.node.name));
    console.log("TB", JSON.stringify(row && {
        path: row.path, name: row.node.name,
        od: row.node.openingDebit, oc: row.node.openingCredit,
        pd: row.node.periodDebit, pc: row.node.periodCredit,
        cd: row.node.closingDebit, cc: row.node.closingCredit
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
