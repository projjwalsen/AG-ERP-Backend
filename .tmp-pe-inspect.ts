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
        where: { name: { in: ["Prepaid Insurance", "Prepaid Expenses"], mode: "insensitive" } },
        select: {
            id: true, name: true, isActive: true, branchId: true, category: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    });
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
    const prepaid = all.filter(x => /Prepaid Exp/.test(x.path));
    const rows = [];
    for (const l of ledgers) {
        const fy = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true } }
            },
            orderBy: { voucher: { voucherDate: "asc" } }
        });
        const open = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherType: "OPENING_BALANCE" } },
            select: { id: true, entryType: true, amount: true }
        });
        rows.push({
            id: l.id, name: l.name, active: l.isActive, cat: l.category, branchId: l.branchId,
            group: `${l.group?.parent?.name} > ${l.group?.name}`,
            open: open.map(e => ({ side: e.entryType, amt: Number(e.amount) })),
            fyN: fy.length,
            fyDr: fy.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + Number(e.amount), 0),
            fyCr: fy.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + Number(e.amount), 0),
            fy: fy.map(e => ({
                id: e.id, no: e.voucher.voucherNo, type: e.voucher.voucherType,
                date: localDate(e.voucher.voucherDate), side: e.entryType, amt: Number(e.amount),
                narr: (e.narration || "").slice(0, 70)
            }))
        });
    }
    console.log(JSON.stringify({
        ledgers: ledgers.map(l => ({ id: l.id, name: l.name, active: l.isActive, cat: l.category, group: `${l.group?.parent?.name} > ${l.group?.name}` })),
        tb: prepaid.map(x => ({
            path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit, pd: x.node.periodDebit, pc: x.node.periodCredit
        })),
        rows
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
