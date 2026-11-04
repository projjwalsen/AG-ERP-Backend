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
const gstFamily = (name: string) => {
    const n = name.toUpperCase();
    if (/\bIGST\b/.test(n) || /INPUT IGST|OUTPUT IGST|IGST-/.test(n)) return "IGST";
    if (/\bSGST\b/.test(n) || /INPUT SGST|OUTPUT SGST|SGST-/.test(n)) return "SGST";
    if (/\bCGST\b/.test(n) || /INPUT CGST|OUTPUT CGST|CGST-/.test(n)) return "CGST";
    return "";
};

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-duties-excel-extract.json", "utf8"));
    const focus = new Set([
        "INPUT IGST 18%", "INPUT CGST 9%", "INPUT SGST 9%", "OUTPUT IGST 18%",
        "TCS ON SALE OF SCRAP 1%", "TDS ON PURCHASE OF GOODS @0.10%",
        "CGST ITC NOT REFLECTED IN GSTR-2B", "SGST ITC NOT REFLECTED IN GSTR-2B",
        "TDS ON CONTRACT"
    ]);
    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true }
    });
    const targetByName = new Map(ledgers.map(l => [norm(l.name), l.id]));
    const focusIds = ledgers.filter(l => focus.has(norm(l.name))).map(l => l.id);

    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: focusIds },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
            ledger: { select: { name: true } },
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, sourceId: true } }
        }
    });

    const sales = await prisma.sale.findMany({
        where: { branchId: BRANCH_ID },
        select: { id: true, invoiceNo: true }
    });
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID },
        select: { id: true, invoiceNo: true }
    });
    const saleByNo = new Map<string, string[]>();
    for (const s of sales) {
        const k = norm(s.invoiceNo);
        saleByNo.set(k, [...(saleByNo.get(k) || []), s.id]);
    }
    const purchaseByNo = new Map<string, string[]>();
    for (const p of purchases) {
        const k = norm(p.invoiceNo);
        purchaseByNo.set(k, [...(purchaseByNo.get(k) || []), p.id]);
    }

    type Hit = { id: string; name: string; side: string; cents: number; no: string; type: string; date: string; sourceId: string | null; voucherId: string };
    const hits: Hit[] = entries.map(e => ({
        id: e.id, name: norm(e.ledger.name), side: e.entryType, cents: cents(e.amount),
        no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
        sourceId: e.voucher.sourceId, voucherId: e.voucherId
    }));
    const used = new Set<string>();
    const byLDA = new Map<string, Hit[]>();
    const byLA = new Map<string, Hit[]>();
    const bySource = new Map<string, Hit[]>();
    const push = (m: Map<string, Hit[]>, k: string, h: Hit) => { const a = m.get(k) || []; a.push(h); m.set(k, a); };
    for (const h of hits) {
        push(byLDA, `${h.name}|${h.date}|${h.side}|${h.cents}`, h);
        push(byLA, `${h.name}|${h.side}|${h.cents}`, h);
        if (h.sourceId) push(bySource, h.sourceId, h);
    }
    const prefer = (arr: Hit[]) => arr.find(h => !used.has(h.id));

    const missing: any[] = [];
    const byType: Record<string, { n: number; dr: number; cr: number }> = {};
    for (const row of extract.vouchers) {
        if (!focus.has(norm(row.name))) continue;
        const name = norm(row.name);
        const amt = cents(row.amount);
        let hit = prefer(byLDA.get(`${name}|${row.date}|${row.side}|${amt}`) || []);
        if (!hit) hit = prefer(byLA.get(`${name}|${row.side}|${amt}`) || []);
        if (!hit) {
            const sourceIds = [...(saleByNo.get(norm(row.no)) || []), ...(purchaseByNo.get(norm(row.no)) || [])];
            hit = prefer(sourceIds.flatMap(id => bySource.get(id) || []).filter(h => h.side === row.side && h.cents === amt && h.name === name));
        }
        if (!hit) {
            missing.push(row);
            const t = row.type;
            byType[t] = byType[t] || { n: 0, dr: 0, cr: 0 };
            byType[t].n += 1;
            if (row.side === "DEBIT") byType[t].dr += amt; else byType[t].cr += amt;
        } else used.add(hit.id);
    }

    const missByName: Record<string, { n: number; dr: number; cr: number; sample: any[] }> = {};
    for (const row of missing) {
        const k = row.name;
        missByName[k] = missByName[k] || { n: 0, dr: 0, cr: 0, sample: [] };
        missByName[k].n += 1;
        if (row.side === "DEBIT") missByName[k].dr += cents(row.amount); else missByName[k].cr += cents(row.amount);
        if (missByName[k].sample.length < 5) missByName[k].sample.push({ no: row.no, type: row.type, side: row.side, amount: row.amount, date: row.date });
    }

    fs.writeFileSync(".tmp-duties-gap-ledgers.json", JSON.stringify({ missing, missByName, byType }, null, 2));
    console.log(JSON.stringify({
        missing: missing.length,
        byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }])),
        missByName: Object.fromEntries(Object.entries(missByName).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr), sample: v.sample }]))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
