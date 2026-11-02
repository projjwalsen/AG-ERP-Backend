import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const IDS = {
    cgst: "790d2e2c-e33e-4dc5-af63-4eedf425cb7b",
    sgst: "04f3883d-ee82-4611-94d6-7bebd7daedd2",
    igst: "5ae52a86-7117-4295-83aa-2d05e9b53486"
};

(async () => {
    const out: any = {};
    for (const [k, id] of Object.entries(IDS)) {
        const j = await prisma.journal.findFirst({
            where: { journalHead: { ledgerId: id }, status: "APPROVED", branchId: BRANCH },
            select: {
                paymentMode: true, createdById: true, categoryId: true, direction: true,
                journalHeadId: true
            }
        });
        const l = await prisma.ledger.findUnique({ where: { id }, select: { name: true, isActive: true } });
        out[k] = { id, ...l, journal: j };
    }
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
