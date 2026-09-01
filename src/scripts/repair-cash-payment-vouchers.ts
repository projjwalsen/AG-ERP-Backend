import fs from "fs";
import path from "path";
import { EntryType, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";

/**
 * Reclassifies already-imported Tally CASH PAYMENT rows.
 *
 * Usage:
 *   npx tsx src/scripts/repair-cash-payment-vouchers.ts <workbook.xlsx> --dry-run
 *   npx tsx src/scripts/repair-cash-payment-vouchers.ts <workbook.xlsx>
 *
 * The script updates Voucher.voucherType and corrects the payment-side
 * LedgerEntry debit/credit side from the Excel Debit/Credit column. It does
 * not inspect payment mode or paymentThrough, and preserves all amounts.
 * It is idempotent: already-repaired vouchers are skipped.
 */

const workbookPath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

const normalize = (value: unknown) =>
    String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

const sameDay = (left: Date | null | undefined, right: Date | null | undefined) => {
    if (!left || !right) return false;
    return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
};

const findHeaderRow = (worksheet: any) => {
    const rawRows = worksheet["!ref"]
        ? require("xlsx").utils.sheet_to_json(worksheet, { header: 1, defval: "" })
        : [];
    const index = rawRows.findIndex((row: any[]) => {
        const headers = row.map(value => normalize(value));
        return headers.includes("DATE") &&
            headers.includes("PARTICULARS") &&
            headers.some(value => value === "VCH TYPE" || value === "VOUCHER TYPE") &&
            headers.some(value => value === "VCH NO" || value === "VOUCHER NO") &&
            headers.some(value => value === "DEBIT" || value === "DEBIT AMOUNT") &&
            headers.some(value => value === "CREDIT" || value === "CREDIT AMOUNT");
    });
    if (index < 0) throw new Error("Could not detect the journal header row");
    return index + 1;
};

async function main() {
    if (!workbookPath) {
        throw new Error("Workbook path is required");
    }

    const absolutePath = path.resolve(workbookPath);
    const workbook = ExcelImportService.readExcel(fs.readFileSync(absolutePath));
    const worksheet = ExcelImportService.getWorkSheet(workbook);
    const headerRow = findHeaderRow(worksheet);
    const rows = ExcelImportService.readRows(worksheet, { headerRow });
    const normalizedRows = rows.map(row => {
        const particulars = String(row.particulars || "").trim();
        const continuation = Object.entries(row)
            .filter(([key, value]) => key.startsWith("__empty") && String(value || "").trim())
            .map(([, value]) => String(value).trim())[0];
        return {
            ...row,
            // Cash-book exports use column B for By/To and column C for the
            // actual account name. Journal imports use Particulars directly.
            particulars: ["BY", "TO"].includes(normalize(particulars)) && continuation
                ? continuation
                : particulars
        };
    });
    const cashRows = ExcelImportService.parseJournalRows(normalizedRows)
        .filter(row => normalize(row.voucherType) === "CASH PAYMENT");

    if (cashRows.length === 0) {
        throw new Error("No CASH PAYMENT rows found in the workbook");
    }

    const result = await prisma.$transaction(async tx => {
        const updates: Array<{ voucherId: string; voucherNo: string; importKey: string; paymentEntryId: string; paymentEntryType: EntryType; headEntryId: string; headEntryType: EntryType }> = [];
        const skipped = { alreadyCashPayment: 0 };
        const failures: string[] = [];

        for (const row of cashRows) {
            const importKey = `CASH PAYMENT_${row.voucherNo}_${row.importIndex}`;
            const candidates = await tx.journal.findMany({
                where: {
                    importKey: { startsWith: `CASH PAYMENT_${row.voucherNo}_` }
                },
                include: {
                    journalHead: true,
                    voucher: { include: { entries: true } }
                }
            });
            const amount = Math.abs(Number(row.debitAmount || row.creditAmount || 0));
            const identityMatches = candidates.filter(candidate =>
                Math.abs(Number(candidate.amount || 0) - amount) <= 0.01 &&
                normalize(candidate.remarks) === normalize(row.particulars)
            );
            // Prefer the date-qualified match. If the workbook has no usable
            // date, or the date is not present in the imported journal, use
            // the other identifying fields. Only a unique fallback is safe.
            const dateMatches = row.date
                ? identityMatches.filter(candidate => sameDay(candidate.journalDate, row.date))
                : [];
            const matches = dateMatches.length === 1
                ? dateMatches
                : (!row.date && identityMatches.length === 1) ||
                    (dateMatches.length === 0 && identityMatches.length === 1)
                    ? identityMatches
                    : dateMatches.length > 1
                        ? dateMatches
                        : identityMatches;
            const journal = matches.length === 1 ? matches[0] : null;
            if (!journal) {
                failures.push(`voucherNo=${row.voucherNo}, importKey=${importKey}, matches=${matches.length}`);
                continue;
            }

            if (!journal.voucherId || !journal.voucher) {
                failures.push(`voucherNo=${row.voucherNo}, importKey=${importKey}, approved voucher not found`);
                continue;
            }

            const headEntry = journal.voucher.entries.find(
                (entry: any) => entry.ledgerId === journal.journalHead.ledgerId
            );
            const paymentEntries = journal.voucher.entries.filter(
                (entry: any) => entry.ledgerId !== journal.journalHead.ledgerId
            );
            if (!headEntry || paymentEntries.length !== 1) {
                failures.push(`voucherNo=${row.voucherNo}, voucher=${journal.voucher.voucherNo}, expected one journal-head and one payment entry`);
                continue;
            }

            const hasDebit = Number(row.debitAmount || 0) > 0;
            const hasCredit = Number(row.creditAmount || 0) > 0;
            if (hasDebit === hasCredit) {
                failures.push(`voucherNo=${row.voucherNo}, voucher=${journal.voucher.voucherNo}, Excel must contain exactly one positive Debit or Credit amount`);
                continue;
            }
            const desiredPaymentEntryType = Number(row.creditAmount || 0) > 0
                ? EntryType.CREDIT
                : EntryType.DEBIT;
            const desiredHeadEntryType = desiredPaymentEntryType === EntryType.CREDIT
                ? EntryType.DEBIT
                : EntryType.CREDIT;

            const conflictingVoucher = await tx.voucher.findFirst({
                where: {
                    sourceId: journal.id,
                    voucherType: VoucherType.CASH_PAYMENT,
                    id: { not: journal.voucher.id }
                },
                select: { id: true, voucherNo: true }
            });
            if (conflictingVoucher) {
                failures.push(`voucherNo=${row.voucherNo}, source=${journal.id}, existing CASH_PAYMENT voucher=${conflictingVoucher.voucherNo}`);
                continue;
            }

            if (journal.voucher.voucherType === VoucherType.CASH_PAYMENT) {
                skipped.alreadyCashPayment++;
            }
            updates.push({
                voucherId: journal.voucher.id,
                voucherNo: journal.voucher.voucherNo,
                importKey,
                paymentEntryId: paymentEntries[0].id,
                paymentEntryType: desiredPaymentEntryType,
                headEntryId: headEntry.id,
                headEntryType: desiredHeadEntryType
            });
        }

        if (failures.length > 0) {
            throw new Error(`Repair aborted; no rows changed.\n${failures.join("\n")}`);
        }

        if (!dryRun) {
            for (const update of updates) {
                await tx.ledgerEntry.update({
                    where: { id: update.paymentEntryId },
                    data: { entryType: update.paymentEntryType }
                });
                await tx.ledgerEntry.update({
                    where: { id: update.headEntryId },
                    data: { entryType: update.headEntryType }
                });
                await tx.voucher.update({
                    where: { id: update.voucherId },
                    data: { voucherType: VoucherType.CASH_PAYMENT }
                });
            }
        }

        return { workbookRows: cashRows.length, changed: updates.length, entrySidesCorrected: updates.length, ...skipped, dryRun };
    });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
