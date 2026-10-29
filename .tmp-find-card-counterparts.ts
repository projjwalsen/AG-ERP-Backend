import "dotenv/config";
import { prisma } from "./src/config/db";

const amounts = [2000000, 3800000, 20000000, 943000];
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const ist = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: { amount: { in: amounts } },
        include: {
            ledger: { select: { id: true, name: true, category: true, groupId: true } },
            voucher: { select: { id: true, voucherType: true, voucherNo: true, voucherDate: true, narration: true } }
        }
    });
    const journals = await prisma.journal.findMany({
        where: { amount: { in: amounts } },
        include: {
            journalHead: { select: { name: true, ledgerId: true, ledger: { select: { name: true } } } }
        }
    });
    const cards = await prisma.ledger.findMany({
        where: { name: { contains: "CORPORATE", mode: "insensitive" } },
        select: { id: true, name: true, category: true, groupId: true }
    });
    console.log(JSON.stringify({
        entryHits: entries.map(e => ({
            amount: money(e.amount),
            type: e.entryType,
            ledger: e.ledger.name,
            category: e.ledger.category,
            date: ist(e.voucher.voucherDate),
            vtype: e.voucher.voucherType,
            no: e.voucher.voucherNo,
            voucherId: e.voucher.id,
            narration: (e.narration || e.voucher.narration || "").slice(0, 120)
        })),
        journalHits: journals.map(j => ({
            id: j.id,
            amount: money(j.amount),
            date: ist(j.journalDate),
            voucherId: j.voucherId,
            head: j.journalHead.name,
            ledger: j.journalHead.ledger.name,
            remarks: j.remarks
        })),
        cards
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
