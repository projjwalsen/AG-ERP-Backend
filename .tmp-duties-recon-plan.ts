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
const INVOICE_TYPES = new Set(["Tax Invoice", "Purchase", "Inward Debit Note", "Inward Credit Note", "Outward Debit Note", "Outward Credit Note"]);

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
    const scopeIds = descendants(ROOT);
    const ledgers = await prisma.ledger.findMany({
        where: { OR: [{ branchId: BRANCH_ID }, { branchId: null }] },
        select: { id: true, name: true, groupId: true, category: true }
    });
    const counts = await prisma.ledgerEntry.groupBy({
        by: ["ledgerId"],
        where: { ledgerId: { in: ledgers.map(l => l.id) } },
        _count: { id: true }
    });
    const countMap = new Map(counts.map(c => [c.ledgerId, c._count.id]));
    const tallyLedgers = ledgers.filter(l => scopeIds.has(l.groupId));
    const targetByName = new Map<string, string>();
    for (const name of new Set(tallyLedgers.map(l => norm(l.name)))) {
        const opts = tallyLedgers.filter(l => norm(l.name) === name)
            .sort((a, b) => {
                const aNested = pathOf(a.groupId).includes("Duties & Taxes > Duties & Taxes") ? 1 : 0;
                const bNested = pathOf(b.groupId).includes("Duties & Taxes > Duties & Taxes") ? 1 : 0;
                return aNested - bNested || (countMap.get(b.id) || 0) - (countMap.get(a.id) || 0);
            });
        if (opts[0] && norm(opts[0].name) !== "DUTIES & TAXES") targetByName.set(name, opts[0].id);
    }

    const tallyIds = tallyLedgers.map(l => l.id);
    const gstLike = ledgers.filter(l =>
        l.category === "GST" ||
        /^(INPUT|OUTPUT)\s+GST\b/i.test(l.name) ||
        /GST\s*-\s*AG_/i.test(l.name)
    );
    const searchIds = [...new Set([...tallyIds, ...gstLike.map(l => l.id)])];
    const entries: any[] = [];
    for (let i = 0; i < searchIds.length; i += 120) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: searchIds.slice(i, i + 120) },
                OR: [{ branchId: BRANCH_ID }, { branchId: null, voucher: { branchId: BRANCH_ID } }]
            },
            select: {
                id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
                ledger: { select: { name: true, groupId: true, category: true } },
                voucher: {
                    select: {
                        id: true, voucherType: true, voucherDate: true, voucherNo: true, sourceId: true,
                        _count: { select: { transaction: true, debitCreditNotes: true, journals: true, entries: true } }
                    }
                }
            }
        }));
    }

    type Hit = {
        id: string; ledgerId: string; name: string; inTally: boolean; type: string;
        date: string; side: string; cents: number; no: string; voucherId: string;
        sourceId: string | null; tx: number; notes: number; journals: number; entryCount: number;
    };
    const hits: Hit[] = [];
    for (const e of entries) {
        if (e.voucher.voucherType === "OPENING_BALANCE") continue;
        const d = e.voucher.voucherDate;
        if (d < START || d > END) continue;
        hits.push({
            id: e.id, ledgerId: e.ledgerId, name: norm(e.ledger.name),
            inTally: scopeIds.has(e.ledger.groupId), type: e.voucher.voucherType,
            date: localDate(d), side: e.entryType, cents: cents(e.amount),
            no: String(e.voucher.voucherNo || ""), voucherId: e.voucherId,
            sourceId: e.voucher.sourceId, tx: e.voucher._count.transaction,
            notes: e.voucher._count.debitCreditNotes, journals: e.voucher._count.journals,
            entryCount: e.voucher._count.entries
        });
    }
    const push = (m: Map<string, Hit[]>, k: string, h: Hit) => { const a = m.get(k) || []; a.push(h); m.set(k, a); };
    const byTallyLDA = new Map<string, Hit[]>();
    const byTallyLA = new Map<string, Hit[]>();
    const byNoAmt = new Map<string, Hit[]>();
    const byVoucherAmt = new Map<string, Hit[]>();
    for (const h of hits) {
        if (h.inTally) {
            push(byTallyLDA, `${h.name}|${h.date}|${h.side}|${h.cents}`, h);
            push(byTallyLA, `${h.name}|${h.side}|${h.cents}`, h);
        }
        push(byNoAmt, `${norm(h.no)}|${h.side}|${h.cents}`, h);
        push(byVoucherAmt, `${h.voucherId}|${h.side}|${h.cents}`, h);
    }
    const pick = (arr: Hit[] | undefined, used: Set<string>, preferTally = true) =>
        (arr || []).find(h => !used.has(h.id) && (!preferTally || h.inTally)) ||
        (arr || []).find(h => !used.has(h.id));

    const used = new Set<string>();
    const relink: any[] = [];
    const missing: any[] = [];
    let matched = 0;
    for (const row of extract.vouchers) {
        const name = norm(row.name);
        const amt = cents(row.amount);
        const a = pick(byTallyLDA.get(`${name}|${row.date}|${row.side}|${amt}`), used);
        if (a) { used.add(a.id); matched += 1; continue; }
        const b = pick(byTallyLA.get(`${name}|${row.side}|${amt}`), used);
        if (b) { used.add(b.id); matched += 1; continue; }
        const c = pick(byNoAmt.get(`${norm(row.no)}|${row.side}|${amt}`), used, false);
        if (c) {
            used.add(c.id);
            const target = targetByName.get(name);
            if (target && c.ledgerId !== target) {
                relink.push({
                    entryId: c.id, voucherId: c.voucherId, oldLedgerId: c.ledgerId,
                    oldName: c.name, targetLedgerId: target, excelName: row.name,
                    no: row.no, type: row.type, side: row.side, cents: amt, date: row.date,
                    fromTally: c.inTally
                });
            } else {
                matched += 1;
            }
            continue;
        }
        missing.push(row);
    }

    // Second pass: match remaining invoice rows to GST operational entries
    // on the same voucher number even if amount sits on a differently named GST ledger.
    const stillMissing: any[] = [];
    for (const row of missing) {
        const name = norm(row.name);
        const amt = cents(row.amount);
        const hitsNo = (byNoAmt.get(`${norm(row.no)}|${row.side}|${amt}`) || []).filter(h => !used.has(h.id));
        const gstHit = hitsNo.find(h => h.type === "SALE" || h.type === "PURCHASE" || h.type === "DEBIT_NOTE" || h.type === "CREDIT_NOTE" || h.type === "RCM_PURCHASE")
            || hitsNo[0];
        const target = targetByName.get(name);
        if (gstHit && target) {
            used.add(gstHit.id);
            relink.push({
                entryId: gstHit.id, voucherId: gstHit.voucherId, oldLedgerId: gstHit.ledgerId,
                oldName: gstHit.name, targetLedgerId: target, excelName: row.name,
                no: row.no, type: row.type, side: row.side, cents: amt, date: row.date,
                fromTally: gstHit.inTally
            });
            continue;
        }
        stillMissing.push(row);
    }

    const extraHits = hits.filter(h => h.inTally && !used.has(h.id));
    const extraByVoucher = new Map<string, Hit[]>();
    for (const h of extraHits) push(extraByVoucher, h.voucherId, h);
    const matchedHits = hits.filter(h => h.inTally && used.has(h.id));
    const matchedVoucherIds = new Set(matchedHits.map(h => h.voucherId));

    const deleteVouchers: any[] = [];
    const skipDelete: any[] = [];
    for (const [voucherId, extras] of extraByVoucher) {
        const sample = extras[0];
        const hasMaster = sample.tx > 0 || sample.notes > 0;
        const isJournal = sample.type === "JOURNAL";
        const mixed = matchedVoucherIds.has(voucherId);
        if (isJournal && !hasMaster && !mixed) {
            deleteVouchers.push({
                voucherId, type: sample.type, no: sample.no, date: sample.date,
                entries: extras.length, dr: extras.filter(e => e.side === "DEBIT").reduce((s, e) => s + e.cents, 0),
                cr: extras.filter(e => e.side === "CREDIT").reduce((s, e) => s + e.cents, 0)
            });
        } else {
            skipDelete.push({ voucherId, type: sample.type, mixed, hasMaster, n: extras.length });
        }
    }

    const missByType: Record<string, { n: number; dr: number; cr: number }> = {};
    for (const row of stillMissing) {
        const t = row.type;
        missByType[t] = missByType[t] || { n: 0, dr: 0, cr: 0 };
        missByType[t].n += 1;
        if (row.side === "DEBIT") missByType[t].dr += cents(row.amount); else missByType[t].cr += cents(row.amount);
    }

    const plan = {
        matched,
        relink: relink.length,
        relinkFromOutside: relink.filter(r => !r.fromTally).length,
        relinkWithinTally: relink.filter(r => r.fromTally).length,
        stillMissing: stillMissing.length,
        missByType: Object.fromEntries(Object.entries(missByType).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }])),
        extraHits: extraHits.length,
        extraDr: money(extraHits.filter(h => h.side === "DEBIT").reduce((s, h) => s + h.cents, 0)),
        extraCr: money(extraHits.filter(h => h.side === "CREDIT").reduce((s, h) => s + h.cents, 0)),
        deleteVouchers: deleteVouchers.length,
        deleteDr: money(deleteVouchers.reduce((s, v) => s + v.dr, 0)),
        deleteCr: money(deleteVouchers.reduce((s, v) => s + v.cr, 0)),
        skipDelete: skipDelete.length,
        skipDeleteByType: skipDelete.reduce((m: any, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {}),
        targets: targetByName.size,
        stillMissingSample: stillMissing.slice(0, 8),
        relinkSample: relink.slice(0, 8)
    };
    fs.writeFileSync(".tmp-duties-recon-plan.json", JSON.stringify({
        ...plan,
        relinkRows: relink,
        deleteVoucherIds: deleteVouchers.map(v => v.voucherId),
        stillMissing
    }));
    console.log(JSON.stringify(plan, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
