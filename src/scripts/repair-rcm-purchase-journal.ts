import "dotenv/config";
import fs from "fs";
import path from "path";
import { JournalStatus, VoucherType } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";
import { ImportResolver } from "../modules/import/import.resolver";

/**
 * Rebuilds the imported RCM Purchase journal rows from the source workbook.
 *
 * Dry run:
 *   npm run repair:rcm-purchase-journal -- C:\\path\\RCMDetails.xlsx --branch <uuid>
 * Apply:
 *   ... --apply
 *
 * The workbook is the authority only for its RCM Purchase register. Existing
 * rows from that register are replaced, which removes stale category/amount
 * rows (including rows such as the reported 88,270 entry) without touching
 * unrelated manual journals.
 */

const args = process.argv.slice(2);
const workbookArgument = args.find(value => !value.startsWith("--"));
const branchIndex = args.indexOf("--branch");
const branchId = branchIndex >= 0 ? args[branchIndex + 1] : undefined;
const apply = args.includes("--apply");
const invalidAmountArguments = args
    .flatMap((value, index) => value === "--invalid-amount" && args[index + 1] ? [Number(args[index + 1])] : [])
    .filter(value => Number.isFinite(value));
const invalidAmounts = new Set(invalidAmountArguments.length > 0 ? invalidAmountArguments : [88270]);

const normalize = (value: unknown) => String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

async function main() {
    if (!workbookArgument) throw new Error("Workbook path is required");
    if (!branchId) throw new Error("--branch <uuid> is required");

    const workbookPath = path.resolve(workbookArgument);
    const workbook = ExcelImportService.readExcel(fs.readFileSync(workbookPath));
    const source = workbook.SheetNames.map(sheetName => {
        const worksheet = ExcelImportService.getWorkSheet(workbook, sheetName);
        const headerRow = ExcelImportService.detectJournalHeaderRow(worksheet);
        const rows = ExcelImportService.readRows(worksheet, { headerRow });
        return {
            sheetName,
            headerRow,
            rows: ExcelImportService.parseJournalRows(rows, sheetName, headerRow)
                .filter(row => normalize(row.voucherType) === "RCM PURCHASE")
        };
    });

    const rcmSheets = source.filter(sheet => sheet.rows.length > 0);
    const rcmRows = rcmSheets.flatMap(sheet => sheet.rows);
    if (rcmRows.length === 0) throw new Error("No RCM Purchase rows found in workbook");

    const duplicateSerials = [...new Set(
        rcmRows.map(row => row.sourceSerialNo).filter(Boolean)
    )].filter(serial => rcmRows.filter(row => row.sourceSerialNo === serial).length > 1);
    if (duplicateSerials.length > 0) {
        throw new Error(`Duplicate RCM serial numbers: ${duplicateSerials.slice(0, 10).join(", ")}`);
    }

    const existing = await prisma.journal.findMany({
        where: { branchId },
        include: { voucher: true, category: true, journalHead: true },
        orderBy: { sourceRow: "asc" }
    });
    const workbookSerials = new Set(rcmRows.map(row => row.sourceSerialNo).filter(Boolean));
    const workbookSheets = new Set(rcmSheets.map(sheet => sheet.sheetName));
    const expectedVoucherNos = new Set(rcmRows.map(row => row.voucherNo));
    const rcmAccounts = new Set(rcmRows.map(row => normalize(row.accountName)).filter(Boolean));

    const repairTargets = existing.filter(journal => {
        const voucherType = journal.voucher?.voucherType;
        const fromWorkbook = workbookSheets.has(journal.sourceSheet || "");
        const sameVoucher = expectedVoucherNos.has(journal.voucherNo || "");
        const sameSerial = workbookSerials.has(journal.serialNo || "");
        // Old code stored these rows as JOURNAL. Include those imported rows
        // when their source footprint identifies the RCM register.
        return (voucherType === VoucherType.RCM_PURCHASE || voucherType === VoucherType.JOURNAL) &&
            ((sameSerial && (fromWorkbook || journal.sourceSheet === "Journal Register")) ||
                (fromWorkbook && sameVoucher));
    });

    const staleRcmRows = existing.filter(journal =>
        workbookSheets.has(journal.sourceSheet || "") &&
        journal.voucher?.voucherType === VoucherType.RCM_PURCHASE &&
        !workbookSerials.has(journal.serialNo || "")
    );
    const conflictingRows = existing.filter(journal => {
        const voucherType = journal.voucher?.voucherType;
        const account = normalize(journal.category?.name || journal.journalHead?.name);
        const amount = Math.round(Number(journal.amount || 0) * 100) / 100;
        // Remove only explicitly identified invalid amounts from old
        // ordinary-JOURNAL rows posted to an RCM account. This catches the
        // reported 88,270 row without deleting legitimate historical rows
        // that happen to use the same account head.
        return voucherType === VoucherType.JOURNAL &&
            Boolean(journal.sourceSheet) &&
            rcmAccounts.has(account) &&
            invalidAmounts.has(amount);
    });
    const deleteIds = [...new Set([
        ...repairTargets.map(row => row.id),
        ...staleRcmRows.map(row => row.id),
        ...conflictingRows.map(row => row.id)
    ])];

    console.log(JSON.stringify({
        workbook: workbookPath,
        rcmSheets: rcmSheets.map(sheet => ({ sheet: sheet.sheetName, headerRow: sheet.headerRow, rows: sheet.rows.length })),
        expectedRows: rcmRows.length,
        existingRows: existing.length,
        rowsToReplace: repairTargets.length,
        staleRcmRows: staleRcmRows.length,
        conflictingRows: conflictingRows.length,
        invalidAmounts: [...invalidAmounts],
        rowsToDelete: deleteIds.length,
        apply
    }, null, 2));

    if (!apply) {
        console.log("Dry run only. Re-run with --apply to replace the RCM register rows.");
        return;
    }

    await prisma.$transaction(async tx => {
        // Journal.voucher is not cascade-delete, so unlink/delete journals
        // first; Voucher -> LedgerEntry is cascade-delete in the schema.
        const journals = await tx.journal.findMany({
            where: { id: { in: deleteIds } },
            select: { voucherId: true }
        });
        const voucherIds = journals.map(row => row.voucherId).filter(Boolean) as string[];
        await tx.journal.deleteMany({ where: { id: { in: deleteIds } } });
        if (voucherIds.length > 0) {
            await tx.voucher.deleteMany({ where: { id: { in: voucherIds } } });
        }
    });

    const actor = { id: null, branchId };
    const groups = new Map<string, typeof rcmRows>();
    for (const row of rcmRows) {
        const key = normalize(row.accountName) || `__ROW_${row.sourceSerialNo}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
    }
    const limit = pLimit(8);
    await Promise.all([...groups.values()].map(rows => limit(async () => {
        for (const row of rows) {
            await ImportResolver.importJournalRegisterRow(actor, row, { skipBalanceSync: true });
        }
    })));
    const imported = rcmRows.length;

    const finalCount = await prisma.journal.count({
        where: { branchId, voucher: { voucherType: VoucherType.RCM_PURCHASE }, status: JournalStatus.APPROVED }
    });
    console.log(JSON.stringify({ imported, approvedRcmRowsAfterRepair: finalCount }, null, 2));
}

main()
    .catch(error => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
