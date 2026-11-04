import "dotenv/config";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const load = (ledgerId: string, extra: object = {}) => prisma.ledgerEntry.findMany({
    where: { ledgerId, voucher: { voucherDate: { gte: START, lte: END }, ...extra } },
    select: {
        id: true, entryType: true, amount: true, narration: true,
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

const summarize = (es: any[]) => es.map(e => ({
    id: e.id,
    no: e.voucher.voucherNo,
    type: e.voucher.voucherType,
    date: localDate(e.voucher.voucherDate),
    side: e.entryType,
    amt: Number(e.amount),
    narr: (e.narration || "").slice(0, 120),
    others: e.voucher.entries.filter((x: any) => x.id !== e.id).map((x: any) => ({
        name: x.ledger.name, cat: x.ledger.category,
        group: `${x.ledger.group?.parent?.name} > ${x.ledger.group?.name}`,
        side: x.entryType, amt: Number(x.amount)
    }))
}));

(async () => {
    const art = "0643bf95-4acb-4d80-adfd-9bea7f8bd47d";
    const avalanche = "90f5e440-7db2-4907-92d2-6b556f8b1244";
    const catalyst = "7c3bf846-db1b-4cfe-b739-190a5d54865f";
    const rabindra = "5d63b981-b874-4977-9b0f-79c69b488a70";
    const heading = "09615fc5-b7f6-49a1-9f1b-6efc5e8a3122";
    const mn = "6df5d6c1-2894-4a38-9ded-9749283ca4f1";
    const mnDot = "a9e539ad-24e3-433b-9182-60a5d2303168";
    const galaxyA = "f4f35315-cec5-4661-b3a5-e4dd55a0debd";
    const galaxyB = "67ac1a55-4e61-45cc-94af-72eea078a8b4";

    const artJ = summarize(await load(art, { voucherType: "JOURNAL" }));
    const avCN = summarize(await load(avalanche, { voucherType: "CREDIT_NOTE" }));
    const catCN = summarize(await load(catalyst, { voucherType: "CREDIT_NOTE" }));
    const rabCN = summarize(await load(rabindra, { voucherType: "CREDIT_NOTE" }));
    const headJ = summarize(await load(heading));
    const mnSale = summarize(await load(mn));
    const galaxyAopen = await prisma.ledgerEntry.findMany({
        where: { ledgerId: galaxyA },
        select: {
            id: true, entryType: true, amount: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });
    const galaxyAledger = await prisma.ledger.findUnique({
        where: { id: galaxyA },
        select: { name: true, openingDebit: true, openingCredit: true, openingBalance: true, isActive: true }
    });
    const galaxyBledger = await prisma.ledger.findUnique({
        where: { id: galaxyB },
        select: { name: true, openingDebit: true, openingCredit: true, openingBalance: true, isActive: true }
    });

    console.log(JSON.stringify({
        artJ: { n: artJ.length, dr: artJ.filter(x => x.side === "DEBIT").reduce((s, x) => s + x.amt, 0), rows: artJ },
        avCN: { n: avCN.length, dr: avCN.filter(x => x.side === "DEBIT").reduce((s, x) => s + x.amt, 0), cr: avCN.filter(x => x.side === "CREDIT").reduce((s, x) => s + x.amt, 0), rows: avCN },
        catCN: { n: catCN.length, dr: catCN.filter(x => x.side === "DEBIT").reduce((s, x) => s + x.amt, 0), cr: catCN.filter(x => x.side === "CREDIT").reduce((s, x) => s + x.amt, 0), rows: catCN },
        rabCN: { n: rabCN.length, dr: rabCN.filter(x => x.side === "DEBIT").reduce((s, x) => s + x.amt, 0), cr: rabCN.filter(x => x.side === "CREDIT").reduce((s, x) => s + x.amt, 0), rows: rabCN },
        headJ,
        mnSale,
        galaxyA: { ledger: galaxyAledger, entries: galaxyAopen },
        galaxyB: galaxyBledger
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
