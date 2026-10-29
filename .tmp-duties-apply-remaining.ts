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
const leaf = (value: unknown) => {
    const parts = String(value || "").replace(/\\/g, "/").split(/[/>]/)
        .map(p => p.replace(/_/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    return parts.length ? norm(parts[parts.length - 1]) : "";
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
    const backup = JSON.parse(fs.readFileSync(".tmp-duties-recon-backup.json", "utf8"));
    const missing: any[] = backup.stillMissing;
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
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true, groupId: true }
    });
    const counts = await prisma.ledgerEntry.groupBy({
        by: ["ledgerId"],
        where: { ledgerId: { in: ledgers.map(l => l.id) } },
        _count: { id: true }
    });
    const countMap = new Map(counts.map(c => [c.ledgerId, c._count.id]));
    const targetByName = new Map<string, string>();
    for (const name of new Set(ledgers.map(l => norm(l.name)))) {
        if (name === "DUTIES & TAXES") continue;
        const opts = ledgers.filter(l => norm(l.name) === name).sort((a, b) => {
            const aNested = pathOf(a.groupId).includes("Duties & Taxes > Duties & Taxes") ? 1 : 0;
            const bNested = pathOf(b.groupId).includes("Duties & Taxes > Duties & Taxes") ? 1 : 0;
            return aNested - bNested || (countMap.get(b.id) || 0) - (countMap.get(a.id) || 0);
        });
        if (opts[0]) targetByName.set(name, opts[0].id);
    }

    const noteNos = [...new Set(missing.filter(r => /note/i.test(r.type)).map(r => String(r.no)))];
    const notes = await prisma.debitCreditNote.findMany({
        where: { branchId: BRANCH_ID, noteNo: { in: noteNos } },
        select: {
            id: true, noteNo: true, categoryPath: true, voucherId: true, totalAmount: true,
            voucher: {
                select: {
                    id: true,
                    entries: {
                        select: {
                            id: true, ledgerId: true, entryType: true, amount: true,
                            ledger: { select: { name: true, category: true } }
                        }
                    }
                }
            }
        }
    });

    const saleNos = [...new Set(missing.filter(r => r.type === "Tax Invoice").map(r => String(r.no)))];
    const sales = await prisma.sale.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: saleNos } },
        select: { id: true, invoiceNo: true, tcsAmount: true }
    });
    const saleVouchers = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherType: "SALE", sourceId: { in: sales.map(s => s.id) } },
        select: {
            id: true, sourceId: true, branchId: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });
    const saleVoucherBySource = new Map(saleVouchers.map(v => [v.sourceId, v]));

    const purchaseNos = [...new Set(missing.filter(r => r.type === "Purchase").map(r => String(r.no)))];
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: purchaseNos } },
        select: { id: true, invoiceNo: true }
    });
    const purchaseVouchers = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherType: "PURCHASE", sourceId: { in: purchases.map(p => p.id) } },
        select: {
            id: true, sourceId: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });
    const purchaseVoucherBySource = new Map(purchaseVouchers.map(v => [v.sourceId, v]));

    const rcmNarration = "SKG TRANSPORT";
    const rcmVouchers = await prisma.voucher.findMany({
        where: {
            branchId: BRANCH_ID,
            voucherDate: { gte: START, lte: END },
            OR: [
                { narration: { contains: "APM/R2526/0001", mode: "insensitive" } },
                { narration: { contains: rcmNarration, mode: "insensitive" } },
                { entries: { some: { narration: { contains: "APM/R2526/0001", mode: "insensitive" } } } }
            ]
        },
        select: {
            id: true, voucherNo: true, voucherType: true, narration: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });

    const used = new Set<string>();
    const relink: any[] = [];
    const created: any[] = [];
    const still: any[] = [];

    const isAdjustments = (name: string) => /note adjustments|round off|r\/off/i.test(name);

    for (const row of missing) {
        const name = norm(row.name);
        const target = targetByName.get(name);
        const amt = cents(row.amount);
        if (!target) { still.push({ ...row, reason: "no-target-ledger" }); continue; }

        if (/note/i.test(row.type)) {
            const candidates = notes.filter(n =>
                norm(n.noteNo) === norm(row.no) && n.voucher
            );
            const pathMatch = candidates.filter(n => leaf(n.categoryPath) === name);
            const pool = pathMatch.length ? pathMatch : candidates.filter(n => cents(n.totalAmount) === amt);
            let picked: { id: string; ledgerId: string; name: string } | undefined;
            for (const note of pool) {
                const entries = note.voucher!.entries.filter(e =>
                    !used.has(e.id) &&
                    e.entryType === row.side &&
                    cents(e.amount) === amt &&
                    (isAdjustments(e.ledger.name) || e.ledger.category === "JOURNAL")
                );
                const preferAdj = entries.find(e => isAdjustments(e.ledger.name)) || entries[0];
                if (preferAdj) {
                    picked = { id: preferAdj.id, ledgerId: preferAdj.ledgerId, name: preferAdj.ledger.name };
                    break;
                }
            }
            if (!picked) {
                for (const note of candidates) {
                    const entries = note.voucher!.entries.filter(e =>
                        !used.has(e.id) && e.entryType === row.side && cents(e.amount) === amt && isAdjustments(e.ledger.name)
                    );
                    if (entries[0]) {
                        picked = { id: entries[0].id, ledgerId: entries[0].ledgerId, name: entries[0].ledger.name };
                        break;
                    }
                }
            }
            if (!picked) { still.push({ ...row, reason: "note-entry-not-found" }); continue; }
            used.add(picked.id);
            if (picked.ledgerId !== target) {
                relink.push({ entryId: picked.id, oldLedgerId: picked.ledgerId, targetLedgerId: target, oldName: picked.name, excelName: row.name, no: row.no, type: row.type });
            }
            continue;
        }

        if (row.type === "Purchase") {
            const purchase = purchases.find(p => norm(p.invoiceNo) === norm(row.no));
            const voucher = purchase ? purchaseVoucherBySource.get(purchase.id) : undefined;
            const entry = voucher?.entries.find(e =>
                !used.has(e.id) && e.entryType === row.side && cents(e.amount) === amt && isAdjustments(e.ledger.name)
            ) || voucher?.entries.find(e =>
                !used.has(e.id) && e.entryType === row.side && cents(e.amount) === amt && /round/i.test(e.ledger.name)
            );
            if (!entry) { still.push({ ...row, reason: "purchase-entry-not-found" }); continue; }
            used.add(entry.id);
            if (entry.ledgerId !== target) {
                relink.push({ entryId: entry.id, oldLedgerId: entry.ledgerId, targetLedgerId: target, oldName: entry.ledger.name, excelName: row.name, no: row.no, type: row.type });
            }
            continue;
        }

        if (row.type === "Tax Invoice") {
            const sale = sales.find(s => norm(s.invoiceNo) === norm(row.no));
            const voucher = sale ? saleVoucherBySource.get(sale.id) : undefined;
            if (!voucher) { still.push({ ...row, reason: "sale-voucher-not-found" }); continue; }
            const existing = voucher.entries.find(e =>
                !used.has(e.id) && e.entryType === row.side && cents(e.amount) === amt && norm(e.ledger.name) === name
            );
            if (existing) { used.add(existing.id); continue; }
            const id = randomUUID();
            created.push({
                id, voucherId: voucher.id, ledgerId: target, branchId: voucher.branchId || BRANCH_ID,
                entryType: row.side, amount: money(amt), narration: `TCS ${row.no}`
            });
            used.add(id);
            continue;
        }

        if (row.type === "Journal" && String(row.no) === "233") {
            let entry;
            for (const v of rcmVouchers) {
                entry = v.entries.find(e =>
                    !used.has(e.id) && e.entryType === row.side && cents(e.amount) === amt &&
                    (norm(e.ledger.name) === name || /RCM/i.test(e.ledger.name))
                );
                if (entry) break;
            }
            if (entry && entry.ledgerId !== target) {
                used.add(entry.id);
                relink.push({ entryId: entry.id, oldLedgerId: entry.ledgerId, targetLedgerId: target, oldName: entry.ledger.name, excelName: row.name, no: row.no, type: row.type });
                continue;
            }
            if (entry) { used.add(entry.id); continue; }
            still.push({ ...row, reason: "rcm-journal-not-found", rcmVouchers: rcmVouchers.map(v => ({ no: v.voucherNo, type: v.voucherType, narration: v.narration, entries: v.entries.map(e => `${e.entryType} ${e.amount} ${e.ledger.name}`) })) });
            continue;
        }

        still.push({ ...row, reason: "unhandled" });
    }

    // Journal 2379: transfer ITC not reflected -> INPUT IGST 18%
    const j2379 = missing.find(r => String(r.no) === "2379");
    if (j2379) {
        const inputIgst = targetByName.get("INPUT IGST 18%");
        const itc = targetByName.get(norm("IGST ITC Not Reflected in GSTR-2B"));
        if (inputIgst && itc) {
            const existing = await prisma.voucher.findFirst({
                where: {
                    branchId: BRANCH_ID,
                    voucherType: "JOURNAL",
                    voucherNo: "2379",
                    voucherDate: { gte: START, lte: END }
                },
                select: { id: true }
            });
            if (!existing) {
                const voucherId = randomUUID();
                const sourceId = randomUUID();
                await prisma.voucher.create({
                    data: {
                        id: voucherId,
                        voucherNo: "2379",
                        voucherType: "JOURNAL",
                        sourceId,
                        branchId: BRANCH_ID,
                        narration: String(j2379.narration || "").slice(0, 500),
                        voucherDate: new Date("2025-08-30T18:30:00.000Z"),
                        totalDebit: 401760,
                        totalCredit: 401760,
                        entries: {
                            create: [
                                { ledgerId: inputIgst, branchId: BRANCH_ID, entryType: "DEBIT", amount: 401760, narration: j2379.narration },
                                { ledgerId: itc, branchId: BRANCH_ID, entryType: "CREDIT", amount: 401760, narration: j2379.narration }
                            ]
                        }
                    }
                });
                created.push({ kind: "journal-2379", voucherId });
            }
        }
    }

    fs.writeFileSync(".tmp-duties-remaining-backup.json", JSON.stringify({ relink, created, still }, null, 2));

    for (let i = 0; i < relink.length; i += 200) {
        const chunk = relink.slice(i, i + 200);
        const values = chunk.map((row: any) => `('${row.entryId}','${row.targetLedgerId}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }

    const tcsCreates = created.filter((c: any) => c.voucherId && c.ledgerId);
    if (tcsCreates.length) {
        await prisma.ledgerEntry.createMany({
            data: tcsCreates.map((c: any) => ({
                id: c.id,
                voucherId: c.voucherId,
                ledgerId: c.ledgerId,
                branchId: c.branchId,
                entryType: c.entryType,
                amount: c.amount,
                narration: c.narration
            }))
        });
    }

    await refreshLedgers([
        ...relink.flatMap((r: any) => [r.oldLedgerId, r.targetLedgerId]),
        ...tcsCreates.map((c: any) => c.ledgerId),
        targetByName.get("INPUT IGST 18%") || "",
        targetByName.get(norm("IGST ITC Not Reflected in GSTR-2B")) || ""
    ]);

    const stillBy = still.reduce((acc: any, r: any) => {
        acc[r.reason] = (acc[r.reason] || 0) + 1;
        return acc;
    }, {});
    console.log(JSON.stringify({
        relinked: relink.length,
        createdEntries: tcsCreates.length,
        createdJournals: created.filter((c: any) => c.kind).length,
        still: still.length,
        stillBy,
        stillSample: still.slice(0, 8)
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
