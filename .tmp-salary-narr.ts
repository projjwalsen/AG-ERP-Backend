import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const IDS = {
    wages: "e31befe2-658a-41f7-a616-d2e6e0d1c07f",
    anil: "98808105-118b-4790-9395-3f1c1dea2593",
    prar: "e63e1ad7-d57c-4e6c-b9e9-ecfe9e449471",
    vani: "8a72bc47-fa41-4feb-aa6d-ce8fb2c33857"
};

(async () => {
    const heads = {};
    for (const [k, id] of Object.entries(IDS)) {
        const j = await prisma.journal.findFirst({
            where: { journalHead: { ledgerId: id }, status: "APPROVED", branchId: BRANCH },
            select: {
                paymentMode: true, createdById: true, categoryId: true, direction: true,
                journalHeadId: true, remarks: true
            }
        });
        heads[k] = j;
    }
    const may = await prisma.voucher.findMany({
        where: {
            branchId: BRANCH,
            voucherNo: "17",
            narration: { contains: "MENDA", mode: "insensitive" }
        },
        select: { id: true, voucherDate: true, narration: true, voucherType: true }
    });
    console.log(JSON.stringify({ heads, may }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
