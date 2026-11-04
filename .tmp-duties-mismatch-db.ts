import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const names = ["INPUT IGST 18%", "INPUT CGST 9%", "INPUT SGST 9%"];
    const ledgers = await prisma.ledger.findMany({
        where: { name: { in: names }, group: { name: "INPUT GST" } },
        select: { id: true, name: true }
    });
    const out: any[] = [];
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: l.id,
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
            },
            select: { entryType: true, amount: true, voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, branchId: true } } }
        });
        let dr = 0, cr = 0, n = 0;
        for (const e of entries) {
            if (e.voucher.branchId && e.voucher.branchId !== BRANCH_ID) continue;
            n += 1;
            if (e.entryType === "DEBIT") dr += cents(e.amount); else cr += cents(e.amount);
        }
        const nos = ["AR/2526/0058", "18/2025-26", "PPI/2025-26/3421", "LI/GST/25-26/137"];
        const hits = entries.filter(e => nos.includes(e.voucher.voucherNo)).map(e => ({
            no: e.voucher.voucherNo, type: e.voucher.voucherType, date: e.voucher.voucherDate,
            side: e.entryType, amount: Number(e.amount), branch: e.voucher.branchId
        }));
        out.push({ name: l.name, n, dr: money(dr), cr: money(cr), gap: money(cr - dr), hits });
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
