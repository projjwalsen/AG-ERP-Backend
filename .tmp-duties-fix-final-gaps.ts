import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const INPUT_IGST = "a377df1d-9447-4c2d-9a84-9c7698f9d4cd";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");

async function refreshLedgers(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    const inList = unique.map(id => `'${id}'`).join(",");
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

(async () => {
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: ["ARGJ/25-26/0145", "ARGJ/25-26/0160"] } },
        select: { id: true, invoiceNo: true }
    });
    const pVouchers = await prisma.voucher.findMany({
        where: { voucherType: "PURCHASE", sourceId: { in: purchases.map(p => p.id) } },
        select: { id: true, sourceId: true, entries: { select: { id: true, ledgerId: true, amount: true, ledger: { select: { name: true } } } } }
    });
    const relink: { id: string; from: string; to: string }[] = [];
    for (const v of pVouchers) {
        const gst = v.entries.find(e => /Input GST IGST/i.test(e.ledger.name) && Number(e.amount) === 401760);
        if (gst && gst.ledgerId !== INPUT_IGST) relink.push({ id: gst.id, from: gst.ledgerId, to: INPUT_IGST });
    }

    const dup2379 = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: INPUT_IGST,
            amount: 401760,
            entryType: "DEBIT",
            voucher: { voucherNo: "2379", voucherType: "JOURNAL", voucherDate: { gte: START, lte: END } }
        },
        select: { id: true, voucherId: true, voucher: { select: { narration: true, entries: { select: { id: true } } } } }
    });
    const deleteVoucherIds: string[] = [];
    const narrationPrefixed = dup2379.filter(e => /^narration:/i.test(String(e.voucher.narration || "").trim()));
    const keep2379 = dup2379.filter(e => !/^narration:/i.test(String(e.voucher.narration || "").trim()));
    const extras2379 = (narrationPrefixed.length ? narrationPrefixed : dup2379.slice(1));
    for (const e of extras2379) {
        if (e.voucher.entries.length === 1) deleteVoucherIds.push(e.voucherId);
    }

    const cardDup = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: INPUT_IGST,
            amount: 3780,
            voucher: { voucherNo: "VPS2625769817648" }
        },
        select: { id: true, voucherId: true, voucher: { select: { voucherDate: true, narration: true, entries: { select: { id: true } } } } }
    });
    const extraCard = cardDup.filter(e => {
        const d = e.voucher.voucherDate;
        return d.getTime() === new Date("2025-09-13T18:30:00.000Z").getTime();
    });
    for (const e of extraCard) {
        if (e.voucher.entries.length === 1) deleteVoucherIds.push(e.voucherId);
    }

    const oneSided = [
        "7208eb23-4130-4d5d-8161-7c7e047b9662",
        "02a110f1-a2f5-4e28-ac95-42ac99333e20",
        "87930b8b-b602-42cc-a363-d2d8cfd44564",
        "f61ebe4a-d980-4682-88dc-9ce075cc4502",
        "8961b92f-a22f-4768-99b2-294c243aa0a6"
    ];
    const oneSidedEntries = await prisma.ledgerEntry.findMany({
        where: { id: { in: oneSided } },
        select: { id: true, voucherId: true, ledgerId: true, voucher: { select: { entries: { select: { id: true } } } } }
    });
    for (const e of oneSidedEntries) {
        if (e.voucher.entries.length === 1) deleteVoucherIds.push(e.voucherId);
    }

    const mixed = await prisma.ledgerEntry.findMany({
        where: { id: { in: ["6e5fc45c-8b9a-4b69-81b8-cf71f9b2c11f", "82daaf07-61a6-49f4-b0fc-105daeb03a70"] } },
        select: {
            id: true, ledgerId: true,
            voucher: { select: { entries: { select: { id: true, ledgerId: true, entryType: true } } } }
        }
    });
    const mixedRelink: { id: string; from: string; to: string }[] = [];
    for (const e of mixed) {
        const other = e.voucher.entries.find(x => x.id !== e.id);
        if (other) mixedRelink.push({ id: e.id, from: e.ledgerId, to: other.ledgerId });
    }

    const affected = [
        ...relink.flatMap(r => [r.from, r.to]),
        ...mixedRelink.flatMap(r => [r.from, r.to]),
        ...oneSidedEntries.map(e => e.ledgerId),
        INPUT_IGST
    ];

    if (relink.length) {
        const values = relink.map(r => `('${r.id}','${r.to}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }
    if (mixedRelink.length) {
        const values = mixedRelink.map(r => `('${r.id}','${r.to}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }

    const uniqueDelete = [...new Set(deleteVoucherIds)];
    if (uniqueDelete.length) {
        const journalsToDelete = await prisma.journal.findMany({
            where: { voucherId: { in: uniqueDelete } },
            select: { id: true }
        });
        await prisma.journal.deleteMany({ where: { id: { in: journalsToDelete.map(j => j.id) } } });
        await prisma.voucher.deleteMany({ where: { id: { in: uniqueDelete } } });
    }

    await refreshLedgers(affected);
    console.log(JSON.stringify({
        relinkedPurchases: relink,
        mixedRelink,
        deleteVouchers: uniqueDelete.length,
        dup2379Count: dup2379.length,
        keep2379: keep2379.length,
        extras2379: extras2379.map(e => ({ id: e.voucherId, narration: e.voucher.narration })),
        extraCard: extraCard.map(e => ({ id: e.voucherId, date: e.voucher.voucherDate, narration: e.voucher.narration }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
