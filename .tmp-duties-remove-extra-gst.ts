import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-duties-excel-extract.json", "utf8"));
    const names = ["INPUT CGST 9%", "INPUT SGST 9%", "INPUT IGST 18%"];
    const ledgers = await prisma.ledger.findMany({
        where: { name: { in: names }, group: { name: "INPUT GST" } },
        select: { id: true, name: true }
    });
    const purchaseLedger = await prisma.ledger.findFirst({
        where: { name: "Purchase - AG_ASHTAVINAYAKA_PETROCHEM_MH" },
        select: { id: true }
    });
    const extraIds: string[] = [];
    const extraDetail: any[] = [];
    for (const name of names) {
        const ledger = ledgers.find(l => norm(l.name) === norm(name));
        if (!ledger) continue;
        const xl = extract.vouchers.filter((r: any) => norm(r.name) === norm(name) && r.side === "DEBIT");
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: ledger.id, entryType: "DEBIT",
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
            },
            select: {
                id: true, amount: true, voucherId: true,
                voucher: { select: { voucherNo: true, voucherDate: true, voucherType: true } }
            }
        });
        const used = new Set<string>();
        for (const row of xl) {
            const amt = cents(row.amount);
            const hit = entries.find(e => !used.has(e.id) && cents(e.amount) === amt && localDate(e.voucher.voucherDate) === row.date)
                || entries.find(e => !used.has(e.id) && cents(e.amount) === amt);
            if (hit) used.add(hit.id);
        }
        const extra = entries.filter(e => !used.has(e.id));
        for (const e of extra) {
            extraIds.push(e.id);
            extraDetail.push({ name, no: e.voucher.voucherNo, amount: Number(e.amount), type: e.voucher.voucherType, date: e.voucher.voucherDate });
        }
    }
    extraDetail.sort((a, b) => a.name.localeCompare(b.name) || a.no.localeCompare(b.no));
    console.log(JSON.stringify({ extraCount: extraIds.length, extraDetail, extraSum: extraDetail.reduce((s, x) => s + x.amount, 0) }, null, 2));

    if (extraIds.length && purchaseLedger) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { id: { in: extraIds } },
            select: { id: true, voucherId: true, amount: true }
        });
        for (const e of entries) {
            const purchaseLine = await prisma.ledgerEntry.findFirst({
                where: { voucherId: e.voucherId, ledgerId: purchaseLedger.id, entryType: "DEBIT" }
            });
            if (purchaseLine) {
                await prisma.ledgerEntry.update({
                    where: { id: purchaseLine.id },
                    data: { amount: money(Number(purchaseLine.amount) + Number(e.amount)) }
                });
            }
            await prisma.ledgerEntry.delete({ where: { id: e.id } });
        }
        console.log("moved extra GST back to Purchase", extraIds.length);
    }
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
