import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const voucher = await prisma.voucher.findUnique({
        where: { id: "5b1cc215-e9b1-4a6f-8e2b-398b78136a81" },
        select: { id: true, entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } } }
    });
    console.log(JSON.stringify(voucher, null, 2));
    const operational = await prisma.ledger.findFirst({
        where: { name: "Input GST IGST - AG_ASHTAVINAYAKA_PETROCHEM_MH" },
        select: { id: true, name: true }
    });
    if (voucher && operational) {
        const dr = voucher.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + Number(e.amount), 0);
        const cr = voucher.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + Number(e.amount), 0);
        if (Math.abs(cr - dr - 3780) < 0.01 || Math.abs(cr - dr) === 3780) {
            await prisma.ledgerEntry.create({
                data: {
                    voucherId: voucher.id,
                    ledgerId: operational.id,
                    branchId: "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb",
                    entryType: "DEBIT",
                    amount: 3780,
                    narration: "GST on corporate card interest (duplicate Duties line moved off Tally Duties)"
                }
            });
            console.log("rebalanced onto", operational.name);
        }
    }
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
