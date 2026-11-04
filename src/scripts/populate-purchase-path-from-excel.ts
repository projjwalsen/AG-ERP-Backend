/**
 * Set Purchase.path from Tally Purchase Accounts Excel for invoices that
 * already exist. Excel-only voucher numbers are skipped; no purchases are
 * created. Path is stored as Group/Sub Group (for example
 * Purchase Accounts/GST Purchase).
 *
 *   npx tsx src/scripts/populate-purchase-path-from-excel.ts --file "C:\\path\\PurchaseAccounts_Purchasevouchers.xlsx" --apply
 */
import { readFile } from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../config/db";

const PREFERRED_BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

const flagValue = (flag: string) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
};

const filePath = flagValue("--file") ||
    "C:\\Users\\RAZONOVA\\Downloads\\tallyexporteddata\\PurchaseAccounts_Purchasevouchers.xlsx";
const apply = process.argv.includes("--apply");

const normalizeText = (value: unknown) => String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeVoucher = (value: unknown) => normalizeText(value).toUpperCase();

const stripLeadingZeros = (value: string) => {
    const stripped = value.replace(/^0+/, "");
    return stripped || "0";
};

const money = (value: unknown) => {
    const amount = typeof value === "number"
        ? value
        : Number(String(value || "").replace(/,/g, ""));
    return Number.isFinite(amount)
        ? Math.round(amount * 100) / 100
        : 0;
};

const cellText = (value: unknown) => {
    if (value == null) return "";
    if (typeof value === "object" && value && "text" in (value as any)) {
        return normalizeText((value as any).text);
    }
    if (typeof value === "object" && value && "result" in (value as any)) {
        return normalizeText((value as any).result);
    }
    return normalizeText(value);
};

const normalizeSupplier = (value: unknown) => normalizeText(value)
    .replace(/\s*-\s*(?:CR|DR)\s*$/i, "")
    .replace(/[^A-Z0-9]+/gi, "")
    .toUpperCase();

type SourceRow = {
    row: number;
    voucherNo: string;
    supplier: string;
    group: string;
    subGroup: string;
    path: string;
    debit: number;
    credit: number;
};

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
            .map((value, index) => [cellText(value).toUpperCase(), index] as const)
            .filter(([value]) => value);
        if (rowHeaders.some(([value]) => value === "VCH NO." || value === "VCH NO")) {
            headerRow = rowNumber;
            for (const [value, index] of rowHeaders) headers.set(value, index);
        }
    });

    const voucherCol = headers.get("VCH NO.") || headers.get("VCH NO");
    const subGroupCol = headers.get("SUB GROUP") || headers.get("SUBGROUP");
    const groupCol = headers.get("GROUP");
    const debitCol = headers.get("DEBIT");
    const creditCol = headers.get("CREDIT");
    if (!voucherCol || !subGroupCol) {
        throw new Error("Expected Tally columns: Vch No., Sub Group, Group, Debit, Credit");
    }

    const rows: SourceRow[] = [];
    for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const voucherNo = cellText(row.getCell(voucherCol).value);
        const subGroup = cellText(row.getCell(subGroupCol).value);
        const group = cellText(groupCol ? row.getCell(groupCol).value : "") || "Purchase Accounts";
        const debit = money(debitCol ? row.getCell(debitCol).value : 0);
        const credit = money(creditCol ? row.getCell(creditCol).value : 0);
        if (!voucherNo || !subGroup) continue;
        const supplier = cellText(row.getCell(3).value || row.getCell(2).value);
        rows.push({
            row: rowNumber,
            voucherNo,
            supplier,
            group,
            subGroup,
            path: `${group}/${subGroup}`,
            debit,
            credit
        });
    }
    return rows;
}

function pickPreferredRow(rows: SourceRow[]) {
    return [...rows].sort((a, b) => {
        const aHasDebit = a.debit > 0 ? 1 : 0;
        const bHasDebit = b.debit > 0 ? 1 : 0;
        if (bHasDebit !== aHasDebit) return bHasDebit - aHasDebit;
        const aAmount = Math.max(a.debit, a.credit);
        const bAmount = Math.max(b.debit, b.credit);
        if (bAmount !== aAmount) return bAmount - aAmount;
        return a.row - b.row;
    })[0];
}

