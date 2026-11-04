import "dotenv/config";
import { prisma } from "./src/config/db";

const ART = "0643bf95-4acb-4d80-adfd-9bea7f8bd47d";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const ledger = await prisma.ledger.findUnique({
        where: { id: ART },
        select: { name: true, openingDebit: true, openingCredit: true, openingBalance: true, openingBalanceDate: true, category: true }
    });
    const opens = await prisma.ledgerEntry.findMany({
        where: { ledgerId: ART, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { id: true, entryType: true, amount: true, narration: true, voucher: { select: { voucherNo: true, voucherDate: true, voucherType: true } } }
    });
    const period = await prisma.ledgerEntry.findMany({
        where: { ledgerId: ART, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
        select: { entryType: true, amount: true, voucher: { select: { voucherType: true, voucherNo: true } } }
    });
    const byType = period.reduce((a: any, e) => {
        const t = e.voucher.voucherType;
        a[t] = a[t] || { n: 0, dr: 0, cr: 0 };
        a[t].n += 1;
        if (e.entryType === "DEBIT") a[t].dr += Number(e.amount); else a[t].cr += Number(e.amount);
        return a;
    }, {});
    const dr = period.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
    const cr = period.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
    console.log(JSON.stringify({
        ledger,
        opens,
        byType,
        periodDr: money(dr), periodCr: money(cr),
        close: money(cents(ledger?.openingDebit) - cents(ledger?.openingCredit) + dr - cr)
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
