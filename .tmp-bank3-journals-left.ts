import "dotenv/config";
import { prisma } from "./src/config/db";

const NOS = ["10797", "10779", "10756", "10768", "10761", "10774", "10807", "10764", "10789", "8908", "14080", "13784", "17209"];

(async () => {
    const journals = await prisma.journal.findMany({
        where: { voucherNo: { in: NOS } },
        select: {
            id: true, voucherNo: true, voucherId: true, amount: true, status: true, direction: true,
            journalHead: { select: { name: true } }
        }
    });
    const byNo: Record<string, any[]> = {};
    for (const j of journals) {
        (byNo[j.voucherNo || ""] ||= []).push({
            id: j.id, voucherId: j.voucherId, amt: Number(j.amount), status: j.status,
            dir: j.direction, head: j.journalHead?.name
        });
    }
    console.log(JSON.stringify({ n: journals.length, byNo }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
