import fs from "fs";
import path from "path";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";

/**
 * Reclassifies already-imported Tally CASH PAYMENT rows.
 *
 * Usage:
 *   npx tsx src/scripts/repair-cash-payment-vouchers.ts <workbook.xlsx> --dry-run
 *   npx tsx src/scripts/repair-cash-payment-vouchers.ts <workbook.xlsx>
 *
 * The script updates Voucher.voucherType only. LedgerEntry rows and amounts
 * are preserved. It is idempotent: already-repaired vouchers are skipped.
 */

const workbookPath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

const normalize = (value: unknown) =>
    String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

const sameDay = (left: Date | null | undefined, right: Date | null | undefined) => {
    if (!left || !right) return false;
    return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
};

async function main() {
    if (!workbookPath) {
        throw new Error("Workbook path is required");
    }

    const absolutePath = path.resolve(workbookPath);
    const workbook = ExcelImportService.readExcel(fs.readFileSync(absolutePath));
    const worksheet = ExcelImportService.getWorkSheet(workbook);
    const rows = ExcelImportService.readRows(worksheet, { headerRow: 8 });
    const cashRows = ExcelImportService.parseJournalRows(rows)
        .filter(row => normalize(row.voucherType) === "CASH PAYMENT");

    if (cashRows.length === 0) {
        throw new Error("No CASH PAYMENT rows found in the workbook");
    }

    const result = await prisma.$transaction(async tx => {
        const updates: Array<{ voucherId: string; voucherNo: string; importKey: string }> = [];
        const skipped = { alreadyCashPayment: 0 };
        const failures: string[] = [];

        for (const row of cashRows) {
            const importKey = `CASH PAYMENT_${row.voucherNo}_${row.importIndex}`;
            let journal: any = await tx.journal.findUnique({
                where: { importKey },
                include: { voucher: { include: { entries: { include: { ledger: { select: { category: true } } } } } } }
            });

            // Older imports may have a different row index. Use all remaining
            // journals for this voucher number and require a unique strict match.
            if (!journal) {
                const candidates = await tx.journal.findMany({
                    where: {
                        importKey: { startsWith: `CASH PAYMENT_${row.voucherNo}_` }
                    },
                    include: { voucher: { include: { entries: { include: { ledger: { select: { category: true } } } } } } }
                });
                const amount = Math.abs(Number(row.debitAmount || row.creditAmount || 0));
                const matches = candidates.filter(candidate =>
                    Math.abs(Number(candidate.amount || 0) - amount) <= 0.01 &&
                    normalize(candidate.remarks) === normalize(row.particulars) &&
                    sameDay(candidate.journalDate, row.date)
                );
                if (matches.length === 1) journal = matches[0];
                else {
                    failures.push(`voucherNo=${row.voucherNo}, importKey=${importKey}, matches=${matches.length}`);
                    continue;
                }
            }

            if (!journal.voucherId || !journal.voucher) {
                failures.push(`voucherNo=${row.voucherNo}, importKey=${importKey}, approved voucher not found`);
                continue;
            }

            if (!journal.voucher.entries.some((entry: any) => entry.ledger.category === "CASH")) {
                failures.push(`voucherNo=${row.voucherNo}, voucher=${journal.voucher.voucherNo}, no CASH ledger entry found`);
                continue;
            }

            if (journal.voucher.voucherType === VoucherType.CASH_PAYMENT) {
                skipped.alreadyCashPayment++;
                continue;
            }

            if (![VoucherType.JOURNAL, VoucherType.PAYMENT].includes(journal.voucher.voucherType)) {
                failures.push(`voucherNo=${row.voucherNo}, voucher=${journal.voucher.voucherNo}, unexpected type=${journal.voucher.voucherType}`);
                continue;
            }

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

            updates.push({ voucherId: journal.voucher.id, voucherNo: journal.voucher.voucherNo, importKey });
        }

        if (failures.length > 0) {
            throw new Error(`Repair aborted; no rows changed.\n${failures.join("\n")}`);
        }

        if (!dryRun) {
            for (const update of updates) {
                await tx.voucher.update({
                    where: { id: update.voucherId },
                    data: { voucherType: VoucherType.CASH_PAYMENT }
                });
            }
        }

        return { workbookRows: cashRows.length, changed: updates.length, ...skipped, dryRun };
    });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
