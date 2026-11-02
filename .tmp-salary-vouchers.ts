import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const NOS = ["17", "38", "53", "71"];
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const vouchers = await prisma.voucher.findMany({
        where: { voucherNo: { in: NOS }, branchId: BRANCH },
        include: {
            entries: { include: { ledger: { select: { id: true, name: true, group: { select: { name: true, parent: { select: { name: true } } } } } } } },
            journals: { select: { id: true, status: true, amount: true, journalDate: true, remarks: true } }
        },
        orderBy: { voucherDate: "asc" }
    });
    const rows = vouchers.map(v => ({
        id: v.id,
        no: v.voucherNo,
        type: v.voucherType,
        date: localDate(v.voucherDate),
        narr: v.narration,
        journals: v.journals,
        entries: v.entries.map(e => ({
            id: e.id,
            side: e.entryType,
            amt: Number(e.amount),
            ledger: e.ledger.name,
            group: `${e.ledger.group?.parent?.name} > ${e.ledger.group?.name}`
        }))
    }));
    console.log(JSON.stringify(rows, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
