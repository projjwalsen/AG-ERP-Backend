import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const SALARY = "1b31070e-c9a2-4997-bda6-8613bbc8c5ce";
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(d);

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: SALARY,
            amount: 659700,
            voucher: { voucherNo: "57" }
        },
        include: {
            voucher: {
                include: {
                    entries: {
                        include: { ledger: { select: { id: true, name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } } }
                    },
                    journals: { select: { id: true, status: true, amount: true, journalHead: { select: { ledgerId: true } } } }
                }
            }
        }
    });

    const byNarr = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: SALARY,
            OR: [
                { narration: { contains: "CLOSING BALANCE AS ON 31/03/2025", mode: "insensitive" } },
                { voucher: { narration: { contains: "CLOSING BALANCE AS ON 31/03/2025", mode: "insensitive" } } },
                { amount: 659700 }
            ]
        },
        include: {
            voucher: {
                select: {
                    id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
                    entries: {
                        select: {
                            id: true, entryType: true, amount: true, narration: true,
                            ledger: { select: { name: true, category: true } }
                        }
                    }
                }
            }
        }
    });

    console.log(JSON.stringify({
        byAmountAndNo: entries.map(e => ({
            entryId: e.id,
            side: e.entryType,
            amt: Number(e.amount),
            narr: e.narration,
            voucher: {
                id: e.voucher.id,
                no: e.voucher.voucherNo,
                type: e.voucher.voucherType,
                date: localDate(e.voucher.voucherDate),
                narr: e.voucher.narration,
                journals: e.voucher.journals,
                entries: e.voucher.entries.map(x => ({
                    id: x.id,
                    side: x.entryType,
                    amt: Number(x.amount),
                    narr: x.narration,
                    ledger: x.ledger.name,
                    cat: x.ledger.category,
                    group: `${x.ledger.group?.parent?.name} > ${x.ledger.group?.name}`
                }))
            }
        })),
        byNarr: byNarr.map(e => ({
            entryId: e.id,
            side: e.entryType,
            amt: Number(e.amount),
            narr: e.narration,
            no: e.voucher.voucherNo,
            type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate),
            vnarr: e.voucher.narration,
            others: e.voucher.entries.filter(x => x.id !== e.id).map(x => ({
                name: x.ledger.name, cat: x.ledger.category, side: x.entryType, amt: Number(x.amount)
            }))
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
