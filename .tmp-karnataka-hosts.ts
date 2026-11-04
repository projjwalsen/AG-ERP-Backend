import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const NOS = ["10991", "11308"];

(async () => {
    const vs = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: { in: NOS } },
        select: {
            id: true, voucherNo: true, voucherType: true, voucherDate: true,
            totalDebit: true, totalCredit: true, narration: true,
            entries: {
                select: {
                    id: true, entryType: true, amount: true, ledgerId: true,
                    ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                }
            }
        },
        orderBy: [{ voucherNo: "asc" }, { voucherType: "asc" }]
    });
    console.log(JSON.stringify(vs, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
