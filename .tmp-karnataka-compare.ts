import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const CANON = "c3002d61-8da2-4001-abe4-d6f9c8d33d5f";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const WIDE_START = new Date("2025-03-30T18:30:00.000Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const pdf = JSON.parse(fs.readFileSync(".tmp-karnataka-pdf.json", "utf8"));
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: CANON,
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: WIDE_START, lte: END } }
        },
        select: {
            id: true, entryType: true, amount: true, voucherId: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });
    const used = new Set<string>();
    const byNSA = new Map<string, any[]>();
    for (const e of entries) {
        const k = `${norm(e.voucher.voucherNo)}|${e.entryType}|${cents(e.amount)}`;
        byNSA.set(k, [...(byNSA.get(k) || []), e]);
    }
    const missing: any[] = [];
    let matched = 0;
    for (const row of pdf.vouchers) {
        const k = `${norm(row.no)}|${row.side}|${cents(row.amount)}`;
        const hit = (byNSA.get(k) || []).find((h: any) => !used.has(h.id));
        if (hit) { used.add(hit.id); matched += 1; }
        else missing.push(row);
    }
    const extra = entries.filter(e => !used.has(e.id));
    const missByType = missing.reduce((a: any, r: any) => {
        a[r.type] = a[r.type] || { n: 0, dr: 0, cr: 0 };
        a[r.type].n += 1;
        if (r.side === "DEBIT") a[r.type].dr += r.amount; else a[r.type].cr += r.amount;
        return a;
    }, {});
    console.log(JSON.stringify({
        pdfN: pdf.n, dbN: entries.length, matched, missing: missing.length, extra: extra.length,
        missDr: money(missing.filter((r: any) => r.side === "DEBIT").reduce((s: number, r: any) => s + cents(r.amount), 0)),
        missCr: money(missing.filter((r: any) => r.side === "CREDIT").reduce((s: number, r: any) => s + cents(r.amount), 0)),
        extraDr: money(extra.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0)),
        extraCr: money(extra.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0)),
        missByType,
        missSample: missing,
        extraSample: extra.map(e => ({
            id: e.id, no: e.voucher.voucherNo, type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate), side: e.entryType, amount: Number(e.amount)
        }))
    }, null, 2));
    fs.writeFileSync(".tmp-karnataka-compare.json", JSON.stringify({ missing, extra: extra.map(e => e.id) }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
