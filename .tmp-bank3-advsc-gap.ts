import "dotenv/config";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const NAMES = [
    "EMIT INTERNATIONAL FZ LLC",
    "GLOBAL PLASTO CHEM",
    "HINDUSTAN PETROLEUM CORPORATION LIMITED",
    "SIGMA PETROCHEM",
    "SILVERBACK INFRA PRIVATE LIMITED"
];

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: { name: { in: NAMES, mode: "insensitive" } },
        select: {
            id: true, name: true, isActive: true, category: true, branchId: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    });
    const out = [];
    for (const l of ledgers) {
        const fy = await prisma.ledgerEntry.aggregate({
            where: { ledgerId: l.id, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
            _sum: { amount: true },
            _count: true
        });
        const dr = await prisma.ledgerEntry.aggregate({
            where: { ledgerId: l.id, entryType: "DEBIT", voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
            _sum: { amount: true }
        });
        const cr = await prisma.ledgerEntry.aggregate({
            where: { ledgerId: l.id, entryType: "CREDIT", voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
            _sum: { amount: true }
        });
        out.push({
            id: l.id, name: l.name, active: l.isActive, cat: l.category,
            group: `${l.group?.parent?.name} > ${l.group?.name}`,
            n: fy._count, dr: Number(dr._sum.amount || 0), cr: Number(cr._sum.amount || 0)
        });
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
