import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const v = await prisma.voucher.findFirst({
        where: { voucherNo: "OPN-09B9F1B9" },
        include: {
            entries: { include: { ledger: { select: { id: true, name: true, groupId: true } } } },
            journals: true
        }
    });
    console.log(JSON.stringify(v, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
