import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const EXTRA_IDS = [
    "0c86ec13-e19f-4e3a-b7ec-8020731317ee",
    "7b79f0a5-6873-45bb-a289-9c103b9b6cb0",
    "3b5cf778-2e11-4500-8409-b8e9e9541922",
    "bed36b18-80e1-4ac4-b0f5-2cc61a4f5264",
    "8e3a9812-9f50-4708-8201-546d00d24803",
    "634d9e4b-0692-425f-a281-d8b66eaec2f3"
];
const MISS = [
    { no: "6", amount: 80, type: "PAYMENT" },
    { no: "9", amount: 779, type: "PAYMENT" },
    { no: "203", amount: 25, type: "PAYMENT" },
    { no: "247", amount: 474, type: "PAYMENT" },
    { no: "263", amount: 240, type: "PAYMENT" }
];

(async () => {
    const extras = await prisma.ledgerEntry.findMany({
        where: { id: { in: EXTRA_IDS } },
        select: {
            id: true, amount: true, entryType: true,
            voucher: {
                select: {
                    id: true, voucherNo: true, voucherType: true, totalDebit: true, totalCredit: true, narration: true,
                    entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { id: true, name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } } } }
                }
            }
        }
    });
    const hosts: any[] = [];
    for (const m of MISS) {
        const vs = await prisma.voucher.findMany({
            where: { branchId: BRANCH_ID, voucherNo: m.no },
            select: {
                id: true, voucherNo: true, voucherType: true, voucherDate: true, totalDebit: true, totalCredit: true, narration: true,
                entries: { select: { entryType: true, amount: true, ledger: { select: { name: true, category: true } } } }
            }
        });
        hosts.push({ miss: m, vouchers: vs.filter(v =>
            v.entries.some(e => Math.round(Number(e.amount) * 100) === Math.round(m.amount * 100)) ||
            v.voucherType === "PAYMENT" || v.voucherType === "CASH_PAYMENT"
        ).slice(0, 6) });
    }
    console.log(JSON.stringify({ extras, hosts }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
