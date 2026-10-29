import "dotenv/config";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

/**
 * Deletes the Indirect Expense vouchers dated before FY 2025-26
 * (voucherDate < 2025-04-01 IST) and unlinks related journals, notes,
 * manufactures and transactions so no orphan accounting rows remain.
 *
 * Dry run:
 *   npx tsx src/scripts/delete-listed-indirect-opening-vouchers.ts
 * Apply:
 *   npx tsx src/scripts/delete-listed-indirect-opening-vouchers.ts --apply
 */

const apply = process.argv.includes("--apply");
const FY_START_IST = new Date("2025-03-31T18:30:00.000Z");

const normalize = (value: unknown) =>
    String(value ?? "")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

async function findTargetVouchers() {
    const groups = await prisma.ledgerGroup.findMany({
        select: { id: true, name: true, parentId: true }
    });
    const rootIds = groups
        .filter(group => ["indirect expense", "indirect expenses"].includes(normalize(group.name).toLowerCase()))
        .map(group => group.id);
    const groupIds = new Set(rootIds);
    let growing = true;
    while (growing) {
        growing = false;
        for (const group of groups) {
            if (group.parentId && groupIds.has(group.parentId) && !groupIds.has(group.id)) {
                groupIds.add(group.id);
                growing = true;
            }
        }
    }

    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...groupIds] } },
        select: { id: true, name: true }
    });
    const ledgerIds = ledgers.map(ledger => ledger.id);
    if (ledgerIds.length === 0) {
        throw new Error("No Indirect Expense ledgers found");
    }

    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgerIds },
            voucher: { voucherDate: { lt: FY_START_IST } }
        },
        select: {
            entryType: true,
            amount: true,
            ledgerId: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    voucherType: true,
                    voucherDate: true,
                    narration: true,
                    sourceId: true,
                    totalDebit: true,
                    totalCredit: true
                }
            }
        }
    });

    const byVoucher = new Map<string, {
        voucher: (typeof entries)[number]["voucher"];
        debit: number;
        credit: number;
        entryCount: number;
        ledgers: string[];
    }>();
    const ledgerName = new Map(ledgers.map(ledger => [ledger.id, ledger.name]));
    for (const entry of entries) {
        const current = byVoucher.get(entry.voucher.id) || {
            voucher: entry.voucher,
            debit: 0,
            credit: 0,
            entryCount: 0,
            ledgers: []
        };
        if (entry.entryType === "DEBIT") current.debit += Number(entry.amount);
        else current.credit += Number(entry.amount);
        current.entryCount += 1;
        current.ledgers.push(ledgerName.get(entry.ledgerId) || entry.ledgerId);
        byVoucher.set(entry.voucher.id, current);
    }

    return [...byVoucher.values()].sort((a, b) =>
        a.voucher.voucherDate.getTime() - b.voucher.voucherDate.getTime()
    );
}

async function loadVoucherGraph(voucherIds: string[]) {
    return prisma.voucher.findMany({
        where: { id: { in: voucherIds } },
        select: {
            id: true,
            voucherNo: true,
            voucherType: true,
            voucherDate: true,
            narration: true,
            sourceId: true,
            journals: { select: { id: true, voucherNo: true, serialNo: true, status: true, amount: true } },
            debitCreditNotes: { select: { id: true, noteNo: true, type: true, status: true, totalAmount: true } },
            manufactures: { select: { id: true } },
            transaction: { select: { id: true, transactionNo: true, status: true, debitCreditNoteId: true } },
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true } }
        }
    });
}