async function main() {
    const [buffer, purchases] = await Promise.all([
        readFile(filePath),
        prisma.purchase.findMany({
            select: {
                id: true,
                invoiceNo: true,
                branchId: true,
                path: true,
                agency: { select: { name: true } }
            }
        })
    ]);
    const sourceRows = await parseWorkbook(buffer);

    const byExact = new Map<string, typeof purchases>();
    const byStripped = new Map<string, typeof purchases>();
    for (const purchase of purchases) {
        const exact = normalizeVoucher(purchase.invoiceNo);
        const stripped = stripLeadingZeros(exact);
        byExact.set(exact, [...(byExact.get(exact) || []), purchase]);
        byStripped.set(stripped, [...(byStripped.get(stripped) || []), purchase]);
    }

    const resolvePurchase = (row: SourceRow) => {
        const voucherNo = normalizeVoucher(row.voucherNo);
        const exactMatches = byExact.get(voucherNo) || [];
        const candidates = exactMatches.length > 0
            ? exactMatches
            : (byStripped.get(stripLeadingZeros(voucherNo)) || []);
        if (candidates.length === 0) return { purchase: null as (typeof purchases)[number] | null, reason: "excel-only" as const };
        if (candidates.length === 1) return { purchase: candidates[0], reason: "matched" as const };

        const supplierMatches = row.supplier
            ? candidates.filter(candidate =>
                normalizeSupplier(candidate.agency.name) === normalizeSupplier(row.supplier) ||
                normalizeSupplier(candidate.agency.name).includes(normalizeSupplier(row.supplier)) ||
                normalizeSupplier(row.supplier).includes(normalizeSupplier(candidate.agency.name))
            )
            : [];
        if (supplierMatches.length === 1) return { purchase: supplierMatches[0], reason: "matched" as const };
        if (row.subGroup.toUpperCase() === "DISCOUNT") {
            return { purchase: null, reason: "ambiguous" as const };
        }
        return { purchase: null, reason: "ambiguous" as const };
    };

    const rowsByPurchase = new Map<string, SourceRow[]>();
    let excelOnly = 0;
    let ambiguous = 0;
    for (const row of sourceRows) {
        const resolved = resolvePurchase(row);
        if (!resolved.purchase) {
            if (resolved.reason === "excel-only") excelOnly += 1;
            else ambiguous += 1;
            continue;
        }
        const current = rowsByPurchase.get(resolved.purchase.id) || [];
        current.push(row);
        rowsByPurchase.set(resolved.purchase.id, current);
    }

    const purchaseById = new Map(purchases.map(purchase => [purchase.id, purchase]));
    const updates: Array<{
        purchaseId: string;
        invoiceNo: string;
        path: string;
        previousPath: string | null;
    }> = [];
    let unchanged = 0;

    for (const [purchaseId, rows] of rowsByPurchase) {
        const purchase = purchaseById.get(purchaseId);
        if (!purchase) continue;
        const chosen = pickPreferredRow(rows);
        if ((purchase.path || "") === chosen.path) {
            unchanged += 1;
            continue;
        }
        updates.push({
            purchaseId: purchase.id,
            invoiceNo: purchase.invoiceNo,
            path: chosen.path,
            previousPath: purchase.path
        });
    }

    const uniqueExcelVouchers = new Set(sourceRows.map(row => normalizeVoucher(row.voucherNo))).size;

    const pathCounts = new Map<string, number>();
    for (const row of updates) {
        pathCounts.set(row.path, (pathCounts.get(row.path) || 0) + 1);
    }

    console.log(`Workbook: ${path.basename(filePath)}`);
    console.log(`Excel rows: ${sourceRows.length}; unique voucher numbers: ${uniqueExcelVouchers}`);
    console.log(`Existing purchases in database: ${purchases.length}`);
    console.log(`Matched to update: ${updates.length}`);
    console.log(`Already had the same path: ${unchanged}`);
    console.log(`Excel-only (not in database, skipped): ${excelOnly}`);
    console.log(`Ambiguous invoice numbers (skipped): ${ambiguous}`);
    console.table([...pathCounts.entries()].map(([purchasePath, count]) => ({
        path: purchasePath,
        invoices: count
    })));
    console.table(updates.slice(0, 12).map(row => ({
        invoiceNo: row.invoiceNo,
        path: row.path
    })));

    if (!apply) {
        console.log("Preview only: pass --apply to write Purchase.path. No invoices were created.");
        return;
    }

    const batchSize = 200;
    for (let index = 0; index < updates.length; index += batchSize) {
        const batch = updates.slice(index, index + batchSize);
        await prisma.$transaction(
            batch.map(row => prisma.purchase.update({
                where: { id: row.purchaseId },
                data: { path: row.path }
            }))
        );
        console.log(`Updated ${Math.min(index + batch.length, updates.length)} / ${updates.length}`);
    }

    console.log(`Wrote path on ${updates.length} existing purchase invoices.`);
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
