import "dotenv/config";
import fs from "fs";
import path from "path";
import {
    EntryType,
    LedgerNature,
    LedgerType,
    PaymentMode,
    PaymentType,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

/**
 * Repairs Payment/Receipt rows imported as journals.
 * Keeps Journal and Voucher records; changes their payment metadata and
 * replaces the payment-side posting with the Bank of Maharashtra ledger.
 * Payment: journal head DEBIT, bank CREDIT.
 * Receipt: journal head CREDIT, bank DEBIT.
 *
 * Dry run:
 *   npm run repair:journal-payment-receipts -- "file.xlsx"
 * Apply:
 *   npm run repair:journal-payment-receipts -- "file.xlsx" --apply
 */

const args = process.argv.slice(2);
const workbookPath = args.find(value => !value.startsWith("--"));
const apply = args.includes("--apply");
const branchIndex = args.indexOf("--branch");
const requestedBranchId = branchIndex >= 0 ? args[branchIndex + 1] : undefined;

const normalize = (value: unknown) =>
    String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

const sameDay = (left: Date | null | undefined, right: Date | null | undefined) =>
    Boolean(left && right) && left!.toISOString().slice(0, 10) === right!.toISOString().slice(0, 10);

const getAmount = (row: { debitAmount: number; creditAmount: number }) => {
    const debit = Math.abs(Number(row.debitAmount || 0));
    const credit = Math.abs(Number(row.creditAmount || 0));
    if ((debit > 0) === (credit > 0)) {
        throw new Error("Excel row must contain exactly one positive Debit or Credit amount");
    }
    return Math.round(Math.max(debit, credit) * 100) / 100;
};

async function main() {
    if (!workbookPath) throw new Error("Workbook path is required");

    const workbook = ExcelImportService.readExcel(
        fs.readFileSync(path.resolve(workbookPath))
    );
    const rows = workbook.SheetNames.flatMap(sheetName =>
        ExcelImportService.parseJournalRows(
            ExcelImportService.readRows(
                ExcelImportService.getWorkSheet(workbook, sheetName),
                { headerRow: 8 }
            ),
            sheetName
        )
    ).filter(row => ["PAYMENT", "RECEIPT"].includes(normalize(row.voucherType)));

    if (!rows.length) throw new Error("No Payment or Receipt rows found");

    const result = await prisma.$transaction(async tx => {
        if (apply) await LedgerService.ensureDefaultLedgerGroups(tx);
        const branches = await tx.branch.findMany({
            where: { isActive: true, ...(requestedBranchId ? { id: requestedBranchId } : {}) },
            select: { id: true, code: true },
            orderBy: { createdAt: "asc" }
        });
        if (branches.length !== 1) {
            throw new Error("One active branch is required; use --branch <branch UUID> when necessary");
        }
        const branch = branches[0];

        let bankAccount = await tx.bankAccount.findFirst({
            where: {
                branchId: branch.id,
                bankName: { equals: "Bank of Maharashtra", mode: "insensitive" },
                isActive: true
            }
        });
        if (!bankAccount && apply) {
            bankAccount = await tx.bankAccount.create({
                data: {
                    branchId: branch.id,
                    bankName: "Bank of Maharashtra",
                    bankBranchName: "Imported Account",
                    accountNumber: `IMPORT-BOM-${branch.id.slice(0, 8).toUpperCase()}`,
                    ifscCode: "MAHB0000000",
                    isActive: true
                }
            });
        }
        const bankLedger = bankAccount && apply
            ? await LedgerService.getOrCreateLedger(tx, {
                code: `BANK-ACCOUNT-${branch.code}-${bankAccount.id.slice(0, 8).toUpperCase()}`,
                name: "Bank of Maharashtra",
                category: LedgerType.BANK,
                groupCode: "BANK_ACCOUNTS",
                nature: LedgerNature.DEBIT,
                branchId: branch.id
            })
            : null;

        const repaired: any[] = [];
        const failures: any[] = [];

        for (const row of rows) {
            let amount: number;
            try { amount = getAmount(row); }
            catch (error: any) {
                failures.push({ row: row.sourceRow, voucherNo: row.voucherNo, error: error.message });
                continue;
            }

            const sourceType = normalize(row.voucherType);
            // Journal import creates this exact key from the Excel voucher
            // type, voucher number and source row index. Match it exactly so
            // a similar date/amount/particular can never select another row.
            const importKey = `${sourceType}_${row.voucherNo}_${row.importIndex}`;
            const keyed = await tx.journal.findMany({
                where: { importKey, voucherId: { not: null } },
                include: { journalHead: true, voucher: { include: { entries: true } } }
            });
            const matches = keyed.filter(journal =>
                journal.voucher &&
                normalize(journal.remarks) === normalize(row.particulars) &&
                Math.abs(Number(journal.amount) - amount) <= 0.01 &&
                (!row.date || sameDay(journal.journalDate, row.date))
            );
            if (matches.length !== 1) {
                failures.push({
                    row: row.sourceRow,
                    voucherNo: row.voucherNo,
                    importKey,
                    error: `Exact imported journal key not found or validation failed (matches=${matches.length})`
                });
                continue;
            }

            const journal = matches[0];
            const entries = journal.voucher!.entries;
            const headEntry = entries.find(entry => entry.ledgerId === journal.journalHead.ledgerId);
            const paymentEntries = entries.filter(entry => entry.ledgerId !== journal.journalHead.ledgerId);
            if (!headEntry || paymentEntries.length !== 1 || (apply && !bankLedger)) {
                failures.push({
                    row: row.sourceRow,
                    voucherNo: row.voucherNo,
                    error: !bankLedger && apply
                        ? "Bank of Maharashtra ledger is unavailable"
                        : `Expected one journal-head and one payment entry, found head=${Boolean(headEntry)}, payment=${paymentEntries.length}`
                });
                continue;
            }

            const bankEntry = paymentEntries[0];
            const headEntryType = sourceType === "PAYMENT" ? EntryType.DEBIT : EntryType.CREDIT;
            const bankEntryType = sourceType === "PAYMENT" ? EntryType.CREDIT : EntryType.DEBIT;
            const affectedLedgerIds = new Set([headEntry.ledgerId, bankEntry.ledgerId]);

            if (apply) {
                await tx.journal.update({
                    where: { id: journal.id },
                    data: { amount, paymentMode: PaymentMode.ONLINE, paymentThrough: PaymentType.CHEQUE }
                });
                await tx.voucher.update({
                    where: { id: journal.voucher!.id },
                    data: { voucherType: VoucherType.JOURNAL, totalDebit: amount, totalCredit: amount }
                });
                await tx.ledgerEntry.update({
                    where: { id: headEntry.id },
                    data: { entryType: headEntryType, amount }
                });
                await tx.ledgerEntry.update({
                    where: { id: bankEntry.id },
                    data: {
                        ledgerId: bankLedger!.id,
                        entryType: bankEntryType,
                        amount,
                        narration: `Bank of Maharashtra ${sourceType}`
                    }
                });
                affectedLedgerIds.add(bankLedger!.id);
                for (const ledgerId of affectedLedgerIds) {
                    await LedgerService.syncCachedBalance(tx, ledgerId);
                }
            }

            repaired.push({
                voucherNo: row.voucherNo,
                voucherId: journal.voucher!.id,
                journalId: journal.id,
                amount,
                voucherType: "JOURNAL",
                headEntryType,
                bankEntryType,
                bank: "Bank of Maharashtra",
                action: apply ? "repaired" : "would-repair"
            });
        }

        if (apply && failures.length) {
            throw new Error(`Repair aborted; no changes committed:\n${JSON.stringify(failures, null, 2)}`);
        }
        return { workbookRows: rows.length, repaired: repaired.length, failures, dryRun: !apply, repairedRows: repaired };
    }, {
        // This repair processes the complete workbook and may update many
        // ledger rows. Keep the extended timeout local to this script.
        maxWait: 120_000,
        timeout: 15 * 60_000
    });
    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
