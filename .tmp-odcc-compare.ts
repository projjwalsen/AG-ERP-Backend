import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    const bobXl = JSON.parse(fs.readFileSync(".tmp-odcc-bob.json", "utf8"));

    const openings = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: [...BOM_IDS, ...BOB_IDS] }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            ledger: { select: { name: true } },
            voucher: { select: { id: true, voucherNo: true, voucherDate: true, narration: true } }
        }
    });

    const bomEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });
    const bobEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOB_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, narration: true } }
        }
    });

    const used = new Set<string>();
    const byNoAmt = new Map<string, any[]>();
    const byAmtSide = new Map<string, any[]>();
    const push = (m: Map<string, any[]>, k: string, h: any) => { const a = m.get(k) || []; a.push(h); m.set(k, a); };
    for (const e of bomEntries) {
        const hit = { id: e.id, no: String(e.voucher.voucherNo || ""), side: e.entryType, cents: cents(e.amount), date: localDate(e.voucher.voucherDate), type: e.voucher.voucherType };
        push(byNoAmt, `${norm(hit.no)}|${hit.side}|${hit.cents}`, hit);
        push(byAmtSide, `${hit.side}|${hit.cents}|${hit.date}`, hit);
    }
    let matched = 0;
    const missing: any[] = [];
    for (const row of bomXl.vouchers) {
        const k1 = `${norm(row.no)}|${row.side}|${cents(row.amount)}`;
        const hit = (byNoAmt.get(k1) || []).find((h: any) => !used.has(h.id));
        if (hit) { used.add(hit.id); matched += 1; continue; }
        const k2 = `${row.side}|${cents(row.amount)}|${row.date}`;
        const hit2 = (byAmtSide.get(k2) || []).find((h: any) => !used.has(h.id));
        if (hit2) { used.add(hit2.id); matched += 1; continue; }
        missing.push(row);
    }
    const extra = bomEntries.filter(e => !used.has(e.id));
    const missByType: Record<string, { n: number; dr: number; cr: number }> = {};
    for (const r of missing) {
        missByType[r.type] = missByType[r.type] || { n: 0, dr: 0, cr: 0 };
        missByType[r.type].n += 1;
        if (r.side === "DEBIT") missByType[r.type].dr += cents(r.amount); else missByType[r.type].cr += cents(r.amount);
    }

    // Look up missing BOM voucher numbers anywhere
    const sampleNos = [...new Set(missing.slice(0, 30).map((r: any) => String(r.no)))].filter(Boolean);
    const elsewhere = sampleNos.length ? await prisma.ledgerEntry.findMany({
        where: {
            voucher: { branchId: BRANCH_ID, voucherNo: { in: sampleNos } },
            amount: { in: missing.slice(0, 80).map((r: any) => r.amount) }
        },
        select: {
            amount: true, entryType: true,
            ledger: { select: { name: true, category: true, group: { select: { name: true } } } },
            voucher: { select: { voucherNo: true, voucherType: true } }
        },
        take: 40
    }) : [];

    console.log(JSON.stringify({
        openings: openings.map(e => ({
            ledger: e.ledger.name, ledgerId: e.ledgerId, side: e.entryType, amount: Number(e.amount),
            no: e.voucher.voucherNo, date: e.voucher.voucherDate, narration: (e.voucher.narration || "").slice(0, 160)
        })),
        bom: {
            excel: { n: bomXl.vouchers.length, dr: bomXl.perDr, cr: bomXl.perCr, openCr: bomXl.openings[0]?.amount, closeDrCol: bomXl.closing },
            dbEntries: bomEntries.length, matched, missing: missing.length,
            extra: extra.length,
            missByType: Object.fromEntries(Object.entries(missByType).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }])),
            missSample: missing.slice(0, 8),
            extraSample: extra.slice(0, 5).map(e => ({ no: e.voucher.voucherNo, type: e.voucher.voucherType, side: e.entryType, amount: Number(e.amount) }))
        },
        bob: {
            excel: bobXl,
            db: bobEntries.map(e => ({ no: e.voucher.voucherNo, type: e.voucher.voucherType, side: e.entryType, amount: Number(e.amount), narration: (e.voucher.narration || "").slice(0, 80) }))
        },
        elsewhereSample: elsewhere.map(e => ({
            no: e.voucher.voucherNo, type: e.voucher.voucherType, side: e.entryType, amount: Number(e.amount),
            ledger: e.ledger.name, category: e.ledger.category, group: e.ledger.group?.name
        }))
    }, null, 2));
    fs.writeFileSync(".tmp-odcc-bom-missing.json", JSON.stringify({ missing, extraIds: extra.map(e => e.id) }));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
