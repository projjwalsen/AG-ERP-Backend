import "dotenv/config";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const L3288 = "b860c1fb-1c1c-4909-aad7-ab392da8317e";
const L3767 = "21d57148-8742-4b93-a89c-e88c00bd7e78";

(async () => {
    for (const [name, id] of [["3288", L3288], ["3767", L3767]] as const) {
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: id,
                amount: { gte: 19000000 },
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
            },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true,
                    entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } } } }
            }
        });
        const journals = await prisma.journal.findMany({
            where: {
                journalHead: { ledgerId: id },
                amount: { gte: 19000000 },
                journalDate: { gte: START, lte: END }
            },
            select: {
                id: true, amount: true, direction: true, voucherId: true, remarks: true,
                voucher: { select: { voucherNo: true, voucherType: true, _count: { select: { entries: true } } } }
            }
        });
        const allJ = await prisma.journal.findMany({
            where: {
                journalHead: { ledgerId: id },
                status: "APPROVED",
                OR: [
                    { voucherId: null },
                    { voucher: { entries: { none: {} } } }
                ]
            },
            select: { id: true, amount: true, direction: true, voucherId: true }
        });
        console.log(JSON.stringify({ name, bigEntries: entries, bigJournals: journals, orphanJournals: allJ }, null, 2));
    }
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
