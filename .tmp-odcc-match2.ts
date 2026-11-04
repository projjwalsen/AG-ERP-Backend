import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T00:00:00.000Z"); // include 31 Mar UTC that is still FY in Tally
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const CANON_BOM = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const CANON_BOB = "9b5650be-5530-4401-8515-933dda455174";
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
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    const typeCounts: Record<string, number> = {};
    for (const r of bomXl.vouchers) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;

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

    type Hit = { id: string; no: string; side: string; cents: number; date: string; type: string; ledgerId: string; voucherId: string; rawType: string };
    const hits: Hit[] = bomEntries.map(e => ({
        id: e.id, no: norm(e.voucher.voucherNo), side: e.entryType, cents: cents(e.amount),
        date: localDate(e.voucher.voucherDate), type: xlType(e.voucher.voucherType),
        rawType: e.voucher.voucherType, ledgerId: e.ledgerId, voucherId: e.voucherId
    }));

    const used = new Set<string>();
    const push = (m: Map<string, Hit[]>, k: string, h: Hit) => { const a = m.get(k) || []; a.push(h); m.set(k, a); };
    const byNTSA = new Map<string, Hit[]>();
    const byNSA = new Map<string, Hit[]>();
    const byDSA = new Map<string, Hit[]>();
    const bySA = new Map<string, Hit[]>();
    for (const h of hits) {
        push(byNTSA, `${h.no}|${h.type}|${h.side}|${h.cents}`, h);
        push(byNSA, `${h.no}|${h.side}|${h.cents}`, h);
        push(byDSA, `${h.date}|${h.side}|${h.cents}`, h);
        push(bySA, `${h.side}|${h.cents}`, h);
    }
    const prefer = (arr: Hit[], date?: string) => {
        const free = arr.filter(h => !used.has(h.id));
        if (date) {
            const same = free.filter(h => h.date === date);
            if (same.length) return same[0];
        }
        return free[0];
    };

    let matched = 0;
    const missing: any[] = [];
    const how: Record<string, number> = { ntsa: 0, nsa: 0, dsa: 0, none: 0 };
    for (const row of bomXl.vouchers) {
        const no = norm(row.no);
        const type = xlType(row.type);
        const amt = cents(row.amount);
        let hit = prefer(byNTSA.get(`${no}|${type}|${row.side}|${amt}`) || [], row.date);
        if (hit) { how.ntsa += 1; used.add(hit.id); matched += 1; continue; }
        hit = prefer(byNSA.get(`${no}|${row.side}|${amt}`) || [], row.date);
        if (hit) { how.nsa += 1; used.add(hit.id); matched += 1; continue; }
        hit = prefer(byDSA.get(`${row.date}|${row.side}|${amt}`) || []);
        if (hit) { how.dsa += 1; used.add(hit.id); matched += 1; continue; }
        how.none += 1;
        missing.push(row);
    }
    const extra = hits.filter(h => !used.has(h.id));

    const missByType: Record<string, { n: number; dr: number; cr: number }> = {};
    for (const r of missing) {
        missByType[r.type] = missByType[r.type] || { n: 0, dr: 0, cr: 0 };
        missByType[r.type].n += 1;
        if (r.side === "DEBIT") missByType[r.type].dr += cents(r.amount); else missByType[r.type].cr += cents(r.amount);
    }

    // Find relink candidates for missing
    const SAFE_NAMES = new Set(["BANK ACCOUNTS"]);
    const missNos = [...new Set(missing.map((r: any) => String(r.no)))].filter(Boolean);
    const candidates: any[] = [];
    for (let i = 0; i < missNos.length; i += 80) {
        const chunk = missNos.slice(i, i + 80);
        const rows = await prisma.ledgerEntry.findMany({
            where: {
                voucher: { branchId: BRANCH_ID, voucherNo: { in: chunk }, voucherType: { not: "OPENING_BALANCE" } }
            },
            select: {
                id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
                ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } },
                voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
            }
        });
        candidates.push(...rows);
    }

    const stealLedgers: Record<string, { n: number; amt: number; cat: string; group: string }> = {};
    const relinkPlan: any[] = [];
    const usedCand = new Set<string>();
    let stillMissing: any[] = [];
    for (const row of missing) {
        const amt = cents(row.amount);
        const type = xlType(row.type);
        const hitsC = candidates.filter(e =>
            !usedCand.has(e.id) &&
            !BOM_IDS.includes(e.ledgerId) &&
            !BOB_IDS.includes(e.ledgerId) &&
            norm(e.voucher.voucherNo) === norm(row.no) &&
            e.entryType === row.side &&
            cents(e.amount) === amt &&
            (xlType(e.voucher.voucherType) === type || true)
        );
        const ranked = hitsC.sort((a, b) => {
            const score = (e: any) => {
                let s = 0;
                if (xlType(e.voucher.voucherType) === type) s += 5;
                if (SAFE_NAMES.has(norm(e.ledger.name))) s += 8;
                if (e.ledger.category === "BANK") s += 4;
                if (norm(e.ledger.group?.name) === "BANK ACCOUNTS") s += 3;
                if (localDate(e.voucher.voucherDate) === row.date) s += 2;
                if (e.ledger.category === "CUSTOMER" || e.ledger.category === "VENDOR") s -= 20;
                if (/SUNDRY|DUTIES|TAX|CHARGES|CREDITOR|DEBTOR/i.test(e.ledger.name + " " + (e.ledger.group?.name || ""))) s -= 20;
                return s;
            };
            return score(b) - score(a);
        });
        const best = ranked[0];
        const bestScore = best ? (() => {
            const e = best;
            let s = 0;
            if (xlType(e.voucher.voucherType) === type) s += 5;
            if (SAFE_NAMES.has(norm(e.ledger.name))) s += 8;
            if (e.ledger.category === "BANK") s += 4;
            if (norm(e.ledger.group?.name) === "BANK ACCOUNTS") s += 3;
            if (localDate(e.voucher.voucherDate) === row.date) s += 2;
            if (e.ledger.category === "CUSTOMER" || e.ledger.category === "VENDOR") s -= 20;
            if (/SUNDRY|DUTIES|TAX|CHARGES|CREDITOR|DEBTOR/i.test(e.ledger.name + " " + (e.ledger.group?.name || ""))) s -= 20;
            return s;
        })() : -99;
        if (best && bestScore >= 4) {
            usedCand.add(best.id);
            relinkPlan.push({
                entryId: best.id, from: best.ledger.name, fromId: best.ledgerId,
                cat: best.ledger.category, group: best.ledger.group?.name,
                no: row.no, type: row.type, side: row.side, amount: row.amount, date: row.date,
                dbDate: localDate(best.voucher.voucherDate), dbType: best.voucher.voucherType, score: bestScore
            });
            const k = `${best.ledger.category}|${best.ledger.group?.name}|${best.ledger.name}`;
            stealLedgers[k] = stealLedgers[k] || { n: 0, amt: 0, cat: best.ledger.category, group: best.ledger.group?.name || "" };
            stealLedgers[k].n += 1;
            stealLedgers[k].amt += amt;
        } else {
            stillMissing.push({ ...row, cand: ranked.slice(0, 3).map((e: any) => ({
                name: e.ledger.name, cat: e.ledger.category, group: e.ledger.group?.name,
                type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate), side: e.entryType, amount: Number(e.amount)
            })) });
        }
    }

    const extraByType: Record<string, { n: number; dr: number; cr: number }> = {};
    for (const h of extra) {
        extraByType[h.rawType] = extraByType[h.rawType] || { n: 0, dr: 0, cr: 0 };
        extraByType[h.rawType].n += 1;
        if (h.side === "DEBIT") extraByType[h.rawType].dr += h.cents; else extraByType[h.rawType].cr += h.cents;
    }

    let bomDr = 0, bomCr = 0;
    for (const h of hits) {
        if (h.side === "DEBIT") bomDr += h.cents; else bomCr += h.cents;
    }

    console.log(JSON.stringify({
        excelTypes: typeCounts,
        excelN: bomXl.vouchers.length,
        excelDr: bomXl.perDr, excelCr: bomXl.perCr,
        dbN: hits.length, dbDr: money(bomDr), dbCr: money(bomCr),
        matched, how, missing: missing.length,
        missByType: Object.fromEntries(Object.entries(missByType).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }])),
        extra: extra.length,
        extraByType: Object.fromEntries(Object.entries(extraByType).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }])),
        extraSample: extra.slice(0, 15).map(h => ({ no: h.no, type: h.rawType, date: h.date, side: h.side, amount: money(h.cents) })),
        relink: relinkPlan.length,
        stealLedgers: Object.entries(stealLedgers).sort((a, b) => b[1].n - a[1].n)
            .map(([k, v]) => ({ k, n: v.n, amt: money(v.amt) })),
        stillMissing: stillMissing.length,
        stillByType: stillMissing.reduce((a: any, r: any) => {
            a[r.type] = a[r.type] || { n: 0, dr: 0, cr: 0 };
            a[r.type].n += 1;
            if (r.side === "DEBIT") a[r.type].dr += r.amount; else a[r.type].cr += r.amount;
            return a;
        }, {}),
        stillSample: stillMissing.slice(0, 12)
    }, null, 2));

    fs.writeFileSync(".tmp-odcc-relink-plan.json", JSON.stringify({ relinkPlan, extra, stillMissing }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
