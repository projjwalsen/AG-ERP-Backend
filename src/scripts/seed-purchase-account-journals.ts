/**
 * Classify existing purchases under Tally Purchase Accounts for Trial Balance.
 *
 * The import does NOT create Journal, Voucher, Ledger, or LedgerEntry records.
 * It matches the Excel `Vch No.` to an existing Purchase.invoiceNo, stores the
 * Excel `Sub Group`, debit/credit side, and amount as a reporting-only mapping,
 * and optionally creates matching JournalCategory master records beneath the
 * existing `Purchase Accounts` Journal Head.
 *
 * Preview (no database writes):
 *   npm run seed:purchase-account-journals -- --file "C:\\path\\purchase.xlsx" --branch "BRANCH_CODE"
 *
 * Apply reporting mappings/categories (still no accounting entries):
 *   npm run seed:purchase-account-journals -- --file "C:\\path\\purchase.xlsx" --branch "BRANCH_CODE" --apply
 */
import { readFile } from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import { EntryType, PurchaseStatus } from "@prisma/client";
import { prisma } from "../config/db";

type SourceRow = {
    row: number;
    voucherNo: string;
    supplier: string;
    subGroup: string;
    date: Date;
    debit: number;
    credit: number;
};

type PurchaseSubGroup = {
    name: string;
    entryType: EntryType;
    amount: number;
    sourceFile: string;
    sourceRow: number;
};

const PURCHASE_SUB_GROUP_MARKER = "TB_PURCHASE_SUBGROUPS";

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

const normalizeVoucher = (value: unknown) => normalizeText(value).toUpperCase();

const normalizeSupplier = (value: unknown) => normalizeText(value)
    .replace(/\s*-\s*(?:CR|DR)\s*$/i, "")
    .replace(/[^A-Z0-9]+/gi, "")
    .toUpperCase();

