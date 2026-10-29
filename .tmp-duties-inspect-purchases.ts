import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const a = await prisma.voucher.findMany({
        where: {
            OR: [
                { narration: { contains: "0230001-07052025-03569" } },
                { narration: { contains: "TDS ON PURCHASE OF GOODS PAID FOR THE MONTH" } },
                { entries: { some: { amount: 183400 } } }
            ]
        },
        select: {
            voucherNo: true, voucherType: true, narration: true,
            entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } }
        },
        take: 10
    });
    const b = await prisma.voucher.findMany({
        where: {
            OR: [
                { narration: { contains: "0230001-22052025-00319" } },
                { entries: { some: { amount: 89, ledger: { name: { contains: "TDS ON CONTRACT" } } } } }
            ]
        },
        select: {
            voucherNo: true, voucherType: true, narration: true,
            entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } }
        },
        take: 10
    });
    console.log(JSON.stringify({ tdsGoods: a, tdsContract: b }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
