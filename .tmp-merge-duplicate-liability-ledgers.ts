import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, string> = {
    "Sundry Creditors": "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
    "Advance From S. Debtors": "6cfbfae5-9fb5-486b-a317-33d4ab097601"
};
const apply = process.argv.includes("--apply");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) =>
    String(v ?? "")
        .normalize("NFKD")
        .replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();

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
            ),
            journals AS (
                SELECT jh."ledgerId",
                    SUM(CASE WHEN COALESCE(j.direction::text, jh.type::text) = 'INWARD' THEN j.amount ELSE -j.amount END) AS net
                FROM "Journal" j
                JOIN "JournalHead" jh ON jh.id = j."journalHeadId"
                WHERE j.status = 'APPROVED' AND j."voucherId" IS NULL AND jh."ledgerId" IN (${inList})
                GROUP BY jh."ledgerId"
            )
            UPDATE "Ledger" l
            SET "currentBalance" = ledgers.opening + COALESCE(entries.net, 0) + COALESCE(journals.net, 0),
                "updatedAt" = NOW()
            FROM ledgers
            LEFT JOIN entries ON entries."ledgerId" = ledgers.id
            LEFT JOIN journals ON journals."ledgerId" = ledgers.id
            WHERE l.id = ledgers.id
        `);
    }
}

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const desc = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) {
                if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                    ids.add(g.id);
                    changed = true;
                }
            }
        }
        return [...ids];
    };

    const plan: any[] = [];
    const touched = new Set<string>();

    for (const [head, id] of Object.entries(ROOTS)) {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: desc(id) } },
            select: { id: true, name: true }
        });
        const entries: any[] = [];
        for (let i = 0; i < ledgers.length; i += 200) {
            entries.push(...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                include: { voucher: { select: { voucherType: true } } }
            }));
        }
        const byLedger = new Map<string, any[]>();
        for (const e of entries) {
            const list = byLedger.get(e.ledgerId) || [];
            list.push(e);
            byLedger.set(e.ledgerId, list);
        }
        const rows = ledgers.map(l => {
            const mine = byLedger.get(l.id) || [];
            const openings = mine.filter(e => e.voucher.voucherType === "OPENING_BALANCE");
            const moves = mine.filter(e => e.voucher.voucherType !== "OPENING_BALANCE");
            const signed = mine.reduce(
                (s, e) => s + (e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount)),
                0
            );
            return {
                id: l.id,
                name: l.name,
                key: norm(l.name),
                openings: openings.length,
                moves: moves.length,
                entries: mine.length,
                signed
            };
        });
        const byName = new Map<string, typeof rows>();
        for (const r of rows) {
            if (!r.key) continue;
            const list = byName.get(r.key) || [];
            list.push(r);
            byName.set(r.key, list);
        }
        for (const [, list] of byName) {
            const withEntries = list.filter(r => r.entries > 0);
            if (withEntries.length < 2) continue;
            withEntries.sort((a, b) =>
                b.openings - a.openings ||
                b.moves - a.moves ||
                Math.abs(b.signed) - Math.abs(a.signed) ||
                a.id.localeCompare(b.id)
            );
            const canonical = withEntries[0];
            const losers = withEntries.slice(1);
            const combined = withEntries.reduce((s, r) => s + r.signed, 0);
            plan.push({
                head,
                name: canonical.name,
                canonicalId: canonical.id,
                losers: losers.map(r => ({
                    id: r.id,
                    entries: r.entries,
                    openings: r.openings,
                    close: money(r.signed)
                })),
                before: withEntries.map(r => ({
                    id: r.id,
                    entries: r.entries,
                    openings: r.openings,
                    close: money(r.signed)
                })),
                afterClose: money(combined)
            });
            for (const loser of losers) touched.add(loser.id);
            touched.add(canonical.id);
        }
    }

    fs.writeFileSync(".tmp-merge-duplicate-liability-plan.json", JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({
        apply,
        groups: plan.length,
        relinkLedgers: plan.reduce((s, p) => s + p.losers.length, 0),
        sample: plan.slice(0, 8)
    }, null, 2));

    if (!apply) {
        await prisma.$disconnect();
        return;
    }

    const backup: any[] = [];
    for (const item of plan) {
        const loserIds = item.losers.map((l: any) => l.id);
        const entryRows = await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: loserIds } },
            select: { id: true, ledgerId: true, voucherId: true, amount: true, entryType: true }
        });
        const journalHeads = await prisma.journalHead.findMany({
            where: { ledgerId: { in: loserIds } },
            select: { id: true, ledgerId: true }
        });
        backup.push({ ...item, entryRows, journalHeads });
        if (entryRows.length) {
            await prisma.ledgerEntry.updateMany({
                where: { id: { in: entryRows.map(e => e.id) } },
                data: { ledgerId: item.canonicalId }
            });
        }
        if (journalHeads.length) {
            await prisma.journalHead.updateMany({
                where: { id: { in: journalHeads.map(h => h.id) } },
                data: { ledgerId: item.canonicalId }
            });
        }
    }
    fs.writeFileSync(".tmp-merge-duplicate-liability-backup.json", JSON.stringify(backup, null, 2));
    await refreshLedgers([...touched]);
    console.log(JSON.stringify({ applied: true, backup: backup.length }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
