import "dotenv/config";
import { randomUUID } from "crypto";
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

async function refreshLedgers(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 200) {
        const chunk = unique.slice(i, i + 200);
        const inList = chunk.map(id => `'${id}'`).join(",");
        await prisma.$executeRawUnsafe(`
            WITH ledgers AS (
                SELECT l.id,
                    CASE WHEN l."openingDebit" <> 0 OR l."openingCredit" <> 0
                        THEN l."openingDebit" - l."openingCredit"
                        ELSE CASE WHEN l.nature = 'CREDIT' THEN -l."openingBalance" ELSE l."openingBalance" END
                    END AS opening
                FROM "Ledger" l
                WHERE l.id IN (${inList})
            ),
            entries AS (
                SELECT e."ledgerId",
                    SUM(CASE WHEN e."entryType" = 'DEBIT' THEN e.amount ELSE -e.amount END) AS net
                FROM "LedgerEntry" e
                WHERE e."ledgerId" IN (${inList})
                GROUP BY e."ledgerId"
            )
            UPDATE "Ledger" l
            SET "currentBalance" = ledgers.opening + COALESCE(entries.net, 0),
                "updatedAt" = NOW()
            FROM ledgers
            LEFT JOIN entries ON entries."ledgerId" = ledgers.id
            WHERE l.id = ledgers.id
        `);
    }
}

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-duties-excel-extract.json", "utf8"));
    const groups = await prisma.ledgerGroup.findMany();
    const pathParts = new Map(groups.map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const parts: string[] = [];
        let g = pathParts.get(id);
        const seen = new Set<string>();
        while (g && !seen.has(g.id)) {
            seen.add(g.id); parts.unshift(g.name);
            g = g.parentId ? pathParts.get(g.parentId) : undefined;
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
        if (name === "DUTIES & TAXES") continue;
        const opts = tallyLedgers.filter(l => norm(l.name) === name)
            .sort((a, b) => {
                const aNested = pathOf(a.groupId).includes("Duties & Taxes > Duties & Taxes") ? 1 : 0;
                const bNested = pathOf(b.groupId).includes("Duties & Taxes > Duties & Taxes") ? 1 : 0;
                return aNested - bNested || (countMap.get(b.id) || 0) - (countMap.get(a.id) || 0);
            });
        if (opts[0]) targetByName.set(name, opts[0].id);
    }

    const [sales, purchases, notes] = await Promise.all([
        prisma.sale.findMany({ where: { branchId: BRANCH_ID }, select: { id: true, invoiceNo: true } }),
        prisma.purchase.findMany({ where: { branchId: BRANCH_ID }, select: { id: true, invoiceNo: true } }),
        prisma.debitCreditNote.findMany({ where: { branchId: BRANCH_ID }, select: { id: true, noteNo: true, voucherId: true } })
    ]);
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
    const noteByNo = new Map<string, string[]>();
    for (const n of notes) {
        const k = norm(n.noteNo);
        noteByNo.set(k, [...(noteByNo.get(k) || []), n.voucherId || n.id]);
    }

    const gstLike = ledgers.filter(l =>
        l.category === "GST" || /^(INPUT|OUTPUT)\s+GST\b/i.test(l.name) || /GST\s*-\s*AG_/i.test(l.name)
    );
    const searchIds = [...new Set([...tallyLedgers.map(l => l.id), ...gstLike.map(l => l.id)])];
    const entries: any[] = [];
    for (let i = 0; i < searchIds.length; i += 120) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: searchIds.slice(i, i + 120) },
                OR: [{ branchId: BRANCH_ID }, { branchId: null, voucher: { branchId: BRANCH_ID } }]
            },
            select: {
                id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
                ledger: { select: { name: true, groupId: true } },
                voucher: {
                    select: {
                        id: true, voucherType: true, voucherDate: true, voucherNo: true, sourceId: true,
                        _count: { select: { transaction: true, debitCreditNotes: true, entries: true } }
                    }
                }
            }
        }));
    }

    type Hit = {
        id: string; ledgerId: string; name: string; inTally: boolean; type: string;
        date: string; side: string; cents: number; no: string; voucherId: string;
        sourceId: string | null; tx: number; notes: number; entryCount: number; family: string;
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
            notes: e.voucher._count.debitCreditNotes, entryCount: e.voucher._count.entries,
            family: gstFamily(e.ledger.name)
        });
    }
    const push = (m: Map<string, Hit[]>, k: string, h: Hit) => { const a = m.get(k) || []; a.push(h); m.set(k, a); };
    const byTallyLDA = new Map<string, Hit[]>();
    const byTallyLA = new Map<string, Hit[]>();
    const bySource = new Map<string, Hit[]>();
    const byVoucherId = new Map<string, Hit[]>();
    for (const h of hits) {
        if (h.inTally) {
            push(byTallyLDA, `${h.name}|${h.date}|${h.side}|${h.cents}`, h);
            push(byTallyLA, `${h.name}|${h.side}|${h.cents}`, h);
        }
        if (h.sourceId) push(bySource, h.sourceId, h);
        push(byVoucherId, h.voucherId, h);
    }
    const prefer = (arr: Hit[], used: Set<string>, family: string, tallyFirst = true) => {
        const free = arr.filter(h => !used.has(h.id));
        return (tallyFirst ? free.find(h => h.inTally && (!family || h.family === family || !h.family)) : undefined)
            || free.find(h => !family || h.family === family)
            || (tallyFirst ? free.find(h => h.inTally) : undefined)
            || free[0];
    };

    const used = new Set<string>();
    const relink: any[] = [];
    let matched = 0;
    const stillMissing: any[] = [];

    for (const row of extract.vouchers) {
        const name = norm(row.name);
        const amt = cents(row.amount);
        const family = gstFamily(row.name);
        const target = targetByName.get(name);
        let hit = prefer(byTallyLDA.get(`${name}|${row.date}|${row.side}|${amt}`) || [], used, family);
        if (!hit) hit = prefer(byTallyLA.get(`${name}|${row.side}|${amt}`) || [], used, family);
        if (!hit) {
            const sourceIds = [
                ...(saleByNo.get(norm(row.no)) || []),
                ...(purchaseByNo.get(norm(row.no)) || [])
            ];
            const fromSource = sourceIds.flatMap(id => bySource.get(id) || [])
                .filter(h => h.side === row.side && h.cents === amt);
            hit = prefer(fromSource, used, family, false);
        }
        if (!hit) {
            const noteVoucherIds = (noteByNo.get(norm(row.no)) || []).filter(Boolean);
            const fromNote = noteVoucherIds.flatMap(id => byVoucherId.get(id) || [])
                .filter(h => h.side === row.side && h.cents === amt);
            hit = prefer(fromNote, used, family, false);
        }
        if (!hit) { stillMissing.push(row); continue; }
        used.add(hit.id);
        if (target && hit.ledgerId !== target) {
            relink.push({
                entryId: hit.id, voucherId: hit.voucherId, oldLedgerId: hit.ledgerId,
                targetLedgerId: target, oldName: hit.name, excelName: row.name,
                no: row.no, type: row.type, side: row.side, cents: amt
            });
        } else {
            matched += 1;
        }
    }

    const extraHits = hits.filter(h => h.inTally && !used.has(h.id));
    const extraByVoucher = new Map<string, Hit[]>();
    for (const h of extraHits) push(extraByVoucher, h.voucherId, h);
    const matchedVoucherIds = new Set(hits.filter(h => h.inTally && used.has(h.id)).map(h => h.voucherId));

    // Load ALL entries on extra vouchers to see if anything sits outside Duties.
    const extraVoucherIds = [...extraByVoucher.keys()];
    const extraVouchers = [];
    for (let i = 0; i < extraVoucherIds.length; i += 200) {
        extraVouchers.push(...await prisma.voucher.findMany({
            where: { id: { in: extraVoucherIds.slice(i, i + 200) } },
            select: {
                id: true, voucherType: true, voucherNo: true,
                entries: { select: { ledgerId: true, ledger: { select: { groupId: true } } } },
                _count: { select: { transaction: true, debitCreditNotes: true } }
            }
        }));
    }
    const deleteIds: string[] = [];
    let skipOutside = 0;
    for (const v of extraVouchers) {
        const outside = v.entries.some(e => !scopeIds.has(e.ledger.groupId));
        const hasMaster = v._count.transaction > 0 || v._count.debitCreditNotes > 0;
        const mixed = matchedVoucherIds.has(v.id);
        if (v.voucherType === "JOURNAL" && !outside && !hasMaster && !mixed) {
            deleteIds.push(v.id);
        } else skipOutside += 1;
    }

    const backup = { relink, deleteIds, stillMissing };
    fs.writeFileSync(".tmp-duties-recon-backup.json", JSON.stringify({
        relinkCount: relink.length, deleteCount: deleteIds.length, missing: stillMissing.length,
        relink, deleteIds, stillMissing
    }));

    for (let i = 0; i < relink.length; i += 200) {
        const chunk = relink.slice(i, i + 200);
        const values = chunk.map((row: any) => `('${row.entryId}','${row.targetLedgerId}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }

    for (let i = 0; i < deleteIds.length; i += 200) {
        const chunk = deleteIds.slice(i, i + 200);
        await prisma.journal.updateMany({ where: { voucherId: { in: chunk } }, data: { voucherId: null } });
        await prisma.voucher.deleteMany({ where: { id: { in: chunk } } });
    }

    const affected = [
        ...relink.flatMap((r: any) => [r.oldLedgerId, r.targetLedgerId]),
        ...extraHits.map(h => h.ledgerId)
    ];
    await refreshLedgers(affected);

    const missByType: Record<string, { n: number; dr: number; cr: number }> = {};
    for (const row of stillMissing) {
        missByType[row.type] = missByType[row.type] || { n: 0, dr: 0, cr: 0 };
        missByType[row.type].n += 1;
        if (row.side === "DEBIT") missByType[row.type].dr += cents(row.amount);
        else missByType[row.type].cr += cents(row.amount);
    }

    console.log(JSON.stringify({
        matchedOnTally: matched,
        relinked: relink.length,
        deletedJournalVouchers: deleteIds.length,
        skippedExtraVouchers: skipOutside,
        stillMissing: stillMissing.length,
        missByType: Object.fromEntries(Object.entries(missByType).map(([k, v]) => [k, { n: v.n, dr: money(v.dr), cr: money(v.cr) }])),
        extraHitsBeforeDelete: extraHits.length
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
