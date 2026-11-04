import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: { name: { contains: "BRBL INDIA", mode: "insensitive" } },
        select: { id: true, name: true, category: true, group: { select: { name: true, code: true, parentId: true } } }
    });
    console.log("ledgers", ledgers);
    const id = "614dfd30-59b8-4019-9ea1-73e5cef18e59";
    const journals = await prisma.journal.findMany({
        where: { journalHead: { ledgerId: id } },
        select: {
            id: true, amount: true, direction: true, status: true, journalDate: true,
            voucherId: true,
            voucher: { select: { voucherType: true, voucherNo: true, _count: { select: { entries: true } } } }
        }
    });
    const notes = await prisma.debitCreditNote.findMany({
        where: { voucher: { entries: { some: { ledgerId: id } } } },
        select: { id: true, noteNo: true, type: true, totalAmount: true, categoryPath: true, voucherId: true }
    });
    console.log(JSON.stringify({
        journals: journals.map(j => ({
            amt: Number(j.amount), dir: j.direction, status: j.status,
            date: j.journalDate, vType: j.voucher?.voucherType, vNo: j.voucher?.voucherNo,
            vEntries: j.voucher?._count.entries, voucherId: j.voucherId
        })),
        notes
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
