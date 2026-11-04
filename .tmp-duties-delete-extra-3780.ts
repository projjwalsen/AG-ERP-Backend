import "dotenv/config";
import { prisma } from "./src/config/db";

const INPUT_IGST = "a377df1d-9447-4c2d-9a84-9c7698f9d4cd";

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: INPUT_IGST,
            amount: 3780,
            voucher: { voucherNo: "VPS2625769817648" }
        },
        select: {
            id: true, voucherId: true,
            voucher: { select: { voucherDate: true, narration: true, entries: { select: { id: true, ledger: { select: { name: true } }, amount: true, entryType: true } } } }
        }
    });
    console.log(JSON.stringify(entries.map(e => ({
        id: e.id, voucherId: e.voucherId, date: e.voucher.voucherDate,
        narration: e.voucher.narration,
        entries: e.voucher.entries.map(x => `${x.entryType} ${x.amount} ${x.ledger.name}`)
    })), null, 2));

    const extra = entries.find(e => e.voucher.voucherDate.getTime() === new Date("2025-09-13T18:30:00.000Z").getTime())
        || (entries.length > 1 ? entries[0] : undefined);
    if (extra && extra.voucher.entries.length === 1) {
        await prisma.journal.deleteMany({ where: { voucherId: extra.voucherId } });
        await prisma.voucher.delete({ where: { id: extra.voucherId } });
        console.log("deleted", extra.voucherId);
    } else if (extra) {
        await prisma.ledgerEntry.delete({ where: { id: extra.id } });
        console.log("deleted entry", extra.id);
    } else {
        console.log("no extra found");
    }
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
