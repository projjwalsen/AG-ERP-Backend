import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const CANON_BOM = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const BANK_ACCOUNTS_ID = "7cf41220-8e89-4cd1-b6ce-e7bac996abd6";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const miss = JSON.parse(fs.readFileSync(".tmp-odcc-still-after.json", "utf8")).miss2 as any[];
const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));

(async () => {
    const nos = [...new Set(miss.map(r => String(r.no)))];
    const alt = [...nos, "21.9", "11556-TDS-MAR25", "CB-CONTRA-20260307", "KFD401-CONTRA-20251114"];
    const vouchers = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: { in: alt } },
        select: {
            id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
            totalDebit: true, totalCredit: true,
            entries: {
                select: {
                    id: true, ledgerId: true, entryType: true, amount: true,
                    ledger: { select: { name: true, category: true } }
                }
            }
        }
    });

    const adds: any[] = [];
    const relink: any[] = [];
    for (const v of vouchers) {
        const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        const gap = dr - cr;
        if (gap === 0) continue;
        const hasBom = v.entries.some(e => BOM_IDS.includes(e.ledgerId));
        // Missing bank side of a Tally split payment/receipt
        if (gap > 0 && !v.entries.some(e => e.entryType === "CREDIT" && BOM_IDS.includes(e.ledgerId))) {
            adds.push({
                id: randomUUID(),
                voucherId: v.id,
                ledgerId: CANON_BOM,
                branchId: BRANCH_ID,
                entryType: "CREDIT",
                amount: money(gap),
                narration: `OD/CC recon bank credit ${v.voucherNo}`,
                newTotalDebit: money(dr),
                newTotalCredit: money(cr + gap),
                no: v.voucherNo
            });
        } else if (gap < 0 && !v.entries.some(e => e.entryType === "DEBIT" && BOM_IDS.includes(e.ledgerId))) {
            adds.push({
                id: randomUUID(),
                voucherId: v.id,
                ledgerId: CANON_BOM,
                branchId: BRANCH_ID,
                entryType: "DEBIT",
                amount: money(-gap),
                narration: `OD/CC recon bank debit ${v.voucherNo}`,
                newTotalDebit: money(dr - gap),
                newTotalCredit: money(cr),
                no: v.voucherNo
            });
        }
        // Relink generic Bank Accounts lines on these vouchers to BOM
        for (const e of v.entries) {
            if (e.ledgerId === BANK_ACCOUNTS_ID || (e.ledger.category === "BANK" && norm(e.ledger.name) === "BANK ACCOUNTS")) {
                relink.push({ entryId: e.id, to: CANON_BOM, no: v.voucherNo, amount: Number(e.amount) });
            }
        }
        void hasBom;
    }

    // For remaining excel vs current BOM-by-no, pull more Bank Accounts receipts with same voucher no from any leftover
    const bomNow = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: BOM_IDS }, voucher: { voucherNo: { in: alt } } },
        select: { entryType: true, amount: true, voucher: { select: { voucherNo: true } } }
    });
    const bomSum = new Map<string, { dr: number; cr: number }>();
    for (const e of bomNow) {
        const k = String(e.voucher.voucherNo);
        const cur = bomSum.get(k) || { dr: 0, cr: 0 };
        if (e.entryType === "DEBIT") cur.dr += cents(e.amount); else cur.cr += cents(e.amount);
        bomSum.set(k, cur);
    }

    if (relink.length) {
        const values = relink.map(r => `('${r.entryId}','${r.to}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }
    if (adds.length) {
        await prisma.ledgerEntry.createMany({
            data: adds.map(a => ({
                id: a.id, voucherId: a.voucherId, ledgerId: a.ledgerId, branchId: a.branchId,
                entryType: a.entryType, amount: a.amount, narration: a.narration
            }))
        });
        for (const a of adds) {
            await prisma.voucher.update({
                where: { id: a.voucherId },
                data: { totalDebit: a.newTotalDebit, totalCredit: a.newTotalCredit }
            });
        }
    }

    const after = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { id: true, entryType: true, amount: true, voucher: { select: { voucherNo: true } } }
    });
    let dr = 0, cr = 0;
    const byNo = new Map<string, { dr: number; cr: number }>();
    for (const e of after) {
        if (e.entryType === "DEBIT") dr += cents(e.amount); else cr += cents(e.amount);
        const k = String(e.voucher.voucherNo);
        const cur = byNo.get(k) || { dr: 0, cr: 0 };
        if (e.entryType === "DEBIT") cur.dr += cents(e.amount); else cur.cr += cents(e.amount);
        byNo.set(k, cur);
    }

    const altNo = (no: string) => {
        if (no === "21") return ["21", "21.9"];
        if (no === "11556") return ["11556", "11556-TDS-MAR25"];
        if (no === "8908") return ["8908", "CB-CONTRA-20260307"];
        if (no === "14080") return ["14080", "KFD401-CONTRA-20251114"];
        return [no];
    };
    const stillShort: any[] = [];
    for (const row of miss) {
        const keys = altNo(String(row.no));
        const sum = keys.reduce((s, k) => {
            const v = byNo.get(k) || { dr: 0, cr: 0 };
            return s + (row.side === "DEBIT" ? v.dr : v.cr);
        }, 0);
        const want = cents(row.amount);
        if (sum !== want) stillShort.push({ no: row.no, side: row.side, want: row.amount, have: money(sum), gap: money(want - sum), date: row.date, particular: row.particular });
    }

    const bob = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: BOB_IDS }, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
        select: { entryType: true, amount: true }
    });
    let bobDr = 0, bobCr = 0;
    for (const e of bob) {
        if (e.entryType === "DEBIT") bobDr += cents(e.amount); else bobCr += cents(e.amount);
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
    const tb = walk(report.tree || []).filter(x =>
        /^Loans \(Liability\) > Bank OD/.test(x.path) || /60434886441|13780500000078/.test(x.path)
    ).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));

    const targetBomClose = 316017958.99;
    const targetBomDr = bomXl.perDr;
    const targetBomCr = bomXl.perCr;
    console.log(JSON.stringify({
        adds: adds.length, relink: relink.length,
        addNos: adds.map(a => ({ no: a.no, side: a.entryType, amount: a.amount })),
        bom: { n: after.length, dr: money(dr), cr: money(cr), excelDr: targetBomDr, excelCr: targetBomCr, dDr: money(dr - cents(targetBomDr)), dCr: money(cr - cents(targetBomCr)) },
        bob: { dr: money(bobDr), cr: money(bobCr) },
        stillShort,
        tb,
        closeGap: tb.find(x => x.path.includes("60434886441") && !x.path.includes("BARODA"))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
