import fs from "fs";
import path from "path";
import {
    DebitCreditNoteSourceType,
    DebitCreditNoteType,
    EntryType,
    LedgerType,
    TransactionDirection,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";
import { ExcelImportService } from "../modules/import/excelImport.service";
import {
    buildTransactionImportKey,
    normalizeImportedPartyName,
    normalizeImportedTransactionType
} from "../modules/import/transaction-import.utils";

/**
 * Repairs imported workbook rows whose source Vch Type is
 * "Inward Credit Note" but which were stored as DEBIT_NOTE.
 *
 * Dry run (default):
 *   npm run repair:import-credit-notes -- <workbook.xlsx> --branch <uuid>
 *
 * Apply:
 *   npm run repair:import-credit-notes -- <workbook.xlsx> --branch <uuid> --apply
 */

const args = process.argv.slice(2);
const workbookPath = args.find(argument => !argument.startsWith("--"));
const branchIndex = args.indexOf("--branch");
const branchId = branchIndex >= 0 ? args[branchIndex + 1] : undefined;
const apply = args.includes("--apply");

const normalize = (value: unknown) =>
    String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

const dateKey = (value: Date | null | undefined) =>
    value ? value.toISOString().slice(0, 10) : "";

const closeMoney = (left: unknown, right: unknown) =>
    Math.abs(Number(left || 0) - Number(right || 0)) <= 0.01;

const replaceDebitLabel = (value: string | null | undefined) =>
    value
        ?.replace(/INWARD\s+DEBIT\s+NOTE/gi, "INWARD CREDIT NOTE")
        .replace(/DEBIT_NOTE/g, "CREDIT_NOTE") || value;

const findHeaderRow = (worksheet: any) => {
    const xlsx = require("xlsx");
    const rawRows = worksheet["!ref"]
        ? xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: "" })
        : [];
    const index = rawRows.findIndex((row: unknown[]) => {
        const headers = row.map(value =>
            normalize(value).replace(/[^A-Z0-9]/g, "")
        );
        return headers.includes("DATE") &&
            headers.includes("PARTICULARS") &&
            headers.some(value => ["VCHTYPE", "VOUCHERTYPE"].includes(value)) &&
            headers.some(value => ["VCHNO", "VOUCHERNO"].includes(value)) &&
            headers.some(value => ["DEBIT", "DEBITAMOUNT"].includes(value)) &&
            headers.some(value => ["CREDIT", "CREDITAMOUNT"].includes(value)) &&
            headers.includes("TYPE");
    });

    if (index < 0) throw new Error("Could not detect the workbook header row");
    return index + 1;
};

