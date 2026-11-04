import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const AURIOLUS = "c9998dee-e2d5-4aa8-84e9-12fe665bd367";
const LT_600976 = "e4117ef2-933a-42f7-8d03-b299fe037d78";
const INTEREST = "f5d0a3bc-b311-4211-aeab-cd5e8bfb89fb";
const VOUCHER_12444 = "ad4a2b51-3f19-4296-82a5-a89959a84eb7";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const stats = { auriolus: false, lt: false };

    const existingAuriolus = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: AURIOLUS,
            entryType: "DEBIT",
            amount: 2579,
            voucher: { voucherNo: "PDN/M/2526/002" }
        },
        select: { id: true }
    });
    if (!existingAuriolus) {
        const voucherId = randomUUID();
        await prisma.voucher.create({
            data: {
                id: voucherId,
                voucherNo: "PDN/M/2526/002",
                voucherType: "JOURNAL",
                branchId: BRANCH_ID,
                narration: "Unsec recon Inward Debit Note PDN/M/2526/002 Auriolus",
                totalDebit: 2579,
                totalCredit: 2579,
                voucherDate: new Date("2025-04-06T18:30:00.000Z"),
                entries: {
                    create: [
                        {
                            id: randomUUID(),
                            ledgerId: AURIOLUS,
                            branchId: BRANCH_ID,
                            entryType: "DEBIT",
                            amount: 2579,
                            narration: "Interest on Unsecured Loan"
                        },
                        {
                            id: randomUUID(),
                            ledgerId: INTEREST,
                            branchId: BRANCH_ID,
                            entryType: "CREDIT",
                            amount: 2579,
                            narration: "Auriolus Finvest Pvt Ltd (BIZFUNDS)"
                        }
                    ]
                }
            }
        });
        stats.auriolus = true;
    }

    const existingLt = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: LT_600976,
            entryType: "DEBIT",
            amount: 172552.24,
            voucher: { voucherNo: "12444" }
        },
        select: { id: true }
    });
    if (!existingLt) {
        const host = await prisma.voucher.findUnique({
            where: { id: VOUCHER_12444 },
            select: {
                id: true,
                totalDebit: true,
                totalCredit: true,
                entries: { select: { entryType: true, amount: true, ledgerId: true } }
            }
        });
        if (!host) throw new Error("12444 debit voucher missing");
        const already = host.entries.some(e =>
            e.ledgerId === LT_600976 && e.entryType === "DEBIT" && cents(e.amount) === cents(172552.24)
        );
        if (!already) {
            await prisma.ledgerEntry.create({
                data: {
                    id: randomUUID(),
                    voucherId: host.id,
                    ledgerId: LT_600976,
                    branchId: BRANCH_ID,
                    entryType: "DEBIT",
                    amount: 172552.24,
                    narration: "Unsec recon Payment 12444 L&T 600976"
                }
            });
            const dr = host.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0)
                + cents(172552.24);
            const cr = host.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
            await prisma.voucher.update({
                where: { id: host.id },
                data: { totalDebit: money(dr), totalCredit: money(cr) }
            });
            stats.lt = true;
        }
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
    const pdf = {
        parent: { oc: 194220007.32, cc: 209169654.45 },
        dir: { oc: 23586838.62, cc: 21758069.62 },
        bank: { oc: 5669384.98, cc: 86783560.99 },
        other: { oc: 101146121.22, cc: 100628023.84 }
    };
    const actual = {
        parent: pick("Loans (Liability) > Unsecured Loans"),
        dir: pick("Loans (Liability) > Unsecured Loans > Loan From Directors"),
        bank: pick("Loans (Liability) > Unsecured Loans > Unsecured from Bank"),
        other: pick("Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank")
    };
    const diff = (a: any, want: { oc: number; cc: number }) => a && {
        dOc: Number((Number(a.oc || 0) - want.oc).toFixed(2)),
        dCc: Number((Number(a.cc || 0) - want.cc).toFixed(2)),
        dCd: Number((Number(a.cd || 0)).toFixed(2)),
        a
    };
    const leaves = all.filter(x => /Loans \(Liability\) > Unsecured/.test(x.path)).map(x => ({
        path: x.path,
        oc: x.node.openingCredit, od: x.node.openingDebit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c/.test(x.path)
    ).map(x => ({
        path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit,
        oc: x.node.openingCredit, od: x.node.openingDebit
    }));
    console.log(JSON.stringify({
        stats,
        vsPdf: {
            parent: diff(actual.parent, pdf.parent),
            dir: diff(actual.dir, pdf.dir),
            bank: diff(actual.bank, pdf.bank),
            other: diff(actual.other, pdf.other)
        },
        leaves,
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
