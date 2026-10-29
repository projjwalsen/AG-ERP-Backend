import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

(async () => {
    const igst = await prisma.ledger.findFirst({
        where: { name: "INPUT IGST 18%", group: { name: "INPUT GST" } },
        select: { id: true }
    });
    const igstEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: igst!.id,
            entryType: "DEBIT",
            amount: { in: [401760, 3780] },
            voucher: { voucherDate: { gte: START, lte: END }, OR: [{ branchId: BRANCH_ID }, { branchId: null }] }
        },
        select: {
            id: true, amount: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, narration: true, sourceId: true } }
        }
    });

    const extraIds = [
        "6e5fc45c-8b9a-4b69-81b8-cf71f9b2c11f",
        "82daaf07-61a6-49f4-b0fc-105daeb03a70",
        "7208eb23-4130-4d5d-8161-7c7e047b9662",
        "02a110f1-a2f5-4e28-ac95-42ac99333e20",
        "87930b8b-b602-42cc-a363-d2d8cfd44564",
        "f61ebe4a-d980-4682-88dc-9ce075cc4502",
        "8961b92f-a22f-4768-99b2-294c243aa0a6"
    ];
    const extras = await prisma.ledgerEntry.findMany({
        where: { id: { in: extraIds } },
        select: {
            id: true, amount: true, entryType: true, ledgerId: true,
            voucher: {
                select: {
                    id: true, voucherNo: true, voucherType: true, narration: true,
                    entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { name: true, group: { select: { name: true } } } } } },
                    _count: { select: { transaction: true, debitCreditNotes: true, journals: true } }
                }
            }
        }
    });

    const purchases = await prisma.purchase.findMany({
        where: {
            branchId: BRANCH_ID,
            invoiceNo: { in: ["ARGJ/25-26/0121", "ARGJ/25-26/0145", "ARGJ/25-26/0160", "ARGJ/25-26/0163", "ARGJ/25-26/0171", "ARGJ/25-26/0172", "SAS/25-26-006", "SAS/25-26-007"] }
        },
        select: { id: true, invoiceNo: true }
    });
    const pVouchers = await prisma.voucher.findMany({
        where: { sourceId: { in: purchases.map(p => p.id) }, voucherType: "PURCHASE" },
        select: {
            sourceId: true, voucherNo: true,
            entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });

    console.log(JSON.stringify({
        igst401760and3780: igstEntries.map(e => ({
            amount: Number(e.amount), no: e.voucher.voucherNo, type: e.voucher.voucherType,
            date: e.voucher.voucherDate, narration: String(e.voucher.narration || "").slice(0, 100)
        })),
        extras: extras.map(e => ({
            id: e.id, amount: Number(e.amount), side: e.entryType, no: e.voucher.voucherNo, type: e.voucher.voucherType,
            counts: e.voucher._count,
            entries: e.voucher.entries.map(x => `${x.entryType} ${x.amount} ${x.ledger.name} / ${x.ledger.group.name}`)
        })),
        purchases: pVouchers.map(v => ({
            invoice: purchases.find(p => p.id === v.sourceId)?.invoiceNo,
            entries: v.entries.map(e => `${e.entryType} ${e.amount} ${e.ledger.name}`)
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
