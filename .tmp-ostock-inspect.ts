import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: { name: { contains: "Opening Stock", mode: "insensitive" } },
        select: {
            id: true, name: true, isActive: true, category: true, branchId: true,
            openingDebit: true, openingCredit: true, openingBalance: true,
            group: { select: { id: true, name: true, code: true, parent: { select: { name: true, code: true } } } }
        }
    });
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { contains: "Opening Stock", mode: "insensitive" } },
        select: { id: true, name: true, code: true, parent: { select: { name: true, code: true } } }
    });
    const rows = [];
    for (const l of ledgers) {
        const fy = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: {
                    select: {
                        id: true, voucherNo: true, voucherType: true, voucherDate: true, branchId: true,
                        entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { name: true, category: true } } } }
                    }
                }
            }
        });
        rows.push({
            id: l.id, name: l.name, active: l.isActive, cat: l.category, branchId: l.branchId,
            group: `${l.group?.parent?.name} > ${l.group?.name} (${l.group?.code})`,
            ledgerOpen: { dr: Number(l.openingDebit), cr: Number(l.openingCredit), bal: Number(l.openingBalance) },
            entries: fy.map(e => ({
                id: e.id, side: e.entryType, amt: Number(e.amount),
                no: e.voucher.voucherNo, type: e.voucher.voucherType,
                date: localDate(e.voucher.voucherDate), narr: (e.narration || "").slice(0, 80),
                others: e.voucher.entries.filter(x => x.id !== e.id).map(x => ({
                    name: x.ledger.name, cat: x.ledger.category, side: x.entryType, amt: Number(x.amount)
                }))
            }))
        });
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
    const ca = all.find(x => x.path === "Current Assets")?.node;
    const stock = all.filter(x => /Opening Stock/i.test(x.path));
    console.log(JSON.stringify({
        groups,
        ledgers: ledgers.map(l => ({ id: l.id, name: l.name, active: l.isActive, cat: l.category, group: `${l.group?.parent?.name} > ${l.group?.name}` })),
        rows,
        ca: ca && { od: ca.openingDebit, oc: ca.openingCredit, cd: ca.closingDebit, cc: ca.closingCredit },
        stock: stock.map(x => ({
            path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit, pd: x.node.periodDebit, pc: x.node.periodCredit
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
