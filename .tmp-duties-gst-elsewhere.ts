import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: {
            OR: [
                { category: "GST" },
                { name: { contains: "Input GST", mode: "insensitive" } },
                { name: { contains: "Output GST", mode: "insensitive" } },
                { name: { contains: "INPUT GST", mode: "insensitive" } },
                { name: { contains: "OUTPUT GST", mode: "insensitive" } }
            ]
        },
        select: { id: true, name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } }
    });
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgers.map(l => l.id) },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { ledgerId: true, entryType: true, amount: true, voucher: { select: { voucherType: true, branchId: true } } }
    });
    const by = new Map<string, any>();
    for (const l of ledgers) {
        by.set(l.id, { name: l.name, category: l.category, group: `${l.group?.parent?.name || ""} > ${l.group?.name}`, dr: 0, cr: 0, n: 0, types: {} as Record<string, number> });
    }
    for (const e of entries) {
        if (e.voucher.branchId && e.voucher.branchId !== BRANCH_ID) continue;
        const row = by.get(e.ledgerId);
        row.n += 1;
        row.types[e.voucher.voucherType] = (row.types[e.voucher.voucherType] || 0) + 1;
        if (e.entryType === "DEBIT") row.dr += cents(e.amount); else row.cr += cents(e.amount);
    }
    const rows = [...by.values()].filter(r => r.n).map(r => ({ ...r, dr: money(r.dr), cr: money(r.cr) }))
        .sort((a, b) => b.dr + b.cr - (a.dr + a.cr));
    console.log(JSON.stringify(rows, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
