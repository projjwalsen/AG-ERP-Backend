import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const WIDE_START = new Date("2025-03-30T18:30:00.000Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const xlType = (t: string) => {
    const n = norm(t);
    if (n === "CONTRA") return "CONTRA";
    if (n.includes("RECEIPT")) return "RECEIPT";
    if (n.includes("PAYMENT") || n.includes("SALARY")) return "PAYMENT";
    if (n === "JOURNAL") return "JOURNAL";
    return n;
};

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-unsec-excel.json", "utf8"));
    const summary: any[] = [];

    for (const xl of extract.ledgers) {
        const copies = await prisma.ledger.findMany({
            where: { name: { equals: xl.ledger, mode: "insensitive" } },
            select: {
                id: true, name: true, category: true, branchId: true, isActive: true,
                group: { select: { id: true, name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
            }
        });
        const scored = [];
        for (const c of copies) {
            const nPer = await prisma.ledgerEntry.count({
                where: {
                    ledgerId: c.id,
                    voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: WIDE_START, lte: END } }
                }
            });
            const path = `${c.group?.parent?.parent?.name || ""} > ${c.group?.parent?.name || ""} > ${c.group?.name}`;
            const underLoans = /Loans \(Liability\)/i.test(path) ? 1 : 0;
            scored.push({ ...c, nPer, path, underLoans });
        }
        scored.sort((a, b) => b.underLoans - a.underLoans || b.nPer - a.nPer);
        const canon = scored.find(c => c.underLoans && c.category === "JOURNAL") || scored[0];
        if (!canon) {
            summary.push({ ledger: xl.ledger, group: xl.group, missingLedger: true, excelN: xl.n });
            continue;
        }

        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: canon.id,
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: WIDE_START, lte: END } }
            },
            select: {
                id: true, entryType: true, amount: true, voucherId: true,
                voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
            }
        });
        const openings = await prisma.ledgerEntry.findMany({
            where: { ledgerId: canon.id, voucher: { voucherType: "OPENING_BALANCE" } },
            select: { id: true, entryType: true, amount: true }
        });

        const used = new Set<string>();
        const byNSA = new Map<string, any[]>();
        for (const e of entries) {
            const k = `${norm(e.voucher.voucherNo)}|${e.entryType}|${cents(e.amount)}`;
            byNSA.set(k, [...(byNSA.get(k) || []), e]);
        }
        let matched = 0;
        const missing: any[] = [];
        for (const row of xl.vouchers) {
            const k = `${norm(row.no)}|${row.side}|${cents(row.amount)}`;
            const hit = (byNSA.get(k) || []).find((h: any) => !used.has(h.id));
            if (hit) { used.add(hit.id); matched += 1; }
            else missing.push(row);
        }
        const extra = entries.filter(e => !used.has(e.id));
        let perDr = 0, perCr = 0;
        for (const e of entries) {
            if (e.entryType === "DEBIT") perDr += cents(e.amount); else perCr += cents(e.amount);
        }
        let openDr = 0, openCr = 0;
        for (const e of openings) {
            if (e.entryType === "DEBIT") openDr += cents(e.amount); else openCr += cents(e.amount);
        }
        const xlOpen = xl.openings[0] || null;
        const xlClose = xl.closing;
        const closeSigned = openDr - openCr + perDr - perCr;
        const wantOpen = xlOpen ? (xlOpen.side === "DEBIT" ? cents(xlOpen.amount) : -cents(xlOpen.amount)) : 0;
        const wantClose = xlClose
            ? (xlClose.side === "DEBIT" ? -cents(xlClose.amount) : cents(xlClose.amount))
            : wantOpen + cents(xl.perDr) - cents(xl.perCr);
        // Tally ledger print puts closing on the lighter side: Debit column amount means closing CREDIT for a credit ledger
        // Excel closing.side DEBIT with amount X means closing Cr X (shown on debit column in Tally).
        const wantCloseSigned = xlClose
            ? (xlClose.side === "DEBIT" ? -cents(xlClose.amount) : cents(xlClose.amount))
            : 0;

        summary.push({
            ledger: xl.ledger,
            group: xl.group,
            canonId: canon.id,
            path: canon.path,
            copies: scored.map(c => ({ id: c.id, path: c.path, nPer: c.nPer, cat: c.category })),
            excel: { n: xl.n, dr: xl.perDr, cr: xl.perCr, open: xlOpen, close: xlClose, wantCloseSigned: money(wantCloseSigned) },
            db: {
                n: entries.length, dr: money(perDr), cr: money(perCr),
                openDr: money(openDr), openCr: money(openCr),
                closeSigned: money(closeSigned)
            },
            dDr: money(perDr - cents(xl.perDr)),
            dCr: money(perCr - cents(xl.perCr)),
            matched, missing: missing.length, extra: extra.length,
            missByType: missing.reduce((a: any, r: any) => {
                a[r.type] = a[r.type] || { n: 0, dr: 0, cr: 0 };
                a[r.type].n += 1;
                if (r.side === "DEBIT") a[r.type].dr += r.amount; else a[r.type].cr += r.amount;
                return a;
            }, {}),
            missSample: missing.slice(0, 4),
            extraSample: extra.slice(0, 5).map(e => ({
                no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
                side: e.entryType, amount: Number(e.amount)
            }))
        });
    }

    console.log(JSON.stringify(summary.map(s => ({
        ledger: s.ledger, group: s.group, path: s.path,
        excelN: s.excel.n, dbN: s.db.n, matched: s.matched, missing: s.missing, extra: s.extra,
        dDr: s.dDr, dCr: s.dCr,
        dbClose: s.db.closeSigned, wantClose: s.excel.wantCloseSigned,
        openCr: s.db.openCr, xlOpen: s.excel.open?.amount || 0,
        copies: s.copies.length
    })), null, 2));
    fs.writeFileSync(".tmp-unsec-compare.json", JSON.stringify(summary, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
