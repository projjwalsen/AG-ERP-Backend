/** Read-only diagnosis for one inward debit/credit note in Trial Balance. */
import { prisma } from "../config/db";

const flagValue = (flag: string) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
};

const branchQuery = flagValue("--branch");
const voucherNo = flagValue("--voucher");

async function main() {
    if (!branchQuery || !voucherNo) {
        throw new Error("Usage: npm run diagnose:inward-note-trial-balance -- --branch <branch code/name/id> --voucher <note number>");
    }

    const branch = await prisma.branch.findFirst({
        where: {
            OR: [
                { id: branchQuery },
                { code: { equals: branchQuery, mode: "insensitive" } },
                { name: { equals: branchQuery, mode: "insensitive" } }
            ]
        },
        select: { id: true, code: true, name: true }
    });
    if (!branch) throw new Error(`Branch not found: ${branchQuery}`);

    const notes = await prisma.debitCreditNote.findMany({
        where: {
            branchId: branch.id,
            noteNo: { equals: voucherNo, mode: "insensitive" }
        },
        select: {
            id: true,
            noteNo: true,
            type: true,
            sourceType: true,
            status: true,
            noteDate: true,
            totalAmount: true,
            voucherId: true,
            agency: { select: { name: true } },
            purchase: { select: { id: true, invoiceNo: true, voucherType: true } },
            transaction: { select: { id: true, status: true, type: true, voucherType: true } }
        }
    });

    if (notes.length === 0) {
        console.log(JSON.stringify({ branch, voucherNo, found: false }, null, 2));
        return;
    }

    const result = [];
    for (const note of notes) {
        const voucherIds = new Set<string>();
        if (note.voucherId) voucherIds.add(note.voucherId);
        if (note.transaction?.id) {
            const transactionVouchers = await prisma.voucher.findMany({
                where: { sourceId: note.transaction.id },
                select: { id: true }
            });
            transactionVouchers.forEach(voucher => voucherIds.add(voucher.id));
        }
        const vouchers = await prisma.voucher.findMany({
            where: { id: { in: [...voucherIds] } },
            select: {
                id: true,
                voucherNo: true,
                voucherType: true,
                sourceId: true,
                voucherDate: true,
                entries: {
                    where: { ledger: { category: "PURCHASE" } },
                    select: {
                        entryType: true,
                        amount: true,
                        ledger: { select: { id: true, code: true, name: true, category: true } }
                    }
                }
            }
        });
        result.push({
            note: {
                id: note.id,
                noteNo: note.noteNo,
                type: note.type,
                sourceType: note.sourceType,
                status: note.status,
                date: note.noteDate,
                amount: Number(note.totalAmount),
                party: note.agency.name,
                linkedPurchase: note.purchase,
                linkedTransaction: note.transaction,
                directVoucherId: note.voucherId
            },
            purchaseLedgerVouchers: vouchers.map(voucher => ({
                ...voucher,
                entries: voucher.entries.map(entry => ({
                    entryType: entry.entryType,
                    amount: Number(entry.amount),
                    ledger: entry.ledger
                }))
            }))
        });
    }

    console.log(JSON.stringify({ branch, voucherNo, found: true, notes: result }, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
