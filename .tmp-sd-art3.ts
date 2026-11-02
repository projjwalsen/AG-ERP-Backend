import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const v = await prisma.voucher.findFirst({
        where: { voucherNo: "AG-ART-OPENING" },
        select: {
            id: true, voucherType: true, voucherDate: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true } },
            journals: {
                select: {
                    id: true, amount: true, direction: true, status: true, voucherNo: true,
                    journalHead: { select: { name: true, ledgerId: true } }
                }
            }
        }
    });
    const journals = await prisma.journal.findMany({
        where: {
            OR: [
                { voucherNo: { contains: "AG-ART" } },
                { journalHead: { name: { contains: "A G ART PETROCHEM LLP", mode: "insensitive" } } },
                { amount: 53514885 }
            ]
        },
        select: {
            id: true, amount: true, direction: true, status: true, voucherNo: true, voucherId: true, journalDate: true,
            journalHead: { select: { name: true, ledgerId: true } }
        }
    });
    console.log(JSON.stringify({ v, journals }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
