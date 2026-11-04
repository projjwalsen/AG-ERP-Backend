import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const NAMES = [
    "KARNATAKA BANK FD AC NO - 5201500202002401",
    "KARNATAKA BANK FD AC NO - 5201500200202401",
    "Central Bank - 3224976293",
    "BOM CA 60435349267"
];
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: {
            OR: [
                { name: { in: NAMES, mode: "insensitive" } },
                { name: { contains: "5201500202002401", mode: "insensitive" } },
                { name: { contains: "5201500200202401", mode: "insensitive" } },
                { name: { contains: "3224976293", mode: "insensitive" } },
                { name: { contains: "60435349267", mode: "insensitive" } }
            ]
        },
        select: {
            id: true, name: true, branchId: true, isActive: true, category: true,
            group: { select: { id: true, name: true, code: true, parent: { select: { name: true } } } }
        }
    });
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
    const bank = all.filter(x => /Bank Accounts|Deposits with Bank|60435349267|3224976293|5201500202002401|5201500200202401|Central Bank|BOM CA|KARNATAKA BANK FD/i.test(x.path));
    const entries = [];
    for (const l of ledgers) {
        const fy = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true, branchId: true } }
            },
            orderBy: { voucher: { voucherDate: "asc" } }
        });
        const open = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherType: "OPENING_BALANCE" } },
            select: { id: true, entryType: true, amount: true, voucher: { select: { voucherDate: true, voucherNo: true } } }
        });
        const dr = fy.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + Number(e.amount), 0);
        const cr = fy.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + Number(e.amount), 0);
        entries.push({
            id: l.id, name: l.name, active: l.isActive, branchId: l.branchId,
            group: `${l.group?.parent?.name} > ${l.group?.name}`,
            open: open.map(e => ({ side: e.entryType, amt: Number(e.amount), no: e.voucher.voucherNo, date: e.voucher.voucherDate })),
            fyN: fy.length, fyDr: dr, fyCr: cr,
            fy: fy.map(e => ({
                id: e.id, no: e.voucher.voucherNo, type: e.voucher.voucherType,
                date: localDate(e.voucher.voucherDate), side: e.entryType, amt: Number(e.amount),
                narr: (e.narration || "").slice(0, 80)
            }))
        });
    }
    console.log(JSON.stringify({
        ledgers: ledgers.map(l => ({
            id: l.id, name: l.name, active: l.isActive, cat: l.category, branchId: l.branchId,
            group: `${l.group?.parent?.name} > ${l.group?.name} (${l.group?.code})`
        })),
        tb: bank.map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit
        })),
        entries
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
