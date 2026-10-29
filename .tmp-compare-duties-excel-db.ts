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

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-duties-excel-extract.json", "utf8"));
    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
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
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true, category: true, groupId: true, isActive: true, branchId: true }
    });
    const entries: any[] = [];
    for (let i = 0; i < ledgers.length; i += 150) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: ledgers.slice(i, i + 150).map(l => l.id) },
                OR: [
                    { branchId: BRANCH_ID },
                    { branchId: null, voucher: { branchId: BRANCH_ID } }
                ]
            },
            select: {
                id: true, ledgerId: true, entryType: true, amount: true,
                voucher: { select: { voucherType: true, voucherDate: true, voucherNo: true } }
            }
        }));
    }
    const dbByName = new Map<string, any>();
    for (const l of ledgers) {
        const k = norm(l.name);
        const cur = dbByName.get(k) || {
            name: l.name, ids: [], cats: new Set(), groups: new Set(),
            openDr: 0, openCr: 0, perDr: 0, perCr: 0, nOpen: 0, nPer: 0, types: {} as Record<string, number>
        };
        cur.ids.push(l.id);
        cur.cats.add(l.category);
        cur.groups.add(pathOf(l.groupId));
        dbByName.set(k, cur);
    }
    const ledgerName = new Map(ledgers.map(l => [l.id, norm(l.name)]));
    for (const e of entries) {
        const k = ledgerName.get(e.ledgerId) || "";
        const row = dbByName.get(k);
        if (!row) continue;
        const amt = cents(e.amount);
        const isOpen = e.voucher.voucherType === "OPENING_BALANCE";
        const d = e.voucher.voucherDate;
        const inPeriod = d >= START && d <= END;
        row.types[e.voucher.voucherType] = (row.types[e.voucher.voucherType] || 0) + 1;
        if (isOpen) {
            row.nOpen += 1;
            if (e.entryType === "DEBIT") row.openDr += amt; else row.openCr += amt;
        } else if (inPeriod) {
            row.nPer += 1;
            if (e.entryType === "DEBIT") row.perDr += amt; else row.perCr += amt;
        }
    }

    const xlByName = new Map<string, any>();
    for (const r of extract.openings) {
        const k = norm(r.name);
        const cur = xlByName.get(k) || { name: r.name, openDr: 0, openCr: 0, perDr: 0, perCr: 0, nOpen: 0, nPer: 0 };
        cur.nOpen += 1;
        if (r.side === "DEBIT") cur.openDr += cents(r.amount); else cur.openCr += cents(r.amount);
        xlByName.set(k, cur);
    }
    for (const r of extract.vouchers) {
        const k = norm(r.name);
        const cur = xlByName.get(k) || { name: r.name, openDr: 0, openCr: 0, perDr: 0, perCr: 0, nOpen: 0, nPer: 0 };
        cur.nPer += 1;
        if (r.side === "DEBIT") cur.perDr += cents(r.amount); else cur.perCr += cents(r.amount);
        xlByName.set(k, cur);
    }

    const allNames = new Set([...xlByName.keys(), ...dbByName.keys()]);
    const diffs: any[] = [];
    let dbOpenDr = 0, dbOpenCr = 0, dbPerDr = 0, dbPerCr = 0;
    let xlOpenDr = 0, xlOpenCr = 0, xlPerDr = 0, xlPerCr = 0;
    for (const k of allNames) {
        const xl = xlByName.get(k) || { name: k, openDr: 0, openCr: 0, perDr: 0, perCr: 0, nOpen: 0, nPer: 0 };
        const db = dbByName.get(k);
        xlOpenDr += xl.openDr; xlOpenCr += xl.openCr; xlPerDr += xl.perDr; xlPerCr += xl.perCr;
        if (db) {
            dbOpenDr += db.openDr; dbOpenCr += db.openCr; dbPerDr += db.perDr; dbPerCr += db.perCr;
        }
        const dOpenDr = (db?.openDr || 0) - xl.openDr;
        const dOpenCr = (db?.openCr || 0) - xl.openCr;
        const dPerDr = (db?.perDr || 0) - xl.perDr;
        const dPerCr = (db?.perCr || 0) - xl.perCr;
        if (dOpenDr || dOpenCr || dPerDr || dPerCr || !db) {
            diffs.push({
                name: xl.name || db?.name,
                inDb: Boolean(db),
                ids: db?.ids?.length || 0,
                groups: db ? [...db.groups] : [],
                cats: db ? [...db.cats] : [],
                xl: { openDr: money(xl.openDr), openCr: money(xl.openCr), perDr: money(xl.perDr), perCr: money(xl.perCr), nOpen: xl.nOpen, nPer: xl.nPer },
                db: db ? { openDr: money(db.openDr), openCr: money(db.openCr), perDr: money(db.perDr), perCr: money(db.perCr), nOpen: db.nOpen, nPer: db.nPer, types: db.types } : null,
                dOpenDr: money(dOpenDr), dOpenCr: money(dOpenCr), dPerDr: money(dPerDr), dPerCr: money(dPerCr)
            });
        }
    }
    diffs.sort((a, b) => Math.abs(b.dPerDr) + Math.abs(b.dPerCr) - (Math.abs(a.dPerDr) + Math.abs(a.dPerCr)));

    const extraDbLedgers = [...dbByName.values()].filter(d => !xlByName.has(norm(d.name)) && (d.openDr || d.openCr || d.perDr || d.perCr))
        .map(d => ({ name: d.name, groups: [...d.groups], openDr: money(d.openDr), openCr: money(d.openCr), perDr: money(d.perDr), perCr: money(d.perCr) }));

    console.log(JSON.stringify({
        excel: { openDr: money(xlOpenDr), openCr: money(xlOpenCr), perDr: money(xlPerDr), perCr: money(xlPerCr) },
        db: { openDr: money(dbOpenDr), openCr: money(dbOpenCr), perDr: money(dbPerDr), perCr: money(dbPerCr), ledgers: ledgers.length, entries: entries.length },
        closingExcel: { openDr: 4493898.64, openCr: 10561093.14, closeDr: 229972.85, closeCr: 5628516.95 },
        tb: { openDr: 4493898.64, openCr: 10561093.14, perDr: 2591100459.26, perCr: 2483088659.18, closeDr: 1640549386.61, closeCr: 1538604781.03 },
        diffCount: diffs.length,
        diffs: diffs.slice(0, 60),
        extraDbLedgers
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
