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
const TYPE_MAP: Record<string, string> = {
    Payment: "PAYMENT",
    Receipt: "RECEIPT",
    Purchase: "PURCHASE",
    "RCM Purchase": "RCM_PURCHASE",
    Journal: "JOURNAL",
    "Journal Expenses": "JOURNAL",
    "Salary Journal": "JOURNAL",
    "Inward Debit Note": "DEBIT_NOTE",
    "Inward Credit Note": "CREDIT_NOTE",
    "Outward Debit Note": "DEBIT_NOTE",
    "Outward Credit Note": "CREDIT_NOTE",
    "RCM Debit Note": "DEBIT_NOTE",
    "CASH PAYMENT": "CASH_PAYMENT",
    "Tax Invoice": "SALE"
};

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
    const descendants = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                ids.add(g.id); changed = true;
            }
        }
        return ids;
    };
    const seeded = groups.find(g => g.code === "DUTIES_AND_TAXES");
    const scopeIds = descendants(ROOT);
    const seededIds = seeded ? descendants(seeded.id) : new Set<string>();

    const allLedgers = await prisma.ledger.findMany({
        where: { OR: [{ branchId: BRANCH_ID }, { branchId: null }] },
        select: { id: true, name: true, groupId: true, category: true, branchId: true }
    });
    const tallyLedgers = allLedgers.filter(l => scopeIds.has(l.groupId));
    const seededLedgers = allLedgers.filter(l => seededIds.has(l.groupId));
    const tallyByName = new Map<string, typeof tallyLedgers>();
    for (const l of tallyLedgers) {
        const k = norm(l.name);
        tallyByName.set(k, [...(tallyByName.get(k) || []), l]);
    }

    const entries: any[] = [];
    const ids = [...new Set([...tallyLedgers, ...seededLedgers].map(l => l.id))];
    for (let i = 0; i < ids.length; i += 150) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: ids.slice(i, i + 150) },
                OR: [
                    { branchId: BRANCH_ID },
                    { branchId: null, voucher: { branchId: BRANCH_ID } }
                ]
            },
            select: {
                id: true, ledgerId: true, entryType: true, amount: true,
                ledger: { select: { name: true, groupId: true } },
                voucher: { select: { id: true, voucherType: true, voucherDate: true, voucherNo: true } }
            }
        }));
    }
    const ledgerById = new Map(allLedgers.map(l => [l.id, l]));

    type Hit = { entryId: string; ledgerId: string; ledger: string; group: string; inTally: boolean; type: string; no: string; date: string; side: string; cents: number };
    const byKey = new Map<string, Hit[]>();
    const byNoAmt = new Map<string, Hit[]>();
    const push = (map: Map<string, Hit[]>, key: string, hit: Hit) => {
        const arr = map.get(key) || [];
        arr.push(hit); map.set(key, arr);
    };
    for (const e of entries) {
        const d = e.voucher.voucherDate;
        if (e.voucher.voucherType === "OPENING_BALANCE") continue;
        if (d < START || d > END) continue;
        const hit: Hit = {
            entryId: e.id,
            ledgerId: e.ledgerId,
            ledger: e.ledger.name,
            group: pathOf(e.ledger.groupId),
            inTally: scopeIds.has(e.ledger.groupId),
            type: e.voucher.voucherType,
            no: String(e.voucher.voucherNo || ""),
            date: localDate(d),
            side: e.entryType,
            cents: cents(e.amount)
        };
        push(byKey, `${norm(hit.ledger)}|${hit.date}|${norm(hit.no)}|${hit.side}|${hit.cents}`, hit);
        push(byNoAmt, `${hit.date}|${norm(hit.no)}|${hit.side}|${hit.cents}`, hit);
    }

    const used = new Set<string>();
    const matched: any[] = [];
    const missing: any[] = [];
    const wrongLedger: any[] = [];
    const wrongScope: any[] = [];
    let missDr = 0, missCr = 0, wrongDr = 0, wrongCr = 0, ok = 0;
    const missByType: Record<string, { n: number; dr: number; cr: number }> = {};
    const missByLedger: Record<string, { n: number; dr: number; cr: number }> = {};

    for (const row of extract.vouchers) {
        const name = norm(row.name);
        const date = row.date;
        const no = norm(row.no);
        const side = row.side;
        const amt = cents(row.amount);
        const exactKey = `${name}|${date}|${no}|${side}|${amt}`;
        const hits = (byKey.get(exactKey) || []).filter(h => !used.has(h.entryId));
        if (hits.length) {
            const prefer = hits.find(h => h.inTally) || hits[0];
            used.add(prefer.entryId);
            ok += 1;
            matched.push(1);
            continue;
        }
        const loose = (byNoAmt.get(`${date}|${no}|${side}|${amt}`) || []).filter(h => !used.has(h.entryId));
        const nameHit = loose.find(h => norm(h.ledger) === name) || loose[0];
        if (nameHit) {
            used.add(nameHit.entryId);
            if (scopeIds.has(ledgerById.get(nameHit.ledgerId)?.groupId || "")) {
                wrongLedger.push({ excel: row, hit: nameHit });
            } else {
                wrongScope.push({ excel: row, hit: nameHit });
            }
            if (side === "DEBIT") wrongDr += amt; else wrongCr += amt;
            continue;
        }
        missing.push(row);
        if (side === "DEBIT") missDr += amt; else missCr += amt;
        const t = row.type || "?";
        missByType[t] = missByType[t] || { n: 0, dr: 0, cr: 0 };
        missByType[t].n += 1;
        if (side === "DEBIT") missByType[t].dr += amt; else missByType[t].cr += amt;
        missByLedger[row.name] = missByLedger[row.name] || { n: 0, dr: 0, cr: 0 };
        missByLedger[row.name].n += 1;
        if (side === "DEBIT") missByLedger[row.name].dr += amt; else missByLedger[row.name].cr += amt;
    }

    const extras = entries.filter(e => {
        if (e.voucher.voucherType === "OPENING_BALANCE") return false;
        const d = e.voucher.voucherDate;
        if (d < START || d > END) return false;
        return scopeIds.has(e.ledger.groupId) && !used.has(e.id);
    });
    let extraDr = 0, extraCr = 0;
    const extraByType: Record<string, { n: number; dr: number; cr: number }> = {};
    const extraByLedger: Record<string, { n: number; dr: number; cr: number }> = {};
    for (const e of extras) {
        const amt = cents(e.amount);
        if (e.entryType === "DEBIT") extraDr += amt; else extraCr += amt;
        const t = e.voucher.voucherType;
        extraByType[t] = extraByType[t] || { n: 0, dr: 0, cr: 0 };
        extraByType[t].n += 1;
        if (e.entryType === "DEBIT") extraByType[t].dr += amt; else extraByType[t].cr += amt;
        const n = e.ledger.name;
        extraByLedger[n] = extraByLedger[n] || { n: 0, dr: 0, cr: 0 };
        extraByLedger[n].n += 1;
        if (e.entryType === "DEBIT") extraByLedger[n].dr += amt; else extraByLedger[n].cr += amt;
    }

    const toMoney = (obj: Record<string, { n: number; dr: number; cr: number }>) =>
        Object.fromEntries(Object.entries(obj).sort((a, b) => (b[1].dr + b[1].cr) - (a[1].dr + a[1].cr))
            .map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }]));

    console.log(JSON.stringify({
        excel: extract.vouchers.length,
        exactMatch: ok,
        wrongLedger: wrongLedger.length,
        wrongScope: wrongScope.length,
        missing: missing.length,
        extrasOnTally: extras.length,
        missDr: money(missDr), missCr: money(missCr),
        extraDr: money(extraDr), extraCr: money(extraCr),
        wrongDr: money(wrongDr), wrongCr: money(wrongCr),
        missByType: toMoney(missByType),
        extraByType: toMoney(extraByType),
        missByLedger: Object.fromEntries(Object.entries(toMoney(missByLedger)).slice(0, 20)),
        extraByLedger: Object.fromEntries(Object.entries(toMoney(extraByLedger)).slice(0, 20)),
        wrongScopeSample: wrongScope.slice(0, 8).map(x => ({
            excel: { name: x.excel.name, no: x.excel.no, type: x.excel.type, side: x.excel.side, amt: x.excel.amount, date: x.excel.date },
            hit: { ledger: x.hit.ledger, group: x.hit.group, type: x.hit.type, no: x.hit.no }
        })),
        missingSample: missing.slice(0, 8),
        extraSample: extras.slice(0, 8).map(e => ({
            ledger: e.ledger.name, type: e.voucher.voucherType, no: e.voucher.voucherNo,
            date: localDate(e.voucher.voucherDate), side: e.entryType, amt: Number(e.amount)
        })),
        seededLedgerCount: seededLedgers.length,
        tallyLedgerCount: tallyLedgers.length
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
