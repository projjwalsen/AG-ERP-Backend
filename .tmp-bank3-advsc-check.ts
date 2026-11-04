import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const rest = await prisma.voucher.findMany({
        where: { voucherNo: { contains: "ADVSC" } },
        select: {
            id: true, voucherNo: true, voucherType: true,
            entries: { select: { ledger: { select: { name: true } }, entryType: true, amount: true } },
            journals: { select: { id: true, status: true, amount: true } }
        }
    });
    const emitLedgers = await prisma.ledger.findMany({
        where: { name: { contains: "EMIT INTERNATIONAL", mode: "insensitive" } },
        select: { id: true, name: true, isActive: true }
    });
    console.log(JSON.stringify({ rest, emitLedgers }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