const dateKey = (value: Date | null | undefined) => value
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`
    : null;

const money = (value: unknown) => {
    const amount = typeof value === "number"
        ? value
        : Number(String(value || "").replace(/,/g, ""));
    return Number.isFinite(amount)
        ? Math.round(amount * 100) / 100
        : 0;
};

const readPurchaseSubGroups = (remarks: string | null): PurchaseSubGroup[] => {
    const match = remarks?.match(
        new RegExp(`\\[\\[${PURCHASE_SUB_GROUP_MARKER}:(.*?)\\]\\]`, "s")
    );
    if (!match) return [];

    try {
        const parsed = JSON.parse(match[1]);
        return Array.isArray(parsed)
            ? parsed.filter(item =>
                item &&
                typeof item.name === "string" &&
                (item.entryType === EntryType.DEBIT || item.entryType === EntryType.CREDIT) &&
                Number.isFinite(Number(item.amount))
            ).map(item => ({
                name: normalizeText(item.name),
                entryType: item.entryType,
                amount: money(item.amount),
                sourceFile: normalizeText(item.sourceFile),
                sourceRow: Number(item.sourceRow) || 0
            }))
            : [];
    } catch {
        return [];
    }
};

const writePurchaseSubGroups = (remarks: string | null, groups: PurchaseSubGroup[]) => {
    const marker = new RegExp(`\\s*\\[\\[${PURCHASE_SUB_GROUP_MARKER}:.*?\\]\\]`, "gs");
    const existingText = String(remarks || "").replace(marker, "").trimEnd();
    const payload = JSON.stringify(groups);
    return `${existingText}${existingText ? "\n" : ""}[[${PURCHASE_SUB_GROUP_MARKER}:${payload}]]`;
};

function help() {
    console.log("Usage: npm run seed:purchase-account-journals -- --file <purchase-vouchers.xlsx> --branch <branch code/name/id> [--apply]");
}

async function parseWorkbook(buffer: Buffer): Promise<SourceRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("The workbook has no worksheet");

    let headerRow = 0;
    const headers = new Map<string, number>();
    worksheet.eachRow((row, rowNumber) => {
        const values = row.values as unknown[];
        const rowHeaders = values
            .map((value, index) => [normalizeText(value).toUpperCase(), index] as const)
            .filter(([value]) => value);
        if (rowHeaders.some(([value]) => value === "VCH NO." || value === "VCH NO")) {
            headerRow = rowNumber;
            for (const [value, index] of rowHeaders) headers.set(value, index);
        }
    });

    const required = ["DATE", "SUB GROUP", "VCH NO.", "DEBIT", "CREDIT"];
    if (!headerRow || required.some(header => !headers.has(header))) {
        throw new Error("Expected Tally columns: Date, Particulars, Sub Group, Vch No., Debit, Credit");
    }

    const rows: SourceRow[] = [];
    for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const voucherNo = normalizeText(row.getCell(headers.get("VCH NO.")!).value);
        const subGroup = normalizeText(row.getCell(headers.get("SUB GROUP")!).value);
        const debit = money(row.getCell(headers.get("DEBIT")!).value);
        const credit = money(row.getCell(headers.get("CREDIT")!).value);
        if (!voucherNo || !subGroup || (debit === 0 && credit === 0)) continue;

        const rawDate = row.getCell(headers.get("DATE")!).value;
        const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
        if (Number.isNaN(date.getTime())) {
            throw new Error(`Row ${rowNumber}: invalid Date for voucher ${voucherNo}`);
        }

        // Tally's third Particulars column contains the supplier in this export.
        const supplier = normalizeText(row.getCell(3).value || row.getCell(2).value);
        rows.push({ row: rowNumber, voucherNo, supplier, subGroup, date, debit, credit });
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
        help();
        throw new Error("Both --file and --branch are required");
    }

    const [branch, buffer] = await Promise.all([resolveBranch(), readFile(filePath)]);
    const sourceRows = await parseWorkbook(buffer);
    const purchases = await prisma.purchase.findMany({
        where: { branchId: branch.id, status: PurchaseStatus.APPROVED },
        select: {
            id: true,
            invoiceNo: true,
            invoiceDate: true,
            agency: { select: { name: true } }
        }
    });
    const purchasesByVoucher = new Map<string, typeof purchases>();
    for (const purchase of purchases) {
        const key = normalizeVoucher(purchase.invoiceNo);
        purchasesByVoucher.set(key, [...(purchasesByVoucher.get(key) || []), purchase]);
    }

    const matched: Array<SourceRow & { purchaseId: string }> = [];
    const skipped: Array<Record<string, unknown>> = [];
    for (const row of sourceRows) {
        const candidates = purchasesByVoucher.get(normalizeVoucher(row.voucherNo)) || [];
        const supplierMatches = row.supplier
            ? candidates.filter(candidate =>
                normalizeSupplier(candidate.agency.name) === normalizeSupplier(row.supplier))
            : [];
        const rowDate = dateKey(row.date);
        const dateMatches = rowDate
            ? candidates.filter(candidate => dateKey(candidate.invoiceDate) === rowDate)
            : [];
        const supplierAndDateMatches = supplierMatches.filter(candidate =>
            rowDate && dateKey(candidate.invoiceDate) === rowDate);
        const resolutionCandidates = supplierAndDateMatches.length > 0
            ? supplierAndDateMatches
            : supplierMatches.length > 0
                ? supplierMatches
                : dateMatches.length > 0
                    ? dateMatches
                    : candidates;
        const resolved = resolutionCandidates.length === 1 ? resolutionCandidates[0] : null;

        if (!resolved) {
            skipped.push({
                "Source Row": row.row,
                "Voucher No.": row.voucherNo,
                Supplier: row.supplier,
                "Sub Group": row.subGroup,
                Reason: candidates.length === 0
                    ? "No existing purchase with this voucher number in the selected branch"
                    : "Voucher number is ambiguous; supplier/date did not resolve one purchase"
            });
            continue;
        }
        matched.push({ ...row, purchaseId: resolved.id });
    }

    console.log(`Workbook: ${path.basename(filePath)}`);
    console.log(`Branch: ${branch.name} (${branch.code})`);
    console.log(`Source rows: ${sourceRows.length}; matched: ${matched.length}; skipped: ${skipped.length}`);
    console.table(matched.slice(0, 10).map(row => ({
        voucherNo: row.voucherNo,
        subGroup: row.subGroup,
        debit: row.debit,
        credit: row.credit
    })));
    if (skipped.length) console.table(skipped.slice(0, 20));

    if (!apply) {
        console.log("Preview only: no categories, journals, vouchers, ledgers, or ledger entries were created.");
        return;
    }

    const purchaseAccountsHead = await prisma.journalHead.findFirst({
        where: { name: { equals: "Purchase Accounts", mode: "insensitive" } },
        select: { id: true }
    });
    if (!purchaseAccountsHead) {
        throw new Error('The "Purchase Accounts" Journal Head must exist before this script is applied.');
    }

    const rowsByPurchase = new Map<string, SourceRow[]>();
    for (const row of matched) {
        rowsByPurchase.set(row.purchaseId, [
            ...(rowsByPurchase.get(row.purchaseId) || []),
            row
        ]);
    }

    let purchasesUpdated = 0;
    const categories = new Set<string>();
    for (const [purchaseId, purchaseRows] of rowsByPurchase) {
        await prisma.$transaction(async tx => {
            const purchase = await tx.purchase.findUnique({
                where: { id: purchaseId },
                select: { remarks: true }
            });
            if (!purchase) throw new Error(`Purchase ${purchaseId} no longer exists`);

            const groupsByName = new Map<string, PurchaseSubGroup>();
            for (const group of readPurchaseSubGroups(purchase.remarks)) {
                groupsByName.set(group.name.toUpperCase(), group);
            }

            for (const row of purchaseRows) {
                const existingCategory = await tx.journalCategory.findFirst({
                    where: {
                        journalHeadId: purchaseAccountsHead.id,
                        name: { equals: row.subGroup, mode: "insensitive" }
                    },
                    select: { id: true }
                });
                if (!existingCategory) {
                    await tx.journalCategory.create({
                        data: { journalHeadId: purchaseAccountsHead.id, name: row.subGroup, isActive: true }
                    });
                    categories.add(row.subGroup);
                }

                groupsByName.set(row.subGroup.toUpperCase(), {
                    name: row.subGroup,
                    entryType: row.debit !== 0 ? EntryType.DEBIT : EntryType.CREDIT,
                    amount: row.debit !== 0 ? row.debit : row.credit,
                    sourceFile: path.basename(filePath),
                    sourceRow: row.row
                });
            }

            await tx.purchase.update({
                where: { id: purchaseId },
                data: {
                    remarks: writePurchaseSubGroups(
                        purchase.remarks,
                        [...groupsByName.values()]
                    )
                }
            });
        });
        purchasesUpdated++;
    }

    console.log({ purchasesUpdated, categoriesCreated: categories.size, skipped: skipped.length });
    console.log("No Journal, Voucher, Ledger, or LedgerEntry records were created.");
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
