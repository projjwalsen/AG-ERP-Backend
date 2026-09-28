/**
 * Repairs legacy inward debit/credit-note imports that incorrectly moved the
 * linked Purchase invoice into the note's Excel Path category.
 *
 * The script uses the same InDrCr workbook to identify notes. For every
 * matched note it restores the original Purchase voucher entry to its normal
 * Purchase ledger, then places only the Debit/Credit Note voucher's Purchase
 * entry under the workbook Path (for example, Purchase Accounts / IGST
 * PURCHASE). It never creates notes, transactions, journals, or vouchers.
 *
 * Preview:
 *   npm run repair:inward-note-purchase-ledgers -- --file "C:\\path\\InDrCr.xlsx" --branch "BRANCH_CODE"
 * Apply:
 *   npm run repair:inward-note-purchase-ledgers -- --file "C:\\path\\InDrCr.xlsx" --branch "BRANCH_CODE" --apply
 */
import { readFile } from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import {
    DebitCreditNoteSourceType,
    DebitCreditNoteType,
    EntryType,
    LedgerNature,
    LedgerType,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";
import {
    importedTransactionTypeFromPath,
    normalizeImportedPartyName,
    normalizeImportedTransactionPath
} from "../modules/import/transaction-import.utils";

type WorkbookRow = {
    row: number;
    date: Date;
    particulars: string;
    voucherNo: string;
    noteType: DebitCreditNoteType;
    amount: number;
    path: string;
};

const flagValue = (flag: string) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
};

const filePath = flagValue("--file");
const branchQuery = flagValue("--branch");
const apply = process.argv.includes("--apply");

