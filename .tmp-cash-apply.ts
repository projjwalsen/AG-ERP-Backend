import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const CASH = "3838398e-cde8-4ac8-967b-692f801665a6";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

const EXTRA_CASH_IDS = [
    "0c86ec13-e19f-4e3a-b7ec-8020731317ee",
    "7b79f0a5-6873-45bb-a289-9c103b9b6cb0",
    "3b5cf778-2e11-4500-8409-b8e9e9541922",
    "bed36b18-80e1-4ac4-b0f5-2cc61a4f5264",
    "8e3a9812-9f50-4708-8201-546d00d24803",
    "634d9e4b-0692-425f-a281-d8b66eaec2f3"
];
const MISSING = [
    { voucherId: "3a268a90-135a-46c9-8517-c385e9f2308f", amount: 80, note: "Payment 6 Conveyance" },
    { voucherId: "0cc74d06-2a7b-4ea0-8b1f-c2b77f2f121e", amount: 779, note: "Payment 9 Conveyance" },
    { voucherId: "38085812-c662-4517-accd-246c35328c2f", amount: 25, note: "Payment 203 Staff Welfare" },
    { voucherId: "f1fe6a8c-3e42-4a33-8421-897201ba90c1", amount: 474, note: "Payment 247 Staff Welfare" },
    { voucherId: "ebc6195f-53b0-4170-a46b-e295294f81e1", amount: 240, note: "Payment 263 Staff Welfare" }
];

(async () => {
    const extraRows = await prisma.ledgerEntry.findMany({
        where: { id: { in: EXTRA_CASH_IDS }, ledgerId: CASH },
        select: { id: true, voucherId: true }
    });
    if (extraRows.length) {
        await prisma.ledgerEntry.deleteMany({ where: { id: { in: extraRows.map(e => e.id) } } });
        const voucherIds = [...new Set(extraRows.map(e => e.voucherId))];
        for (const id of voucherIds) {
            const v = await prisma.voucher.findUnique({
                where: { id },
                select: { entries: { select: { entryType: true, amount: true } } }
            });
            const dr = v!.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
            const cr = v!.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
            await prisma.voucher.update({ where: { id }, data: { totalDebit: money(dr), totalCredit: money(cr) } });
        }
    }

    let added = 0;
    for (const job of MISSING) {
        const exists = await prisma.ledgerEntry.findFirst({
            where: { voucherId: job.voucherId, ledgerId: CASH, entryType: "CREDIT", amount: job.amount },
            select: { id: true }
        });
        if (exists) continue;
        await prisma.ledgerEntry.create({
            data: {
                id: randomUUID(),
                voucherId: job.voucherId,
                ledgerId: CASH,
                branchId: BRANCH_ID,
                entryType: "CREDIT",
                amount: job.amount,
                narration: `Cash recon ${job.note}`
            }
        });
        const v = await prisma.voucher.findUnique({
            where: { id: job.voucherId },
            select: { entries: { select: { entryType: true, amount: true } } }
        });
        const dr = v!.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = v!.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({
            where: { id: job.voucherId },
            data: { totalDebit: money(dr), totalCredit: money(cr) }
        });
        added += 1;
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const pick = (p: string) => {
        const x = all.find(n => n.path === p);
        return x && {
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit
        };
    };
    const cashNodes = all.filter(x => /Current Assets > Cash/i.test(x.path)).map(x => ({
        path: x.path, ...pick(x.path)
    }));
    console.log(JSON.stringify({
        deleted: extraRows.length,
        added,
        cash: cashNodes,
        pdf: { od: 141935, pd: 612500, pc: 614271.85, cd: 140163.15 },
        guard: {
            duties: pick("Current Liabilities > Duties & Taxes"),
            sc: pick("Current Liabilities > Sundry Creditors"),
            odcc: pick("Loans (Liability) > Bank OD A/c & CC A/c"),
            unsec: pick("Loans (Liability) > Unsecured Loans"),
            karnataka: pick("Branch / Divisions > A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA")
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
