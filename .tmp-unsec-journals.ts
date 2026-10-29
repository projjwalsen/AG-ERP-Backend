import "dotenv/config";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const IDS = [
    "8222f3c8-3918-4268-9db3-b879ab0f8e8d",
    "99244a7e-de7c-4126-853d-7aeafadfcab1",
    "e9f386e7-5138-4aee-bc32-c4b0469ca561",
    "8717d163-2c30-43c6-9891-2c19e78cb249",
    "19774c50-cff4-4a76-91e6-b85aa180f2de"
];

(async () => {
    const journals = await prisma.journal.findMany({
        where: {
            journalHead: { ledgerId: { in: IDS } },
            status: "APPROVED",
            journalDate: { gte: START, lte: END }
        },
        select: {
            amount: true, direction: true, voucherId: true,
            journalHead: { select: { ledgerId: true } },
            voucher: {
                select: {
                    id: true,
                    _count: { select: { entries: true } },
                    entries: { select: { ledgerId: true, entryType: true, amount: true } }
                }
            }
        }
    });
    const byHead: Record<string, { n: number; inward: number; outward: number; noVoucher: number; emptyVoucher: number }> = {};
    for (const j of journals) {
        const id = j.journalHead.ledgerId;
        byHead[id] = byHead[id] || { n: 0, inward: 0, outward: 0, noVoucher: 0, emptyVoucher: 0 };
        byHead[id].n += 1;
        if (j.direction === "INWARD") byHead[id].inward += Number(j.amount);
        else byHead[id].outward += Number(j.amount);
        if (!j.voucherId) byHead[id].noVoucher += 1;
        else if ((j.voucher?._count.entries || 0) === 0) byHead[id].emptyVoucher += 1;
    }
    const fallback = await prisma.journal.findMany({
        where: {
            journalHead: { ledgerId: { in: IDS } },
            status: "APPROVED",
            journalDate: { gte: START, lte: END },
            OR: [
                { voucherId: null },
                {
                    voucherId: { not: null },
                    voucher: { entries: { none: {} }, voucherType: { not: "OPENING_BALANCE" } }
                }
            ]
        },
        select: { amount: true, direction: true, journalHead: { select: { ledgerId: true } } }
    });
    console.log(JSON.stringify({
        n: journals.length,
        byHead,
        sampleMismatch: journals.filter(j => {
            const onHead = j.voucher?.entries.some(e => e.ledgerId === j.journalHead.ledgerId);
            return j.voucher && !onHead;
        }).slice(0, 5).map(j => ({
            amount: j.amount, direction: j.direction, head: j.journalHead.ledgerId,
            entries: j.voucher?.entries
        })),
        fallback: fallback.map(j => ({ amount: j.amount, direction: j.direction, head: j.journalHead.ledgerId }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
