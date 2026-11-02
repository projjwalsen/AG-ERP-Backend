import "dotenv/config";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const load = (id: string, extra?: object) => prisma.ledgerEntry.findMany({
    where: { ledgerId: id, voucher: { voucherDate: { gte: START, lte: END }, voucherType: { not: "OPENING_BALANCE" }, ...extra } },
    select: {
        id: true, entryType: true, amount: true,
        voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
    }
});

(async () => {
    const pairs = [
        { name: "SIGMA", act: "dc88369d-7d35-46aa-a513-000417098ff3", inact: "fe6a98c9-f99e-411e-b296-43107459b463" },
        { name: "SILVER", act: "0078c46b-b562-464f-a227-6ad70c1e7a6f", inact: "624ccc67-652b-4bf6-a9e3-35d66e7bd442" },
        { name: "GLOBAL", act: "8ce546c1-1871-4d6b-b637-4e7f32dece2d", inact: "02f03bb1-2bd6-42e2-8627-c9e75ab59642" },
        { name: "CLASSIC", act: "56374eba-3d95-4da9-a348-c95ae4b97880", inact: "3ca50cc3-79d7-4cc7-bc9f-083665765f6c" },
        { name: "DARSH", act: "86d3c963-b177-4169-8228-07db9452a78c", inact: "6accb1c4-fa77-438b-9f0d-ac6144b2cb05" },
    ];
    const out: any = {};
    for (const p of pairs) {
        const act = await load(p.act);
        const inact = await load(p.inact);
        const actCredits = act.filter(e => e.entryType === "CREDIT").map(e => ({
            id: e.id, no: e.voucher.voucherNo, type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate), amt: Number(e.amount)
        }));
        const used = new Set<string>();
        const matched: any[] = [];
        const unmatched: any[] = [];
        for (const e of inact.filter(x => x.entryType === "CREDIT")) {
            const hit = actCredits.find(a => !used.has(a.id) && cents(a.amt) === cents(e.amount));
            const row = {
                id: e.id, no: e.voucher.voucherNo, date: localDate(e.voucher.voucherDate),
                amt: Number(e.amount), type: e.voucher.voucherType
            };
            if (hit) { used.add(hit.id); matched.push({ inactive: row, active: hit }); }
            else unmatched.push(row);
        }
        const actPurch = act.filter(e => e.voucher.voucherType === "PURCHASE");
        out[p.name] = {
            actCr: money(act.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0)),
            actDr: money(act.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0)),
            inactCr: money(inact.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0)),
            matchedN: matched.length,
            matchedAmt: money(matched.reduce((s, m) => s + cents(m.inactive.amt), 0)),
            unmatchedN: unmatched.length,
            unmatchedAmt: money(unmatched.reduce((s, m) => s + cents(m.amt), 0)),
            unmatched,
            actPurchN: actPurch.length,
            actPurchAmt: money(actPurch.reduce((s, e) => s + cents(e.amount), 0)),
            actPurch: actPurch.map(e => ({
                id: e.id, no: e.voucher.voucherNo, side: e.entryType, amt: Number(e.amount)
            }))
        };
    }

    const emit = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: "75446b1e-c87b-40b1-bf10-9a66c6c48204",
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { lt: START } }
        },
        select: {
            id: true, entryType: true, amount: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });
    const emitPeriod = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: "75446b1e-c87b-40b1-bf10-9a66c6c48204",
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { entryType: true, amount: true, voucher: { select: { voucherType: true } } }
    });
    out.EMIT = {
        priorN: emit.length,
        priorDr: money(emit.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0)),
        priorCr: money(emit.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0)),
        prior: emit.map(e => ({
            id: e.id, no: e.voucher.voucherNo, type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate), side: e.entryType, amt: Number(e.amount)
        })),
        periodByType: emitPeriod.reduce((a: any, e) => {
            const t = e.voucher.voucherType;
            a[t] = a[t] || { n: 0, dr: 0, cr: 0 };
            a[t].n += 1;
            if (e.entryType === "DEBIT") a[t].dr += Number(e.amount); else a[t].cr += Number(e.amount);
            return a;
        }, {})
    };

    // IOCL journal entries vs purchase - keep journals, drop purchases
    const ioclJ = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: "586b1d06-0ecb-404a-9f4a-b47a23430ea1",
            voucher: { voucherType: "JOURNAL", voucherDate: { gte: START, lte: END } }
        },
        select: { id: true, entryType: true, amount: true, voucher: { select: { voucherNo: true, voucherDate: true } } }
    });
    out.IOCL_J = ioclJ.map(e => ({
        id: e.id, no: e.voucher.voucherNo, date: localDate(e.voucher.voucherDate),
        side: e.entryType, amt: Number(e.amount)
    }));

    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
