import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const GAPS = [
    { no: "10797", date: "2025-04-15", want: 459037, have: 349229, interest: 109808 },
    { no: "10779", date: "2025-05-15", want: 45201, have: 34272, interest: 10929 },
    { no: "10756", date: "2025-07-07", want: 59625, have: 46714.54, interest: 12910.46 },
    { no: "10768", date: "2025-07-07", want: 42650, have: 40068.62, interest: 2581.38 },
    { no: "10761", date: "2025-12-07", want: 59625, have: 48474.03, interest: 11150.97 },
    { no: "10774", date: "2026-01-07", want: 42650, have: 41989.47, interest: 660.53 },
    { no: "10807", date: "2026-02-15", want: 460537, have: 376012, interest: 84525 },
    { no: "10764", date: "2026-03-07", want: 59625, have: 49561.37, interest: 10063.63 },
    { no: "10789", date: "2026-03-15", want: 45201, have: 37011, interest: 8190 }
];

const BOM_OD = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const INTEREST_NAMES = ["Interest on Vehicle Loan", "Interest on Unsecured Loan"];

(async () => {
    const interestLedgers = await prisma.ledger.findMany({
        where: { name: { in: INTEREST_NAMES, mode: "insensitive" } },
        select: { id: true, name: true, isActive: true, branchId: true, group: { select: { name: true, parent: { select: { name: true } } } } }
    });
    const rows: any[] = [];
    for (const g of GAPS) {
        const vs = await prisma.voucher.findMany({
            where: { branchId: BRANCH, voucherNo: g.no },
            select: {
                id: true, voucherNo: true, voucherType: true, voucherDate: true,
                entries: {
                    select: {
                        id: true, ledgerId: true, entryType: true, amount: true,
                        ledger: { select: { name: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                    }
                }
            }
        });
        const amtHits = await prisma.ledgerEntry.findMany({
            where: {
                amount: g.interest,
                entryType: "DEBIT",
                ledger: { name: { contains: "Interest", mode: "insensitive" } },
                voucher: { voucherDate: { gte: START, lte: END } }
            },
            select: {
                id: true, amount: true,
                ledger: { select: { name: true } },
                voucher: { select: { voucherNo: true, voucherDate: true, voucherType: true } }
            },
            take: 8
        });
        rows.push({
            gap: g,
            vouchers: vs.map(v => ({
                id: v.id, type: v.voucherType, date: localDate(v.voucherDate),
                entries: v.entries.map(e => ({
                    id: e.id, name: e.ledger.name, side: e.entryType, amt: Number(e.amount),
                    group: `${e.ledger.group?.parent?.name} > ${e.ledger.group?.name}`,
                    isOd: e.ledgerId === BOM_OD
                }))
            })),
            interestHits: amtHits.map(e => ({
                id: e.id, name: e.ledger.name, amt: Number(e.amount),
                no: e.voucher.voucherNo, date: localDate(e.voucher.voucherDate), type: e.voucher.voucherType
            }))
        });
    }
    console.log(JSON.stringify({ interestLedgers, rows }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
