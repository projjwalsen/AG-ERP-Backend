import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const ids = [
        "85e210a7-0e2b-4718-9ca7-e249bbca1760",
        "d7a1ab07-f4ec-4933-a419-9ed29c2f403d",
        "97804467-f384-4ed3-b3b9-758dc729b4f7"
    ];
    const ledgers = await prisma.ledger.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, groupId: true, openingDebit: true, openingCredit: true, currentBalance: true }
    });
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.groupBy({
            by: ["entryType"],
            where: { ledgerId: l.id },
            _sum: { amount: true },
            _count: { id: true }
        });
        console.log(JSON.stringify({ ledger: l, entries }, null, 2));
    }
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
