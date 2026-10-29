import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const names = [
    "UNIPROC ENERGIES PRIVATE LIMITED",
    "A G ART PETROCHEM LLP - CR",
    "BRBL INDIA (OPC) PRIVATE LIMITED- CRS",
    "A G ART PETROCHEM LLP"
];

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: {
            branchId: BRANCH_ID,
            OR: names.map(n => ({ name: { equals: n, mode: "insensitive" } }))
        },
        select: {
            id: true, name: true, code: true, category: true, groupId: true,
            openingDebit: true, openingCredit: true, openingBalance: true,
            openingBalanceDate: true, isActive: true,
            group: { select: { id: true, name: true, code: true, parentId: true } }
        }
    });
    const parents = await prisma.ledgerGroup.findMany({
        where: { id: { in: [...new Set(ledgers.map(l => l.group.parentId).filter(Boolean) as string[])] } },
        select: { id: true, name: true, code: true, parentId: true }
    });
    const parentMap = new Map(parents.map(p => [p.id, p]));
    const customers = await prisma.ledger.findMany({
        where: {
            category: "CUSTOMER",
            OR: [
                { name: { contains: "UNIPROC", mode: "insensitive" } },
                { name: { contains: "A G ART", mode: "insensitive" } },
                { name: { contains: "BRBL", mode: "insensitive" } }
            ]
        },
        select: { id: true, name: true, category: true, branchId: true, group: { select: { name: true, code: true } } }
    });

    const out: any[] = [];
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id },
            select: {
                id: true, entryType: true, amount: true, branchId: true, narration: true,
                voucher: {
                    select: {
                        id: true, voucherNo: true, voucherType: true, voucherDate: true,
                        branchId: true,
                        journals: { select: { id: true, status: true, amount: true, direction: true } }
                    }
                }
            },
            orderBy: { createdAt: "asc" }
        });
        const journals = await prisma.journal.findMany({
            where: { journalHead: { ledgerId: l.id } },
            select: {
                id: true, amount: true, direction: true, status: true, journalDate: true,
                voucherId: true, voucher: { select: { voucherNo: true, voucherType: true, _count: { select: { entries: true } } } }
            }
        });
        const byType: Record<string, { n: number; dr: number; cr: number }> = {};
        for (const e of entries) {
            const t = e.voucher.voucherType;
            byType[t] = byType[t] || { n: 0, dr: 0, cr: 0 };
            byType[t].n += 1;
            if (e.entryType === "DEBIT") byType[t].dr += Number(e.amount);
            else byType[t].cr += Number(e.amount);
        }
        const openish = entries.filter(e =>
            e.voucher.voucherType === "OPENING_BALANCE" ||
            /opening/i.test(e.narration || "") ||
            /opening/i.test(e.voucher.voucherNo || "")
        ).map(e => ({
            type: e.voucher.voucherType, date: e.voucher.voucherDate, side: e.entryType,
            amt: Number(e.amount), num: e.voucher.voucherNo, narr: e.narration,
            journals: e.voucher.journals.length
        }));
        const parent = l.group.parentId ? parentMap.get(l.group.parentId) : null;
        out.push({
            id: l.id, name: l.name, code: l.code, category: l.category, active: l.isActive,
            group: `${parent?.name || "?"} > ${l.group.name} (${l.group.code})`,
            groupId: l.groupId,
            fieldOpen: { dr: Number(l.openingDebit), cr: Number(l.openingCredit), bal: Number(l.openingBalance) },
            entryCount: entries.length,
            byType,
            openish,
            journalCount: journals.length,
            voucherlessJournals: journals.filter(j => !j.voucherId || (j.voucher?._count.entries || 0) === 0).map(j => ({
                id: j.id, amt: Number(j.amount), dir: j.direction, status: j.status,
                date: j.journalDate, voucherId: j.voucherId,
                vType: j.voucher?.voucherType, vNum: j.voucher?.voucherNo,
                vEntries: j.voucher?._count.entries
            }))
        });
    }
    console.log(JSON.stringify({ ledgers: out, customers }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
