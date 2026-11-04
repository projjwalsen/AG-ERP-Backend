import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const notes = await prisma.debitCreditNote.findMany({
        where: { noteNo: { startsWith: "PDN/M/2526/07" } },
        select: {
            id: true, noteNo: true, type: true, totalAmount: true, categoryPath: true,
            purchaseId: true, sourceType: true, status: true, voucherId: true,
            voucher: {
                select: {
                    voucherNo: true, voucherType: true, narration: true,
                    entries: {
                        select: {
                            entryType: true, amount: true, narration: true,
                            ledger: { select: { name: true, category: true } }
                        }
                    }
                }
            }
        }
    });
    const more = await prisma.debitCreditNote.findMany({
        where: { noteNo: { in: [
            "PDN/M/2526/077","PDN/M/2526/078","PDN/M/2526/079","PDN/M/2526/080",
            "PDN/M/2526/081","PDN/M/2526/082","PDN/M/2526/083","PDN/M/2526/084",
            "PDN/M/2526/085","PDN/M/2526/086"
        ] } },
        select: {
            id: true, noteNo: true, type: true, totalAmount: true, categoryPath: true,
            purchaseId: true, sourceType: true, status: true,
            voucher: {
                select: {
                    voucherNo: true, narration: true,
                    entries: {
                        select: {
                            entryType: true, amount: true, narration: true,
                            ledger: { select: { name: true, category: true } }
                        }
                    }
                }
            }
        }
    });
    console.log(JSON.stringify(more.length ? more : notes, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