async function main() {
    if (!workbookPath) throw new Error("Workbook path is required");
    if (!branchId) throw new Error("--branch <uuid> is required");

    const absolutePath = path.resolve(workbookPath);
    const workbook = ExcelImportService.readExcel(fs.readFileSync(absolutePath));
    const worksheet = ExcelImportService.getWorkSheet(workbook);
    const rows = ExcelImportService.readRows(worksheet, {
        headerRow: findHeaderRow(worksheet)
    });
    const creditRows = ExcelImportService.parseJournalRows(rows).filter(row =>
        normalize(row.voucherType) === "INWARD CREDIT NOTE"
    );

    if (creditRows.length === 0) {
        throw new Error("No Inward Credit Note rows were found in the workbook");
    }

    const result = await prisma.$transaction(async tx => {
        const repaired: any[] = [];
        const alreadyCorrect: any[] = [];
        const missing: any[] = [];
        const ambiguous: any[] = [];

        for (const row of creditRows) {
            const amount = Number(row.debitAmount || 0);
            const importedType = normalizeImportedTransactionType(
                row.accountingVoucherType
            );
            const candidates = await tx.debitCreditNote.findMany({
                where: {
                    branchId,
                    noteNo: String(row.voucherNo || "").trim(),
                    sourceType: DebitCreditNoteSourceType.PURCHASE
                },
                include: {
                    agency: true,
                    voucher: {
                        include: {
                            entries: { include: { ledger: true } }
                        }
                    },
                    transaction: {
                        include: {
                            voucher: {
                                include: {
                                    entries: { include: { ledger: true } }
                                }
                            }
                        }
                    }
                }
            });
            const identityMatches = candidates.filter(candidate =>
                normalizeImportedPartyName(candidate.agency.name) ===
                    normalizeImportedPartyName(row.particulars) &&
                closeMoney(candidate.totalAmount, amount)
            );
            const datedMatches = identityMatches.filter(candidate =>
                !row.date || dateKey(candidate.noteDate) === dateKey(row.date)
            );
            const matches = datedMatches.length === 1
                ? datedMatches
                : identityMatches;

            if (matches.length === 0) {
                missing.push({
                    voucherNo: row.voucherNo,
                    vendor: row.particulars,
                    amount
                });
                continue;
            }
            if (matches.length !== 1) {
                ambiguous.push({
                    voucherNo: row.voucherNo,
                    vendor: row.particulars,
                    amount,
                    matches: matches.map(match => match.id)
                });
                continue;
            }

            const note: any = matches[0];
            const transaction: any = note.transaction;
            const voucher: any = note.voucher || transaction?.voucher?.[0];
            if (!voucher) {
                missing.push({
                    voucherNo: row.voucherNo,
                    vendor: row.particulars,
                    amount,
                    reason: "Accounting voucher not found"
                });
                continue;
            }

            const purchaseEntry = voucher.entries.find((entry: any) =>
                entry.ledger.category === LedgerType.PURCHASE
            );
            const bankEntry = voucher.entries.find((entry: any) =>
                entry.ledger.category === LedgerType.BANK
            );
            const vendorEntries = voucher.entries.filter((entry: any) =>
                entry.ledger.category === LedgerType.VENDOR
            );
            const adjustmentEntries = voucher.entries.filter((entry: any) =>
                entry.ledger.category !== LedgerType.VENDOR &&
                entry.ledger.category !== LedgerType.BANK
            );

            const sidesCorrect =
                (purchaseEntry?.entryType === EntryType.DEBIT ||
                    (!purchaseEntry && adjustmentEntries.every((entry: any) =>
                        entry.entryType === EntryType.DEBIT
                    ))) &&
                (!bankEntry || bankEntry.entryType === EntryType.CREDIT) &&
                vendorEntries.some((entry: any) => entry.entryType === EntryType.CREDIT) &&
                (vendorEntries.length === 1 ||
                    vendorEntries.some((entry: any) => entry.entryType === EntryType.DEBIT));
            const classificationCorrect =
                note.type === DebitCreditNoteType.CREDIT_NOTE &&
                voucher.voucherType === VoucherType.CREDIT_NOTE &&
                (!transaction ||
                    (transaction.direction === TransactionDirection.OUTWARD &&
                        transaction.voucherType === VoucherType.CREDIT_NOTE &&
                        normalizeImportedTransactionType(transaction.type) === importedType));

            if (sidesCorrect && classificationCorrect) {
                alreadyCorrect.push({ voucherNo: row.voucherNo, noteId: note.id });
                continue;
            }

            const noteImportKey = buildTransactionImportKey(
                "PURCHASE_NOTE",
                normalizeImportedPartyName(row.particulars),
                row.voucherNo,
                row.invoiceNo,
                dateKey(row.date),
                DebitCreditNoteType.CREDIT_NOTE,
                importedType,
                amount
            );
            const transactionImportKey = buildTransactionImportKey(
                "PURCHASE_NOTE_TRANSACTION",
                noteImportKey
            );

            let targetLedger = await tx.ledger.findFirst({
                where: {
                    branchId,
                    category: LedgerType.PURCHASE,
                    name: { equals: importedType, mode: "insensitive" }
                }
            });
            if (!targetLedger && apply) {
                targetLedger = await LedgerService.getOrCreateImportedPurchaseTypeLedger(
                    tx,
                    branchId,
                    importedType
                );
            }

            const entryUpdates = voucher.entries.map((entry: any, index: number) => {
                const isVendor = entry.ledger.category === LedgerType.VENDOR;
                const isBank = entry.ledger.category === LedgerType.BANK;
                let entryType: EntryType = EntryType.DEBIT;

                if (isBank) entryType = EntryType.CREDIT;
                else if (isVendor) {
                    if (vendorEntries.length === 1) entryType = EntryType.CREDIT;
                    else if (/settlement|refund/i.test(entry.narration || "")) {
                        entryType = EntryType.DEBIT;
                    } else if (/note/i.test(entry.narration || "")) {
                        entryType = EntryType.CREDIT;
                    } else {
                        entryType = index === voucher.entries.indexOf(vendorEntries[0])
                            ? EntryType.CREDIT
                            : EntryType.DEBIT;
                    }
                }

                return {
                    id: entry.id,
                    oldLedgerId: entry.ledgerId,
                    ledgerId: !isVendor && !isBank && targetLedger
                        ? targetLedger.id
                        : entry.ledgerId,
                    entryType,
                    narration: replaceDebitLabel(entry.narration)
                };
            });

            if (apply) {
                await tx.debitCreditNote.update({
                    where: { id: note.id },
                    data: {
                        type: DebitCreditNoteType.CREDIT_NOTE,
                        importKey: noteImportKey,
                        narration: replaceDebitLabel(note.narration)
                    }
                });
                if (transaction) {
                    await tx.transaction.update({
                        where: { id: transaction.id },
                        data: {
                            direction: TransactionDirection.OUTWARD,
                            voucherType: VoucherType.CREDIT_NOTE,
                            type: importedType,
                            importKey: transactionImportKey
                        }
                    });
                }
                await tx.voucher.update({
                    where: { id: voucher.id },
                    data: {
                        voucherType: VoucherType.CREDIT_NOTE,
                        narration: replaceDebitLabel(voucher.narration)
                    }
                });
                for (const entry of entryUpdates) {
                    await tx.ledgerEntry.update({
                        where: { id: entry.id },
                        data: {
                            ledgerId: entry.ledgerId,
                            entryType: entry.entryType,
                            narration: entry.narration
                        }
                    });
                }
                const ledgerIds: string[] = [...new Set<string>(
                    entryUpdates.flatMap(entry =>
                        [String(entry.oldLedgerId), String(entry.ledgerId)]
                    )
                )];
                for (const ledgerId of ledgerIds) {
                    await LedgerService.syncCachedBalance(tx, ledgerId);
                }
            }

            repaired.push({
                voucherNo: row.voucherNo,
                noteId: note.id,
                transactionId: transaction?.id || null,
                accountingVoucherId: voucher.id,
                type: importedType,
                amount,
                targetLedger: targetLedger?.name || `${importedType} (will be created)`,
                entries: entryUpdates.length
            });
        }

        if (ambiguous.length > 0) {
            throw new Error(
                `Repair aborted because matches were ambiguous:\n${JSON.stringify(ambiguous, null, 2)}`
            );
        }

        return {
            mode: apply ? "APPLY" : "DRY_RUN",
            workbookCreditNotes: creditRows.length,
            repaired: repaired.length,
            alreadyCorrect: alreadyCorrect.length,
            missing: missing.length,
            repairedRows: repaired,
            alreadyCorrectRows: alreadyCorrect,
            missingRows: missing
        };
    });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        if ((error as any)?.code === "P2022") {
            console.error(
                "Repair cannot run because the database migration is incomplete. " +
                "Apply 20260902120000_add_transaction_import_type_and_note_link first; " +
                "DebitCreditNote.importKey is required."
            );
            process.exitCode = 1;
            return;
        }
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
