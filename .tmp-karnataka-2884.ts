import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            amount: 2884,
            voucher: { voucherDate: { gte: new Date("2025-05-05T00:00:00Z"), lte: new Date("2025-05-08T00:00:00Z") } }
        },
        select: {
            id: true, entryType: true, amount: true, ledgerId: true, voucherId: true,
            ledger: { select: { name: true } },
            voucher: { select: { voucherNo: true, voucherType: true, totalDebit: true, totalCredit: true, voucherDate: true } }
        }
    });
    const j = await prisma.voucher.findUnique({
        where: { id: "a62d1491-bf1a-43d2-9137-fe6f2d6af571" },
        select: {
            id: true, voucherNo: true, voucherType: true, totalDebit: true, totalCredit: true,
            entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { name: true, id: true } } } }
        }
    });
    console.log(JSON.stringify({ around2884: entries, journal11308: j }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
