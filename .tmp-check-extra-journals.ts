import "dotenv/config";
import { prisma } from "./src/config/db";

const LEDGERS = [
    "60f1c817-d460-45e0-97d2-f37b123b6394",
    "f9275344-4c92-41fb-b579-d018e37c1a9b"
];
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const ist = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: LEDGERS } },
        include: { voucher: { select: { voucherType: true, voucherNo: true, voucherDate: true, narration: true } } }
    });
    const targets = [
        { ledgerId: LEDGERS[0], date: "2025-04-06", amount: 2000000 },
        { ledgerId: LEDGERS[0], date: "2025-05-03", amount: 3800000 },
        { ledgerId: LEDGERS[1], date: "2025-04-17", amount: 20000000 },
        { ledgerId: LEDGERS[1], date: "2025-05-03", amount: 943000 }
    ];
    const out = targets.map(t => {
        const hits = entries.filter(e =>
            e.ledgerId === t.ledgerId &&
            ist(e.voucher.voucherDate) === t.date &&
            money(e.amount) === t.amount
        ).map(e => ({
            id: e.id,
            type: e.entryType,
            voucherType: e.voucher.voucherType,
            no: e.voucher.voucherNo,
            narration: e.narration || e.voucher.narration
        }));
        return { ...t, hits };
    });
    const tally = [
        { name: "Sulaki Chemicals Pvt Ltd-CR", close: 82486152, open: 82486152 },
        { name: "SHREE GURU KRIPA ENTERPRISES (CR)", close: 4883434, open: 4883434 }
    ];
    console.log(JSON.stringify({ matches: out, tally }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
