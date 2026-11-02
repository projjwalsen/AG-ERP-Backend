import "dotenv/config";
import { prisma } from "./src/config/db";
import * as fs from "fs";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const FOCUS = [
    "AVNTIKA ENTERPRISE CRS",
    "CLASSIC PETRO & ENERGY PRIVATE LIMITED CRS",
    "Darsh Enterprises (CR)",
    "EMIT INTERNATIONAL FZ LLC",
    "GLOBAL PLASTO CHEM",
    "INDIAN OIL CORPORATION LIMITED - MH",
    "RAAJ UNOCAL LUBRICANTS LTD",
    "SIGMA PETROCHEM",
    "SILVERBACK INFRA PRIVATE LIMITED"
];

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: { name: { in: FOCUS } },
        select: {
            id: true, name: true, category: true, isActive: true, branchId: true,
            openingDebit: true, openingCredit: true, openingBalance: true, openingBalanceDate: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });
    const byName: Record<string, any> = {};
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherDate: { gte: START, lte: END }, voucherType: { not: "OPENING_BALANCE" } } },
            select: {
                id: true, entryType: true, amount: true, narration: true, voucherId: true,
                voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true, totalDebit: true, totalCredit: true } }
            },
            orderBy: { voucher: { voucherDate: "asc" } }
        });
        const openings = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherType: "OPENING_BALANCE" } },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: { select: { id: true, voucherNo: true, voucherDate: true } }
            }
        });
        const path = `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`;
        const row = {
            id: l.id, cat: l.category, active: l.isActive, path,
            ledgerOpen: { d: Number(l.openingDebit || 0), c: Number(l.openingCredit || 0), b: Number(l.openingBalance || 0), date: l.openingBalanceDate },
            openings: openings.map(o => ({
                id: o.id, side: o.entryType, amt: Number(o.amount), narr: o.narration,
                date: localDate(o.voucher.voucherDate), no: o.voucher.voucherNo
            })),
            n: entries.length,
            dr: money(entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0)),
            cr: money(entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0)),
            byType: entries.reduce((a: any, e) => {
                const t = e.voucher.voucherType;
                a[t] = a[t] || { n: 0, dr: 0, cr: 0 };
                a[t].n += 1;
                if (e.entryType === "DEBIT") a[t].dr += Number(e.amount); else a[t].cr += Number(e.amount);
                return a;
            }, {}),
            sample: entries.slice(0, 8).map(e => ({
                no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
                side: e.entryType, amt: Number(e.amount), narr: (e.narration || "").slice(0, 80)
            }))
        };
        (byName[l.name] ||= []).push(row);
    }

    // For CLASSIC/Darsh/SIGMA/GLOBAL/SILVERBACK: compare inactive vs active voucher keys
    const compareDup = async (name: string) => {
        const copies = ledgers.filter(l => l.name === name);
        if (copies.length < 2) return { name, copies: copies.length };
        const all: any[] = [];
        for (const c of copies) {
            const es = await prisma.ledgerEntry.findMany({
                where: { ledgerId: c.id, voucher: { voucherDate: { gte: START, lte: END }, voucherType: { not: "OPENING_BALANCE" } } },
                select: {
                    id: true, ledgerId: true, entryType: true, amount: true,
                    voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
                }
            });
            all.push(...es.map(e => ({
                copy: c.isActive ? "active" : "inactive",
                ledgerId: c.id,
                id: e.id,
                key: `${e.voucher.voucherType}|${e.voucher.voucherNo || ""}|${e.entryType}|${cents(e.amount)}`,
                no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
                side: e.entryType, amt: Number(e.amount)
            })));
        }
        const activeKeys = new Set(all.filter(x => x.copy === "active").map(x => x.key));
        const inactiveOnly = all.filter(x => x.copy === "inactive" && !activeKeys.has(x.key));
        const inactiveDup = all.filter(x => x.copy === "inactive" && activeKeys.has(x.key));
        return {
            name,
            inactiveOnlyN: inactiveOnly.length,
            inactiveOnlyDr: money(inactiveOnly.filter(x => x.side === "DEBIT").reduce((s, x) => s + cents(x.amt), 0)),
            inactiveOnlyCr: money(inactiveOnly.filter(x => x.side === "CREDIT").reduce((s, x) => s + cents(x.amt), 0)),
            inactiveDupN: inactiveDup.length,
            inactiveDupDr: money(inactiveDup.filter(x => x.side === "DEBIT").reduce((s, x) => s + cents(x.amt), 0)),
            inactiveDupCr: money(inactiveDup.filter(x => x.side === "CREDIT").reduce((s, x) => s + cents(x.amt), 0)),
            inactiveOnly: inactiveOnly.slice(0, 30)
        };
    };

    const dups = [];
    for (const n of ["CLASSIC PETRO & ENERGY PRIVATE LIMITED CRS", "Darsh Enterprises (CR)", "SIGMA PETROCHEM", "GLOBAL PLASTO CHEM", "SILVERBACK INFRA PRIVATE LIMITED"]) {
        dups.push(await compareDup(n));
    }

    fs.writeFileSync(".tmp-advsc-gaps.json", JSON.stringify({ byName, dups }, null, 2));
    console.log(JSON.stringify({
        names: Object.fromEntries(Object.entries(byName).map(([k, v]: any) => [k, v.map((r: any) => ({
            id: r.id, cat: r.cat, active: r.active, path: r.path, ledgerOpen: r.ledgerOpen,
            openings: r.openings, n: r.n, dr: r.dr, cr: r.cr, byType: r.byType
        }))])),
        dups
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
