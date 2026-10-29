import "dotenv/config";
import { prisma } from "./src/config/db";

const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

async function refreshLedgers(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
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

(async () => {
    const duplicateIds = [
        "651c94bf-13ba-47df-9f18-a100fdb9ab8c",
        "6c83b268-7266-4f70-b028-9b604afc5634",
        "fcb4906f-6d99-445f-b726-893c0d6cdb8f",
        "a9512666-9be0-4575-8e18-8a899ecdc7dd"
    ];
    const duplicates = await prisma.voucher.findMany({
        where: { id: { in: duplicateIds } },
        include: { entries: true, transaction: true, journals: true, debitCreditNotes: true, manufactures: true }
    });
    if (duplicates.length !== 4) throw new Error(`Expected 4 Gauri duplicate receipts, found ${duplicates.length}`);
    for (const v of duplicates) {
        if (v.transaction.length || v.debitCreditNotes.length || v.manufactures.length) {
            throw new Error(`Refusing to delete ${v.voucherNo} with source documents`);
        }
        if (v.voucherType !== "BANK_RECEIPT") throw new Error(`Unexpected type ${v.voucherType}`);
        if (!v.entries.some(e => e.ledgerId && cents(e.amount) > 0)) throw new Error(`Empty voucher ${v.voucherNo}`);
    }
    const tallyTwins = await prisma.voucher.findMany({
        where: {
            branchId: "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb",
            voucherType: "RECEIPT",
            voucherNo: { in: ["13878", "13879", "13880", "13881"] }
        },
        include: { entries: { include: { ledger: true } } }
    });
    if (tallyTwins.length !== 4) throw new Error(`Expected Tally receipts 13878-13881, found ${tallyTwins.length}`);

    const lubricon = await prisma.voucher.findFirst({
        where: { voucherNo: "RECON-SU-9903", voucherType: "PAYMENT" },
        include: { entries: { include: { ledger: true } } }
    });
    if (!lubricon) throw new Error("Created LUBRICON payment was not found");
    const near = await prisma.ledgerEntry.findMany({
        where: {
            amount: 3150140,
            entryType: "DEBIT",
            voucher: { voucherType: { in: ["PAYMENT", "BANK_PAYMENT"] } }
        },
        include: { voucher: true, ledger: true }
    });

    const affected = [
        ...duplicates.flatMap(v => v.entries.map(e => e.ledgerId)),
        ...lubricon.entries.map(e => e.ledgerId)
    ];

    await prisma.journal.updateMany({ where: { voucherId: { in: duplicateIds } }, data: { voucherId: null } });
    await prisma.voucher.deleteMany({ where: { id: { in: duplicateIds } } });
    await prisma.voucher.update({
        where: { id: lubricon.id },
        data: { voucherNo: "", narration: `${lubricon.narration || ""}; Excel voucher number was blank`.trim() }
    });
    await refreshLedgers(affected);

    console.log(JSON.stringify({
        deletedGauriDuplicates: duplicates.map(v => v.voucherNo),
        tallyTwins: tallyTwins.map(v => ({
            no: v.voucherNo,
            date: localDate(v.voucherDate),
            entries: v.entries.map(e => ({ ledger: e.ledger.name, side: e.entryType, amount: cents(e.amount) / 100 }))
        })),
        lubriconUpdated: { id: lubricon.id, oldNo: "RECON-SU-9903" },
        otherLubriconPayments: near.filter(e => e.voucherId !== lubricon.id).map(e => ({
            no: e.voucher.voucherNo,
            type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate),
            ledger: e.ledger.name
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
