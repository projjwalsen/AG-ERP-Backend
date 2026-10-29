import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const money = (v: number) => Number((v / 100).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

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
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: { in: [...ids] } },
        select: { id: true, currentBalance: true, nature: true }
    });
    const before = ledgers.reduce((s, l) => s + cents(l.currentBalance), 0);
    const journalCount = await prisma.journal.count({
        where: {
            voucherId: null,
            status: "APPROVED",
            journalHead: { ledgerId: { in: ledgers.map(l => l.id) } }
        }
    });
    await refreshLedgers(ledgers.map(l => l.id));
    const afterRows = await prisma.ledger.findMany({
        where: { id: { in: ledgers.map(l => l.id) } },
        select: { currentBalance: true }
    });
    const after = afterRows.reduce((s, l) => s + cents(l.currentBalance), 0);
    let closeDr = 0, closeCr = 0;
    for (const l of afterRows) {
        const signed = cents(l.currentBalance);
        if (signed > 0) closeDr += signed; else closeCr += -signed;
    }
    console.log(JSON.stringify({
        ledgers: ledgers.length,
        voucherlessJournals: journalCount,
        beforeSum: money(before),
        afterSum: money(after),
        closeDr: money(closeDr),
        closeCr: money(closeCr),
        netCloseCr: money(closeCr - closeDr),
        pdf: { closeDr: 111541986.01, closeCr: 392379306.63, net: 280837320.62 }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
