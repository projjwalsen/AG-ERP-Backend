import "dotenv/config";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const LEDGER_IDS = [
    "75446b1e-c87b-40b1-bf10-9a66c6c48204", // EMIT active
    "8ce546c1-1871-4d6b-b637-4e7f32dece2d", // GLOBAL active
    "3a7b2af5-ba61-40dd-b0d2-147b74275f33", // HPCL nested
    "dc88369d-7d35-46aa-a513-000417098ff3", // SIGMA active
    "0078c46b-b562-464f-a227-6ad70c1e7a6f"  // SILVERBACK active
];

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: LEDGER_IDS },
            voucher: { voucherType: "JOURNAL", voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            ledger: { select: { name: true } },
            voucher: {
                select: {
                    id: true, voucherNo: true, voucherType: true,
                    journals: { select: { id: true, status: true, amount: true } }
                }
            }
        }
    });
    const byVoucher = new Map<string, any>();
    for (const e of entries) {
        const v = byVoucher.get(e.voucher.id) || {
            id: e.voucher.id, no: e.voucher.voucherNo, journals: e.voucher.journals.length,
            journalAmt: e.voucher.journals.reduce((s: number, j: any) => s + Number(j.amount), 0),
            lines: [] as any[]
        };
        v.lines.push({ name: e.ledger.name, side: e.entryType, amt: Number(e.amount) });
        byVoucher.set(e.voucher.id, v);
    }
    const rows = [...byVoucher.values()];
    const missing = rows.filter(v => v.journals === 0);
    const crMissing = missing.reduce((s, v) => s + v.lines.filter((l: any) => l.side === "CREDIT").reduce((x: number, l: any) => x + l.amt, 0), 0);
    const drMissing = missing.reduce((s, v) => s + v.lines.filter((l: any) => l.side === "DEBIT").reduce((x: number, l: any) => x + l.amt, 0), 0);
    console.log(JSON.stringify({
        voucherN: rows.length,
        missingJournalN: missing.length,
        crMissing, drMissing,
        missingSample: missing.slice(0, 15),
        withJournals: rows.filter(v => v.journals > 0).length
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
