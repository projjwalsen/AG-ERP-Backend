import "dotenv/config";
import { prisma } from "./src/config/db";

const INS = "352c74ef-dd01-4955-a7df-a628be841cf0";
const HEAD = "5bbba1f2-4e2b-43fc-a624-c45ff957204a";
const EXP = "188578c1-4c41-4211-a082-9cc67c4644a2";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const load = (id: string) => prisma.ledgerEntry.findMany({
        where: { ledgerId: id, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
        select: {
            id: true, entryType: true, amount: true, narration: true,
            voucher: {
                select: {
                    id: true, voucherNo: true, voucherType: true, voucherDate: true,
                    entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } } } }
                }
            }
        },
        orderBy: { voucher: { voucherDate: "asc" } }
    });
    const ins = await load(INS);
    const head = await load(HEAD);
    const expCr = await prisma.ledgerEntry.findMany({
        where: { ledgerId: EXP, entryType: "CREDIT", voucher: { voucherNo: "3794" } },
        select: { id: true, amount: true, voucher: { select: { voucherNo: true } } }
    });
    const summarize = (es: any[]) => es.map(e => ({
        id: e.id, no: e.voucher.voucherNo, date: localDate(e.voucher.voucherDate),
        side: e.entryType, amt: Number(e.amount),
        narr: (e.narration || "").slice(0, 80),
        others: e.voucher.entries.filter((x: any) => x.id !== e.id).map((x: any) => ({
            name: x.ledger.name, group: `${x.ledger.group?.parent?.name} > ${x.ledger.group?.name}`,
            side: x.entryType, amt: Number(x.amount)
        }))
    }));
    const credits = ins.filter(e => e.entryType === "CREDIT");
    const debits = ins.filter(e => e.entryType === "DEBIT");
    console.log(JSON.stringify({
        insDr: debits.reduce((s, e) => s + Number(e.amount), 0),
        insCr: credits.reduce((s, e) => s + Number(e.amount), 0),
        credits: summarize(credits),
        debitN: debits.length,
        debitNos: summarize(debits).map(d => ({ no: d.no, date: d.date, amt: d.amt, others: d.others.map((o: any) => o.name) })),
        head: summarize(head),
        exp3794: expCr
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
