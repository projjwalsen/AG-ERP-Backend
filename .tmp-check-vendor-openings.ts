import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const SYSTEM = "ac2dc945-d13c-4116-ac64-a89f7ba5c1e2";

(async () => {
    const vendors = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: SYSTEM },
        select: { id: true, name: true, category: true, openingBalance: true, openingDebit: true, openingCredit: true }
    });
    const withOpening = vendors.filter(v =>
        Number(v.openingDebit) !== 0 || Number(v.openingCredit) !== 0 || Number(v.openingBalance) !== 0
    );
    const sumBal = vendors.reduce((s, v) => s + Number(v.openingBalance || 0), 0);
    const sumDr = vendors.reduce((s, v) => s + Number(v.openingDebit || 0), 0);
    const sumCr = vendors.reduce((s, v) => s + Number(v.openingCredit || 0), 0);
    console.log(JSON.stringify({
        vendors: vendors.length,
        withOpening: withOpening.length,
        sumBal, sumDr, sumCr,
        sample: withOpening.slice(0, 8)
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
