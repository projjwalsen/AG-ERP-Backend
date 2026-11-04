import "dotenv/config";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const IDS = [
    "e6ffe590-2757-4b30-94f1-278a55024501", // URD under Direct Expenses
    "2a2c72c3-c2c8-4b9c-959d-697f8b1944c3", // URD under nested group
    "1212a65a-f7d5-4ce8-a578-2552e8fa5d0f", // RD under Direct Expenses
    "32920321-6a95-47c7-9fda-8cef5af34dcd"  // RD under nested group
];

(async () => {
    const rows = [];
    for (const id of IDS) {
        const ledger = await prisma.ledger.findUnique({
            where: { id },
            select: { id: true, name: true, group: { select: { name: true, parent: { select: { name: true } } } } }
        });
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: id },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true } }
            }
        });
        const fy = entries.filter(e => e.voucher.voucherDate >= START && e.voucher.voucherDate <= END);
        const dr = fy.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + Number(e.amount), 0);
        const cr = fy.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + Number(e.amount), 0);
        const heads = await prisma.journalHead.count({ where: { ledgerId: id } });
        const journals = await prisma.journal.count({ where: { journalHead: { ledgerId: id } } });
        rows.push({
            ledger,
            entryCount: entries.length,
            fyCount: fy.length,
            dr: Number(dr.toFixed(2)),
            cr: Number(cr.toFixed(2)),
            types: [...new Set(fy.map(e => e.voucher.voucherType))],
            heads,
            journals,
            sample: fy.slice(0, 8).map(e => ({
                side: e.entryType, amt: Number(e.amount), no: e.voucher.voucherNo,
                type: e.voucher.voucherType, narr: (e.narration || "").slice(0, 80)
            }))
        });
    }
    console.log(JSON.stringify(rows, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
