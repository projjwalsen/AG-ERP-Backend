import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";
import * as fs from "fs";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const v12101 = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: "12101" },
        select: {
            id: true, voucherType: true, voucherDate: true, narration: true,
            entries: { select: { id: true, entryType: true, amount: true, narration: true, ledger: { select: { name: true } }, ledgerId: true } }
        }
    });
    const v17982 = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: "17982" },
        select: {
            id: true, voucherType: true, voucherDate: true, narration: true,
            entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { name: true } }, ledgerId: true } }
        }
    });
    console.log(JSON.stringify({
        v12101: v12101.map(v => ({
            id: v.id, type: v.voucherType, date: v.voucherDate, local: localDate(v.voucherDate),
            narr: (v.narration || "").slice(0, 100),
            entries: v.entries.map(e => ({ id: e.id, side: e.entryType, amount: Number(e.amount), name: e.ledger.name, narr: e.narration, bom: BOM_IDS.includes(e.ledgerId) }))
        })),
        v17982: v17982.map(v => ({
            id: v.id, type: v.voucherType, date: v.voucherDate, local: localDate(v.voucherDate), inPeriod: v.voucherDate >= START && v.voucherDate <= END,
            narr: (v.narration || "").slice(0, 100),
            entries: v.entries.map(e => ({ id: e.id, side: e.entryType, amount: Number(e.amount), name: e.ledger.name, bom: BOM_IDS.includes(e.ledgerId) }))
        }))
    }, null, 2));

    // Dedup extra 12101 BOM debit if two recon lines
    const bom12101 = v12101.flatMap(v => v.entries.filter(e => BOM_IDS.includes(e.ledgerId) && e.entryType === "DEBIT" && cents(e.amount) === 47349));
    if (bom12101.length > 1) {
        await prisma.ledgerEntry.deleteMany({ where: { id: { in: bom12101.slice(1).map(e => e.id) } } });
    }

    // Move 17982 into FY if it's 1 Apr IST
    for (const v of v17982) {
        if (localDate(v.voucherDate) === "2026-04-01" || v.voucherDate > END) {
            await prisma.voucher.update({
                where: { id: v.id },
                data: { voucherDate: new Date("2026-03-30T18:30:00.000Z") }
            });
        }
        if (localDate(v.voucherDate) === "2026-03-31" && v.voucherDate > END) {
            await prisma.voucher.update({
                where: { id: v.id },
                data: { voucherDate: new Date("2026-03-30T18:30:00.000Z") }
            });
        }
    }
    // If 17982 is 2026-03-31 18:30Z (= Apr 1 IST), localDate is 2026-04-01
    for (const v of v17982) {
        const d = localDate(v.voucherDate);
        if (d !== "2026-03-31") {
            await prisma.voucher.update({
                where: { id: v.id },
                data: { voucherDate: new Date("2026-03-30T18:30:00.000Z") }
            });
        }
    }

    const after = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { entryType: true, amount: true }
    });
    let dr = 0, cr = 0;
    for (const e of after) {
        if (e.entryType === "DEBIT") dr += cents(e.amount); else cr += cents(e.amount);
    }
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    const bob = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: BOB_IDS }, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
        select: { entryType: true, amount: true }
    });
    let bobDr = 0, bobCr = 0;
    for (const e of bob) {
        if (e.entryType === "DEBIT") bobDr += cents(e.amount); else bobCr += cents(e.amount);
    }
    const openings = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: [...BOM_IDS, ...BOB_IDS] }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { ledger: { select: { name: true } }, entryType: true, amount: true }
    });
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const tb = walk(report.tree || []).filter(x => /Bank OD A\/c|60434886441|13780500000078/.test(x.path)).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    console.log("AFTER", JSON.stringify({
        deleted12101: Math.max(0, bom12101.length - 1),
        bom: { dr: money(dr), cr: money(cr), excelDr: bomXl.perDr, excelCr: bomXl.perCr, dDr: money(dr - cents(bomXl.perDr)), dCr: money(cr - cents(bomXl.perCr)) },
        bob: { dr: money(bobDr), cr: money(bobCr) },
        openings,
        targetClose: 316017958.99,
        tb
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
