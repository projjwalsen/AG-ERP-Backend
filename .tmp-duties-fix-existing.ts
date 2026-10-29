import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

(async () => {
    const tds = await prisma.ledger.findFirst({
        where: { name: "TDS ON CONTRACT", group: { name: "TDS" } },
        select: { id: true }
    });
    const bank = await prisma.ledger.findFirst({
        where: { name: { contains: "BANK OF MAHARASHTRA- C/C 60434886441" } },
        select: { id: true }
    });
    const exists = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: tds?.id, amount: 89, entryType: "DEBIT",
            voucher: { narration: { contains: "0230001-22052025-00319" } }
        }
    });
    if (!exists && tds && bank) {
        await prisma.voucher.create({
            data: {
                id: randomUUID(),
                voucherNo: "11556-TDS-MAR25",
                voucherType: "PAYMENT",
                sourceId: randomUUID(),
                branchId: BRANCH_ID,
                narration: "BEING TDS ON CONTRACT SHORTFALL PAID OF MAR-25 VIDE CIN NO. : 0230001-22052025-00319",
                voucherDate: new Date("2025-05-21T18:30:00.000Z"),
                totalDebit: 89,
                totalCredit: 89,
                entries: {
                    create: [
                        { ledgerId: tds.id, branchId: BRANCH_ID, entryType: "DEBIT", amount: 89, narration: "TDS ON CONTRACT shortfall Mar-25" },
                        { ledgerId: bank.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 89, narration: "TDS payment CIN 0230001-22052025-00319" }
                    ]
                }
            }
        });
        console.log("created 11556-TDS-MAR25");
    } else console.log("already present or missing ledgers", { exists: Boolean(exists), tds: tds?.id, bank: bank?.id });
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
