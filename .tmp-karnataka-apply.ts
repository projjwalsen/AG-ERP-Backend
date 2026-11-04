import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const KARNATAKA = "c3002d61-8da2-4001-abe4-d6f9c8d33d5f";
const BOM = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const V_10991_DR = "2fac1dfd-1cc5-47ca-aef6-19ed06dc8d87";
const V_11308_J = "a62d1491-bf1a-43d2-9137-fe6f2d6af571";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const already10991 = await prisma.ledgerEntry.findFirst({
        where: { ledgerId: KARNATAKA, entryType: "DEBIT", amount: 4646000, voucher: { voucherNo: "10991" } },
        select: { id: true }
    });
    if (!already10991) {
        await prisma.ledgerEntry.create({
            data: {
                id: randomUUID(),
                voucherId: V_10991_DR,
                ledgerId: KARNATAKA,
                branchId: BRANCH_ID,
                entryType: "DEBIT",
                amount: 4646000,
                narration: "Karnataka recon Payment 10991 YES BANK CA"
            }
        });
        const host = await prisma.voucher.findUnique({
            where: { id: V_10991_DR },
            select: { entries: { select: { entryType: true, amount: true } } }
        });
        const dr = host!.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = host!.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({
            where: { id: V_10991_DR },
            data: { totalDebit: money(dr), totalCredit: money(cr) }
        });
    }

    const already11308 = await prisma.ledgerEntry.findFirst({
        where: { ledgerId: KARNATAKA, entryType: "DEBIT", amount: 2884, voucher: { voucherNo: "11308" } },
        select: { id: true }
    });
    if (!already11308) {
        await prisma.ledgerEntry.create({
            data: {
                id: randomUUID(),
                voucherId: V_11308_J,
                ledgerId: KARNATAKA,
                branchId: BRANCH_ID,
                entryType: "DEBIT",
                amount: 2884,
                narration: "Karnataka recon Payment 11308 BOM CC"
            }
        });
        const bomCr = await prisma.ledgerEntry.findFirst({
            where: { voucherId: V_11308_J, ledgerId: BOM, entryType: "CREDIT", amount: 2884 },
            select: { id: true }
        });
        if (!bomCr) {
            await prisma.ledgerEntry.create({
                data: {
                    id: randomUUID(),
                    voucherId: V_11308_J,
                    ledgerId: BOM,
                    branchId: BRANCH_ID,
                    entryType: "CREDIT",
                    amount: 2884,
                    narration: "Karnataka recon Payment 11308 BOM CC"
                }
            });
        }
        const host = await prisma.voucher.findUnique({
            where: { id: V_11308_J },
            select: { entries: { select: { entryType: true, amount: true } } }
        });
        const dr = host!.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = host!.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({
            where: { id: V_11308_J },
            data: { totalDebit: money(dr), totalCredit: money(cr) }
        });
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
    console.log(JSON.stringify({
        karnataka: pick("Branch / Divisions > A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA"),
        pdf: { oc: 13272543.12, pd: 389390938.87, pc: 403559076, cc: 27440680.25 },
        parent: pick("Branch / Divisions"),
        guard: {
            duties: pick("Current Liabilities > Duties & Taxes"),
            sc: pick("Current Liabilities > Sundry Creditors"),
            odcc: pick("Loans (Liability) > Bank OD A/c & CC A/c"),
            unsec: pick("Loans (Liability) > Unsecured Loans")
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
