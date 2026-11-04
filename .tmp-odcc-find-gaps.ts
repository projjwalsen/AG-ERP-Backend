import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const AMTS = [
    124981, 148953, 150939, 169084, 2884, 170006, 157057, 177263,
    1954726, 406065, 935082, 19879078, 20000000, 14977112.75, 14146914,
    6316042, 7005377, 4030, 6331, 433823, 1681771, 140804, 179301, 212426
];

(async () => {
    const out: any[] = [];
    for (const amt of AMTS) {
        const rows = await prisma.ledgerEntry.findMany({
            where: {
                amount: amt,
                voucher: { branchId: BRANCH_ID, voucherDate: { gte: START, lte: END } }
            },
            select: {
                entryType: true, amount: true,
                ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } },
                voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, narration: true } }
            },
            take: 8
        });
        out.push({
            amt,
            n: rows.length,
            rows: rows.map(e => ({
                no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
                side: e.entryType, name: e.ledger.name, cat: e.ledger.category,
                group: `${e.ledger.group?.parent?.name || ""} > ${e.ledger.group?.name}`,
                narr: (e.voucher.narration || "").slice(0, 80)
            }))
        });
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
