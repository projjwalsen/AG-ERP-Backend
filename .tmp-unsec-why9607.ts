import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const CANON = "8222f3c8-3918-4268-9db3-b879ab0f8e8d";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/_/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: CANON,
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, entryType: true, amount: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });
    const byType: Record<string, { n: number; dr: number; cr: number }> = {};
    let dr = 0, cr = 0;
    for (const e of entries) {
        const t = e.voucher.voucherType;
        byType[t] = byType[t] || { n: 0, dr: 0, cr: 0 };
        byType[t].n += 1;
        if (e.entryType === "DEBIT") { byType[t].dr += cents(e.amount); dr += cents(e.amount); }
        else { byType[t].cr += cents(e.amount); cr += cents(e.amount); }
    }

    const similar = await prisma.ledger.findMany({
        where: { name: { contains: "9607" } },
        select: {
            id: true, name: true, category: true, groupId: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });

    const journals = await prisma.journal.findMany({
        where: {
            journalHead: { ledgerId: CANON },
            status: "APPROVED",
            journalDate: { gte: START, lte: END }
        },
        select: {
            id: true, amount: true, direction: true, voucherId: true, journalDate: true,
            voucher: { select: { voucherNo: true, voucherType: true, _count: { select: { entries: true } } } }
        }
    });

    const notes = await prisma.debitCreditNote.findMany({
        where: {
            OR: [
                { categoryPath: { contains: "9607", mode: "insensitive" } },
                { noteNo: { contains: "9607" } }
            ]
        },
        select: {
            id: true, noteNo: true, categoryPath: true, status: true, sourceType: true,
            noteDate: true, totalAmount: true
        },
        take: 20
    });

    const grouped = await prisma.ledgerEntry.groupBy({
        by: ["ledgerId", "entryType"],
        where: {
            ledgerId: CANON,
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        _sum: { amount: true },
        _count: true
    });

    console.log(JSON.stringify({
        n: entries.length,
        dr: money(dr),
        cr: money(cr),
        byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, dr: money(v.dr), cr: money(v.cr) }])),
        similar: similar.map(l => ({
            id: l.id, name: l.name, cat: l.category,
            path: `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`,
            norm: norm(l.name)
        })),
        journals: {
            n: journals.length,
            withVoucherEntries: journals.filter(j => (j.voucher?._count.entries || 0) > 0).length,
            withoutEntries: journals.filter(j => !j.voucherId || (j.voucher?._count.entries || 0) === 0).length,
            sample: journals.slice(0, 8)
        },
        notes,
        grouped
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
