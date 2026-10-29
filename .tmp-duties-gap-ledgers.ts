import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "fdd97fd1-f05b-4cce-8524-738751747f80";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/_x000D_/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-duties-excel-extract.json", "utf8"));
    const groups = await prisma.ledgerGroup.findMany();
    const byId = new Map(groups.map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const parts: string[] = [];
        let g = byId.get(id);
        const seen = new Set<string>();
        while (g && !seen.has(g.id)) {
            seen.add(g.id); parts.unshift(g.name);
            g = g.parentId ? byId.get(g.parentId) : undefined;
        }
        return parts.join(" > ");
    };
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const names = [
        "INPUT IGST 18%",
        "TDS ON SALARY",
        "TDS ON COMMISSION",
        "TDS ON INTEREST ON UNSECURED LOAN",
        "TDS ON CONTRACT"
    ];
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] }, name: { in: names, mode: "insensitive" } },
        select: { id: true, name: true, groupId: true }
    });
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgers.map(l => l.id) },
            OR: [{ branchId: BRANCH_ID }, { branchId: null, voucher: { branchId: BRANCH_ID } }]
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            voucher: { select: { voucherType: true, voucherDate: true, voucherNo: true, narration: true } }
        }
    });
    const ledgerById = new Map(ledgers.map(l => [l.id, l]));

    const excelByName = new Map<string, any[]>();
    for (const row of extract.vouchers) {
        const k = norm(row.name);
        if (!names.some(n => norm(n) === k)) continue;
        const arr = excelByName.get(k) || [];
        arr.push(row);
        excelByName.set(k, arr);
    }

    const result: any = {};
    for (const name of names) {
        const k = norm(name);
        const ls = ledgers.filter(l => norm(l.name) === k);
        const es = entries.filter(e => ls.some(l => l.id === e.ledgerId) && e.voucher.voucherType !== "OPENING_BALANCE"
            && e.voucher.voucherDate >= START && e.voucher.voucherDate <= END);
        const xl = excelByName.get(k) || [];
        const used = new Set<string>();
        const unmatchedXl: any[] = [];
        for (const row of xl) {
            const hit = es.find(e => !used.has(e.id) && e.entryType === row.side && cents(e.amount) === cents(row.amount)
                && (row.date ? localDate(e.voucher.voucherDate) === row.date : true));
            const hit2 = hit || es.find(e => !used.has(e.id) && e.entryType === row.side && cents(e.amount) === cents(row.amount));
            if (hit2) used.add(hit2.id);
            else unmatchedXl.push({ no: row.no, type: row.type, side: row.side, amount: row.amount, date: row.date });
        }
        const extra = es.filter(e => !used.has(e.id)).map(e => {
            const l = ledgerById.get(e.ledgerId)!;
            return {
                id: e.id, ledgerId: e.ledgerId, path: pathOf(l.groupId),
                type: e.voucher.voucherType, no: e.voucher.voucherNo, date: localDate(e.voucher.voucherDate),
                side: e.entryType, amount: Number(e.amount),
                narration: String(e.voucher.narration || "").slice(0, 100)
            };
        });
        const extraDr = extra.filter(x => x.side === "DEBIT").reduce((s, x) => s + cents(x.amount), 0);
        const extraCr = extra.filter(x => x.side === "CREDIT").reduce((s, x) => s + cents(x.amount), 0);
        const missDr = unmatchedXl.filter(x => x.side === "DEBIT").reduce((s, x) => s + cents(x.amount), 0);
        const missCr = unmatchedXl.filter(x => x.side === "CREDIT").reduce((s, x) => s + cents(x.amount), 0);
        result[name] = {
            ledgers: ls.map(l => ({ id: l.id, path: pathOf(l.groupId) })),
            excel: xl.length, db: es.length, matched: used.size,
            unmatchedXl: unmatchedXl.length, unmatchedXlDr: money(missDr), unmatchedXlCr: money(missCr),
            extraDb: extra.length, extraDr: money(extraDr), extraCr: money(extraCr),
            unmatchedSample: unmatchedXl.slice(0, 8),
            extraSample: extra.slice(0, 12)
        };
    }
    fs.writeFileSync(".tmp-duties-gap-ledgers.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]: any) => [k, {
        ledgers: v.ledgers, excel: v.excel, db: v.db, matched: v.matched,
        unmatchedXl: v.unmatchedXl, unmatchedXlDr: v.unmatchedXlDr, unmatchedXlCr: v.unmatchedXlCr,
        extraDb: v.extraDb, extraDr: v.extraDr, extraCr: v.extraCr,
        unmatchedSample: v.unmatchedSample, extraSample: v.extraSample.slice(0, 6)
    }])), null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
