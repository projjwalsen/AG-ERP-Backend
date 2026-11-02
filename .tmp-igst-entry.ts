import "dotenv/config";
import { prisma } from "./src/config/db";

const LEDGER = "7043c5c4-8698-4183-99ff-02bf6c9fe42d";
const GROUP = "6a3babe6-b50a-4fe5-9d76-995b1a507c4b";

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: LEDGER },
        select: {
            id: true, entryType: true, amount: true, narration: true, branchId: true,
            voucher: {
                select: {
                    id: true, voucherNo: true, voucherType: true, voucherDate: true,
                    entries: {
                        select: {
                            id: true, entryType: true, amount: true,
                            ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                        }
                    }
                }
            }
        }
    });
    const journalHeads = await prisma.journalHead.findMany({
        where: { OR: [{ name: { contains: "Input GST IGST", mode: "insensitive" } }, { ledgerId: LEDGER }] },
        select: { id: true, name: true, ledgerId: true, _count: { select: { journals: true } } }
    });
    const refs = {
        journalHeads: await prisma.journalHead.count({ where: { ledgerId: LEDGER } }),
        otherLedgersInGroup: await prisma.ledger.findMany({
            where: { groupId: GROUP },
            select: { id: true, name: true, isActive: true }
        })
    };
    console.log(JSON.stringify({ entries, journalHeads, refs }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