async function main() {
    const listed = await findTargetVouchers();
    const voucherIds = listed.map(row => row.voucher.id);
    if (voucherIds.length === 0) {
        console.log(JSON.stringify({ voucherCount: 0, message: "No matching vouchers found" }, null, 2));
        return;
    }

    const graph = await loadVoucherGraph(voucherIds);
    const journalIds = [...new Set(graph.flatMap(voucher => voucher.journals.map(row => row.id)))];
    const noteIds = [...new Set(graph.flatMap(voucher => voucher.debitCreditNotes.map(row => row.id)))];
    const manufactureIds = [...new Set(graph.flatMap(voucher => voucher.manufactures.map(row => row.id)))];
    const transactionIds = [...new Set(graph.flatMap(voucher => voucher.transaction.map(row => row.id)))];
    const sourceIds = [...new Set(graph.map(voucher => voucher.sourceId).filter(Boolean))];
    const ledgerIds = [...new Set(graph.flatMap(voucher => voucher.entries.map(entry => entry.ledgerId)))];

    const sourceTransactions = sourceIds.length
        ? await prisma.transaction.findMany({
            where: { id: { in: sourceIds } },
            select: {
                id: true,
                transactionNo: true,
                status: true,
                debitCreditNoteId: true,
                allocations: { select: { id: true } }
            }
        })
        : [];
    const sourceNotes = sourceIds.length
        ? await prisma.debitCreditNote.findMany({
            where: { id: { in: sourceIds } },
            select: { id: true, noteNo: true, type: true, status: true }
        })
        : [];

    const preview = {
        dryRun: !apply,
        voucherCount: graph.length,
        journalCount: journalIds.length,
        debitCreditNoteCount: [...new Set([...noteIds, ...sourceNotes.map(note => note.id)])].length,
        manufactureCount: manufactureIds.length,
        linkedTransactionCount: [...new Set([...transactionIds, ...sourceTransactions.map(row => row.id)])].length,
        ledgerEntryCount: graph.reduce((sum, voucher) => sum + voucher.entries.length, 0),
        affectedLedgerCount: ledgerIds.length,
        totalIndirectDebit: Number(listed.reduce((sum, row) => sum + row.debit, 0).toFixed(2)),
        totalIndirectCredit: Number(listed.reduce((sum, row) => sum + row.credit, 0).toFixed(2)),
        voucherTypes: Object.fromEntries(
            [...graph.reduce((map, voucher) => {
                map.set(voucher.voucherType, (map.get(voucher.voucherType) || 0) + 1);
                return map;
            }, new Map<string, number>())]
        ),
        sample: listed.slice(0, 5).map(row => ({
            id: row.voucher.id,
            date: row.voucher.voucherDate.toISOString().slice(0, 10),
            voucherNo: normalize(row.voucher.voucherNo),
            voucherType: row.voucher.voucherType,
            debit: money(row.debit),
            credit: money(row.credit),
            narration: normalize(row.voucher.narration).slice(0, 80)
        }))
    };

    if (!apply) {
        console.log(JSON.stringify(preview, null, 2));
        console.log("Dry run only. Re-run with --apply to delete these vouchers and their accounting links.");
        return;
    }

    const deleteNoteIds = [...new Set([...noteIds, ...sourceNotes.map(note => note.id)])];
    const deleteTransactionIds = [...new Set([...transactionIds, ...sourceTransactions.map(row => row.id)])];

    const BATCH = 80;
    for (let offset = 0; offset < voucherIds.length; offset += BATCH) {
        const batchIds = voucherIds.slice(offset, offset + BATCH);
        const batchGraph = graph.filter(voucher => batchIds.includes(voucher.id));
        const batchJournalIds = batchGraph.flatMap(voucher => voucher.journals.map(row => row.id));
        const batchNoteIds = batchGraph.flatMap(voucher => voucher.debitCreditNotes.map(row => row.id));
        const batchManufactureIds = batchGraph.flatMap(voucher => voucher.manufactures.map(row => row.id));
        const batchTransactionIds = [
            ...batchGraph.flatMap(voucher => voucher.transaction.map(row => row.id)),
            ...sourceTransactions.filter(row => batchGraph.some(voucher => voucher.sourceId === row.id)).map(row => row.id)
        ];
        const batchSourceNoteIds = sourceNotes
            .filter(note => batchGraph.some(voucher => voucher.sourceId === note.id))
            .map(note => note.id);
        const notesToClear = [...new Set([...batchNoteIds, ...batchSourceNoteIds])];
        const txnsToClear = [...new Set(batchTransactionIds)];

        await prisma.$transaction(async tx => {
            if (batchJournalIds.length) {
                await tx.journal.deleteMany({ where: { id: { in: batchJournalIds } } });
            }
            if (notesToClear.length) {
                await tx.transaction.updateMany({
                    where: { debitCreditNoteId: { in: notesToClear } },
                    data: { debitCreditNoteId: null }
                });
                await tx.debitCreditNote.updateMany({
                    where: { id: { in: notesToClear } },
                    data: { voucherId: null }
                });
            }
            if (batchManufactureIds.length) {
                await tx.productManufacture.updateMany({
                    where: { id: { in: batchManufactureIds } },
                    data: { voucherId: null }
                });
            }
            if (txnsToClear.length) {
                await tx.transactionAllocation.deleteMany({
                    where: { transactionId: { in: txnsToClear } }
                });
                for (const voucher of batchGraph) {
                    if (voucher.transaction.length) {
                        await tx.voucher.update({
                            where: { id: voucher.id },
                            data: { transaction: { set: [] } }
                        });
                    }
                }
            }
            await tx.ledgerEntry.deleteMany({ where: { voucherId: { in: batchIds } } });
            await tx.voucher.deleteMany({ where: { id: { in: batchIds } } });
            if (txnsToClear.length) {
                await tx.transaction.deleteMany({ where: { id: { in: txnsToClear } } });
            }
            if (notesToClear.length) {
                await tx.debitCreditNote.deleteMany({ where: { id: { in: notesToClear } } });
            }
        }, { maxWait: 120_000, timeout: 180_000 });
    }

    for (const ledgerId of ledgerIds) {
        await LedgerService.syncCachedBalance(prisma, ledgerId);
    }

    const remaining = await findTargetVouchers();
    const remainingLinks = remaining.length === 0
        ? { journals: 0, notes: 0, entries: 0, vouchers: 0 }
        : {
            journals: await prisma.journal.count({ where: { voucherId: { in: remaining.map(row => row.voucher.id) } } }),
            notes: await prisma.debitCreditNote.count({ where: { voucherId: { in: remaining.map(row => row.voucher.id) } } }),
            entries: await prisma.ledgerEntry.count({ where: { voucherId: { in: remaining.map(row => row.voucher.id) } } }),
            vouchers: remaining.length
        };

    console.log(JSON.stringify({
        ...preview,
        dryRun: false,
        deletedVouchers: voucherIds.length,
        deletedJournals: journalIds.length,
        deletedDebitCreditNotes: deleteNoteIds.length,
        deletedTransactions: deleteTransactionIds.length,
        unlinkedManufactures: manufactureIds.length,
        syncedLedgers: ledgerIds.length,
        remainingAfterDelete: remainingLinks
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
