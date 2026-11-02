import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const sample = await prisma.voucher.findFirst({
        where: { voucherNo: "AT/25-26/0001", journals: { some: { status: "APPROVED" } } },
        select: {
            id: true,
            journals: {
                select: {
                    id: true, journalHeadId: true, paymentMode: true, direction: true,
                    status: true, amount: true, createdById: true, categoryId: true, categoryPath: true
                }
            },
            entries: { select: { ledger: { select: { name: true } }, entryType: true, amount: true } }
        }
    });
    const rcmV = await prisma.ledgerEntry.findFirst({
        where: { ledgerId: "d0952654-53e8-4667-bd16-014166938cfb", voucher: { voucherNo: "AT/25-26/0001" } },
        select: {
            voucher: {
                select: {
                    id: true, voucherNo: true,
                    journals: { select: { journalHeadId: true, paymentMode: true, direction: true, createdById: true, categoryId: true, categoryPath: true, amount: true } },
                    entries: { select: { ledger: { select: { name: true } }, entryType: true, amount: true } }
                }
            }
        }
    });
    console.log(JSON.stringify({ sample, rcmV }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