const normalizeText = (value: unknown) => String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const money = (value: unknown) => {
    const amount = typeof value === "number"
        ? value
        : Number(String(value || "").replace(/,/g, ""));
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

const dateKey = (value: Date | null | undefined) => value
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`
    : null;

const codePart = (value: string) => value
    .replace(/[^A-Z0-9]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();

const standardPurchaseLabel = (voucherType: VoucherType | null) => {
    const labels: Partial<Record<VoucherType, string>> = {
        [VoucherType.IGST_PURCHASE]: "IGST PURCHASE",
        [VoucherType.GST_PURCHASE]: "GST PURCHASE",
        [VoucherType.CST_PURCHASE]: "CST PURCHASE",
        [VoucherType.DISCOUNT_PURCHASE]: "DISCOUNT",
        [VoucherType.HIGH_SEAS_PURCHASE]: "HIGH SEAS PURCHASE",
        [VoucherType.IMPORT_PURCHASE]: "IMPORT PURCHASE",
        [VoucherType.VAT_PURCHASE]: "VAT PURCHASE",
        [VoucherType.INTEREST_SAUNDRY_CREDITORS]: "INTEREST PAID TO S.CREDITORS"
    };
    return labels[voucherType || VoucherType.PURCHASE] || "Purchase";
};

async function readWorkbook(buffer: Buffer): Promise<WorkbookRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("The workbook has no worksheet");

    const header = new Map<string, number>();
    let headerRow = 0;
    worksheet.eachRow((row, rowNumber) => {
        const currentHeader = new Map<string, number>();
        const lastColumn = Math.max(row.cellCount, worksheet.columnCount, 8);
        for (let column = 1; column <= lastColumn; column++) {
            const name = normalizeText(row.getCell(column).value).toUpperCase();
            if (name) currentHeader.set(name, column);
        }
        if (currentHeader.has("VOUCHER NO.") || currentHeader.has("VOUCHER NO")) {
            headerRow = rowNumber;
            currentHeader.forEach((column, name) => header.set(name, column));
        }
    });

    const required = ["DATE", "PARTICULAR", "VOUCHER TYPE", "VOUCHER NO.", "DEBIT", "CREDIT", "PATH"];
    if (!headerRow || required.some(name => !header.has(name))) {
        throw new Error("Expected columns: Date, Particular, Voucher Type, Voucher No., Debit, Credit, Path");
    }

    const rows: WorkbookRow[] = [];
    for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const voucherType = normalizeText(row.getCell(header.get("VOUCHER TYPE")!).value).toUpperCase();
        const noteType = voucherType === "INWARD DEBIT NOTE"
            ? DebitCreditNoteType.DEBIT_NOTE
            : voucherType === "INWARD CREDIT NOTE"
                ? DebitCreditNoteType.CREDIT_NOTE
                : null;
        if (!noteType) continue;

        const rawDate = row.getCell(header.get("DATE")!).value;
        const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
        const debit = money(row.getCell(header.get("DEBIT")!).value);
        const credit = money(row.getCell(header.get("CREDIT")!).value);
        const amount = noteType === DebitCreditNoteType.DEBIT_NOTE ? credit : debit;
        const voucherNo = normalizeText(row.getCell(header.get("VOUCHER NO.")!).value);
        const particulars = normalizeText(row.getCell(header.get("PARTICULAR")!).value);
        const importedPath = normalizeImportedTransactionPath(row.getCell(header.get("PATH")!).value);
        if (!voucherNo || !particulars || !importedPath || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(date.getTime())) {
            throw new Error(`Invalid inward note data at workbook row ${rowNumber}`);
        }
        rows.push({ row: rowNumber, date, particulars, voucherNo, noteType, amount, path: importedPath });
    }
    return rows;
}

async function resolveBranch() {
    if (!branchQuery) throw new Error("--branch is required");
    const branch = await prisma.branch.findFirst({
        where: {
            isActive: true,
            OR: [
                { id: branchQuery },
                { code: { equals: branchQuery, mode: "insensitive" } },
                { name: { equals: branchQuery, mode: "insensitive" } }
            ]
        },
        select: { id: true, code: true, name: true }
    });
    if (!branch) throw new Error(`No active branch matches "${branchQuery}"`);
    return branch;
}

async function main() {
    if (!filePath || !branchQuery) {
        throw new Error("Usage: npm run repair:inward-note-purchase-ledgers -- --file <InDrCr.xlsx> --branch <branch code/name/id> [--apply]");
    }

    const [branch, buffer] = await Promise.all([resolveBranch(), readFile(filePath)]);
    const rows = await readWorkbook(buffer);
    const summary = {
        total: rows.length,
        matched: 0,
        restoredPurchaseEntries: 0,
        remappedNoteEntries: 0,
        skipped: [] as Array<Record<string, unknown>>
    };

    for (const row of rows) {
        const candidates = await prisma.debitCreditNote.findMany({
            where: {
                branchId: branch.id,
                noteNo: row.voucherNo,
                type: row.noteType,
                sourceType: DebitCreditNoteSourceType.PURCHASE
            },
            include: {
                agency: { select: { name: true } },
                purchase: { select: { id: true, voucherType: true } },
                transaction: { select: { id: true } },
                particulars: { select: { amount: true } }
            }
        });
        const matching = candidates.filter(note => {
            const noteAmount = Number(note.totalAmount || 0) || note.particulars.reduce(
                (total, particular) => total + Number(particular.amount || 0),
                0
            );
            return Math.abs(noteAmount - row.amount) < 0.005 &&
                normalizeImportedPartyName(note.agency.name) === normalizeImportedPartyName(row.particulars) &&
                dateKey(note.noteDate) === dateKey(row.date);
        });
        if (matching.length !== 1 || !matching[0].purchase) {
            summary.skipped.push({
                row: row.row,
                voucherNo: row.voucherNo,
                path: row.path,
                reason: matching.length === 0
                    ? "No unique existing purchase note matches voucher number, party, date, and amount"
                    : "More than one existing purchase note matches this row"
            });
            continue;
        }

        summary.matched++;
        if (!apply) continue;

        const note = matching[0];
        const importedType = importedTransactionTypeFromPath(row.path);
        const repaired = await prisma.$transaction(async tx => {
            const target = await LedgerService.getOrCreateImportedPurchaseTypeLedger(
                tx,
                branch.id,
                importedType,
                row.path
            );
            const label = standardPurchaseLabel(note.purchase!.voucherType);
            const normalPurchaseLedger = await LedgerService.getOrCreateLedger(tx, {
                code: label === "Purchase" ? `PURCHASE-${branch.code}` : `${codePart(label)}-${branch.code}`,
                name: `${label} - ${branch.code}`,
                category: LedgerType.PURCHASE,
                groupCode: "PURCHASE",
                nature: LedgerNature.DEBIT,
                branchId: branch.id
            });

            const sourceEntries = await tx.ledgerEntry.findMany({
                where: {
                    ledgerId: target.id,
                    ledger: { category: LedgerType.PURCHASE },
                    voucher: { sourceId: note.purchase!.id }
                },
                select: { id: true }
            });
            if (sourceEntries.length > 0 && normalPurchaseLedger.id !== target.id) {
                await tx.ledgerEntry.updateMany({
                    where: { id: { in: sourceEntries.map(entry => entry.id) } },
                    data: { ledgerId: normalPurchaseLedger.id }
                });
            }

            if (note.transaction?.id) {
                await tx.transaction.update({ where: { id: note.transaction.id }, data: { type: row.path } });
            }
            const noteVouchers = await tx.voucher.findMany({
                where: {
                    ...(note.transaction?.id ? { sourceId: note.transaction.id } : { id: note.voucherId || "__none__" }),
                    voucherType: { in: [VoucherType.DEBIT_NOTE, VoucherType.CREDIT_NOTE] }
                },
                select: { id: true }
            });
            const noteEntries = noteVouchers.length > 0
                ? await tx.ledgerEntry.findMany({
                    where: {
                        voucherId: { in: noteVouchers.map(voucher => voucher.id) },
                        ledger: { category: LedgerType.PURCHASE }
                    },
                    select: { id: true, ledgerId: true }
                })
                : [];
            const changedLedgerIds = new Set<string>([
                target.id,
                normalPurchaseLedger.id,
                ...noteEntries.map(entry => entry.ledgerId)
            ]);
            if (noteEntries.length > 0) {
                await tx.ledgerEntry.updateMany({
                    where: { id: { in: noteEntries.map(entry => entry.id) } },
                    data: { ledgerId: target.id }
                });
            }
            await Promise.all([...changedLedgerIds].map(ledgerId => LedgerService.syncCachedBalance(tx, ledgerId)));
            return { restored: sourceEntries.length, remapped: noteEntries.length };
        });
        summary.restoredPurchaseEntries += repaired.restored;
        summary.remappedNoteEntries += repaired.remapped;
    }

    console.log(`Workbook: ${path.basename(filePath)}`);
    console.log(`Branch: ${branch.name} (${branch.code})`);
    console.log(summary);
    if (summary.skipped.length) console.table(summary.skipped.slice(0, 30));
    if (!apply) console.log("Preview only: no ledger entries were changed. Add --apply to repair matched notes.");
    if (summary.skipped.length) process.exitCode = 1;
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
