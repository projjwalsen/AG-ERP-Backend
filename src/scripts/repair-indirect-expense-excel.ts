import "dotenv/config";
import fs from "fs";
import ExcelJS from "exceljs";
import { BranchAccessType } from "@prisma/client";
import { prisma } from "../config/db";
import { ExcelImportService } from "../modules/import/excelImport.service";
import { ImportResolver } from "../modules/import/import.resolver";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";
import type { JournalImportDTO } from "../core/dto/dto";

/**
 * Reconcile Indirect Expense journal-register rows from
 * indirectexpenses_exact_columns.xlsx:
 *   1. Recreate Excel rows missing in the database
 *   2. Delete extra copies of the same voucher fingerprint
 *   3. Compare the remaining FY net with the Excel closing
 *
 * Dry run:
 *   npx tsx src/scripts/repair-indirect-expense-excel.ts
 * Apply:
 *   npx tsx src/scripts/repair-indirect-expense-excel.ts --apply
 */

const EXCEL_PATH = "C:\\Users\\RAZONOVA\\Downloads\\indirectexpenses_exact_columns.xlsx";
const apply = process.argv.includes("--apply");
const TODAY = "2026-10-29";
const FY_START = new Date("2025-03-31T18:30:00.000Z");
const FY_END = new Date("2026-03-31T18:29:59.999Z");

const n = (value: unknown) =>
    String(value ?? "")
        .replace(/^Narration:\s*/i, "")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
const compact = (value: unknown) => n(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();
const money = (value: unknown) => {
    if (value == null || value === "") return 0;
    if (typeof value === "number") return Number(value.toFixed(2));
    const parsed = Number(String(value).replace(/,/g, "").replace(/Dr|Cr/gi, "").trim());
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};
const istDate = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(value);
const cellText = (value: unknown): string => {
    if (value == null) return "";
    if (value instanceof Date) {
        const parsed = ExcelImportService.toDate(
            `${value.getDate()}-${value.getMonth() + 1}-${value.getFullYear()}`
        );
        return parsed ? `${parsed.getDate()}-${parsed.getMonth() + 1}-${parsed.getFullYear()}` : value.toISOString();
    }
    if (typeof value === "object") {
        const obj = value as { text?: unknown; result?: unknown; richText?: Array<{ text: string }> };
        if (Array.isArray(obj.richText)) return obj.richText.map(part => part.text).join("");
        if (obj.text != null) return String(obj.text);
        if (obj.result != null) return cellText(obj.result);
    }
    return String(value);
};

type ExcelRow = {
    excelRow: number;
    date: Date;
    dateKey: string;
    voucherNo: string;
    voucherType: string;
    journalGroup: string;
    subGroup: string;
    subGroup2: string;
    subGroup3: string;
    account: string;
    debit: number;
    credit: number;
    narration: string;
    fingerprint: string;
};
type DbRow = {
    entryId: string;
    voucherId: string;
    ledgerId: string;
    dateKey: string;
    voucherNo: string;
    account: string;
    debit: number;
    credit: number;
    narration: string;
    fingerprint: string;
    inFy: boolean;
};

const accountAlias = (value: unknown) => {
    const key = compact(value);
    if (["ROFF", "ROUNDOFF", "ROUNDOFFACCOUNT", "AMOUNTROFF"].includes(key)) return "ROUNDOFF";
    return key;
};
const fingerprintOf = (row: { voucherNo: string; account: string; debit: number; credit: number }) =>
    [
        compact(row.voucherNo),
        accountAlias(row.account),
        Math.abs(row.debit - row.credit).toFixed(2)
    ].join("|");

async function readExcel(): Promise<ExcelRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);
    const sheet = workbook.worksheets[0];
    const rows: ExcelRow[] = [];
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 8) return;
        const values = (row.values as unknown[]) || [];
        const date = ExcelImportService.toDate(cellText(values[2]));
        const voucherNo = n(cellText(values[3]));
        const debit = money(cellText(values[10]));
        const credit = money(cellText(values[11]));
        if (!date || !voucherNo || (debit <= 0 && credit <= 0) || (debit > 0 && credit > 0)) return;
        const parsed: ExcelRow = {
            excelRow: rowNumber,
            date,
            dateKey: istDate(date),
            voucherNo,
            voucherType: n(cellText(values[8])),
            journalGroup: n(cellText(values[4])) || "Indirect Expenses",
            subGroup: n(cellText(values[5])),
            subGroup2: n(cellText(values[6])),
            subGroup3: n(cellText(values[7])),
            account: n(cellText(values[9])),
            debit,
            credit,
            narration: n(cellText(values[12])),
            fingerprint: ""
        };
        parsed.fingerprint = fingerprintOf(parsed);
        rows.push(parsed);
    });
    return rows;
}

async function indirectExpenseLedgers() {
    const groups = await prisma.ledgerGroup.findMany({
        select: { id: true, name: true, parentId: true }
    });
    const roots = groups.filter(group =>
        ["indirect expense", "indirect expenses"].includes(n(group.name).toLowerCase())
    );
    const ids = new Set(roots.map(group => group.id));
    let growing = true;
    while (growing) {
        growing = false;
        for (const group of groups) {
            if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
                ids.add(group.id);
                growing = true;
            }
        }
    }
    return prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true }
    });
}

async function loadDbRows(): Promise<DbRow[]> {
    const ledgers = await indirectExpenseLedgers();
    const ledgerName = new Map(ledgers.map(ledger => [ledger.id, ledger.name]));
    const entries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ledgers.map(ledger => ledger.id) } },
        select: {
            id: true,
            ledgerId: true,
            entryType: true,
            amount: true,
            narration: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    voucherDate: true,
                    narration: true
                }
            }
        }
    });
    return entries.map(entry => {
        const debit = entry.entryType === "DEBIT" ? Number(entry.amount) : 0;
        const credit = entry.entryType === "CREDIT" ? Number(entry.amount) : 0;
        const row: DbRow = {
            entryId: entry.id,
            voucherId: entry.voucher.id,
            ledgerId: entry.ledgerId,
            dateKey: istDate(entry.voucher.voucherDate),
            voucherNo: n(entry.voucher.voucherNo),
            account: ledgerName.get(entry.ledgerId) || "",
            debit: Number(debit.toFixed(2)),
            credit: Number(credit.toFixed(2)),
            narration: n(entry.narration || entry.voucher.narration),
            fingerprint: "",
            inFy: entry.voucher.voucherDate >= FY_START && entry.voucher.voucherDate <= FY_END
        };
        row.fingerprint = fingerprintOf(row);
        return row;
    });
}

function excelSide(row: { debit: number; credit: number }) {
    return row.debit > 0 ? "DEBIT" : "CREDIT";
}
function dbSide(row: { debit: number; credit: number }) {
    return row.debit > 0 ? "DEBIT" : "CREDIT";
}

function reconcile(excel: ExcelRow[], dbRows: DbRow[]) {
    const dbByFp = new Map<string, DbRow[]>();
    for (const row of dbRows) {
        const list = dbByFp.get(row.fingerprint) || [];
        list.push(row);
        dbByFp.set(row.fingerprint, list);
    }
    const used = new Set<string>();
    const missing: ExcelRow[] = [];
    const kept: DbRow[] = [];
    const sideFixes: Array<{ entryId: string; voucherId: string; from: string; to: string; amount: number }> = [];
    for (const row of excel) {
        const candidates = (dbByFp.get(row.fingerprint) || []).filter(item => !used.has(item.entryId));
        const exactDate = candidates.find(item => item.dateKey === row.dateKey);
        const notToday = candidates.find(item => item.dateKey !== TODAY);
        const chosen = exactDate || notToday || candidates[0];
        if (chosen) {
            used.add(chosen.entryId);
            kept.push(chosen);
            if (excelSide(row) !== dbSide(chosen)) {
                sideFixes.push({
                    entryId: chosen.entryId,
                    voucherId: chosen.voucherId,
                    from: dbSide(chosen),
                    to: excelSide(row),
                    amount: Math.abs(row.debit - row.credit)
                });
            }
        } else {
            missing.push(row);
        }
    }
    const extras = dbRows.filter(row => !used.has(row.entryId));
    return { missing, extras, kept, sideFixes };
}

async function deleteVouchers(voucherIds: string[]) {
    const unique = [...new Set(voucherIds)];
    const BATCH = 80;
    for (let offset = 0; offset < unique.length; offset += BATCH) {
        const batch = unique.slice(offset, offset + BATCH);
        await prisma.$transaction(async tx => {
            const notes = await tx.debitCreditNote.findMany({
                where: { voucherId: { in: batch } },
                select: { id: true }
            });
            const noteIds = notes.map(note => note.id);
            if (noteIds.length) {
                await tx.transaction.updateMany({
                    where: { debitCreditNoteId: { in: noteIds } },
                    data: { debitCreditNoteId: null }
                });
                await tx.debitCreditNote.updateMany({
                    where: { id: { in: noteIds } },
                    data: { voucherId: null }
                });
            }
            await tx.productManufacture.updateMany({
                where: { voucherId: { in: batch } },
                data: { voucherId: null }
            });
            await tx.journal.deleteMany({ where: { voucherId: { in: batch } } });
            await tx.ledgerEntry.deleteMany({ where: { voucherId: { in: batch } } });
            await tx.voucher.deleteMany({ where: { id: { in: batch } } });
        }, { maxWait: 120_000, timeout: 180_000 });
    }
}

function toDto(row: ExcelRow): JournalImportDTO {
    return {
        date: row.date,
        sourceSerialNo: `IE-${row.excelRow}`,
        importIndex: row.excelRow,
        sourceSheet: "Indirect Expenses",
        sourceRow: row.excelRow,
        journalGroup: row.journalGroup || "Indirect Expenses",
        subGroup: row.subGroup || undefined,
        subGroup2: row.subGroup2 || undefined,
        subGroup3: row.subGroup3 || undefined,
        accountName: row.account,
        narration: row.narration,
        voucherNo: row.voucherNo,
        voucherType: row.voucherType || "JOURNAL",
        particulars: row.account,
        debitAmount: row.debit,
        creditAmount: row.credit
    };
}

async function createMissing(actor: any, rows: ExcelRow[]) {
    const cache = ImportResolver.createJournalImportCache();
    const created: Array<{ excelRow: number; voucherNo: string; status: string }> = [];
    const failed: Array<{ excelRow: number; voucherNo: string; error: string }> = [];
    const ledgerIds = new Set<string>();
    for (const row of rows) {
        try {
            const result = await ImportResolver.importJournalRegisterRow(
                actor,
                toDto(row),
                { skipBalanceSync: true, cache }
            );
            const status = (result as any).__importStatus === "skipped" ? "skipped" : "created";
            created.push({ excelRow: row.excelRow, voucherNo: row.voucherNo, status });
            if ((result as any).ledgerId) ledgerIds.add((result as any).ledgerId);
        } catch (error) {
            failed.push({
                excelRow: row.excelRow,
                voucherNo: row.voucherNo,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    return { created, failed, ledgerIds: [...ledgerIds] };
}

async function main() {
    const excel = await readExcel();
    const excelDebit = Number(excel.reduce((sum, row) => sum + row.debit, 0).toFixed(2));
    const excelCredit = Number(excel.reduce((sum, row) => sum + row.credit, 0).toFixed(2));
    const excelNet = Number((excelDebit - excelCredit).toFixed(2));

    const dbRows = await loadDbRows();
    const plan = reconcile(excel, dbRows);
    const extraVoucherIds = [...new Set(plan.extras.map(row => row.voucherId))];
    const extraNet = Number(plan.extras.reduce((sum, row) => sum + row.debit - row.credit, 0).toFixed(2));
    const missingNet = Number(plan.missing.reduce((sum, row) => sum + row.debit - row.credit, 0).toFixed(2));
    const fyDbNet = Number(dbRows.filter(row => row.inFy).reduce((sum, row) => sum + row.debit - row.credit, 0).toFixed(2));
    const sideFixNet = Number(plan.sideFixes.reduce((sum, row) => sum + row.amount * 2, 0).toFixed(2));

    const preview = {
        dryRun: !apply,
        excelRows: excel.length,
        excelDebit,
        excelCredit,
        excelClosingNetDr: excelNet,
        dbRows: dbRows.length,
        dbFyNet: fyDbNet,
        missingToCreate: plan.missing.length,
        missingNet,
        extrasToDelete: plan.extras.length,
        extraVouchersToDelete: extraVoucherIds.length,
        extraNet,
        sideFixes: plan.sideFixes.length,
        sideFixNet,
        sampleMissing: plan.missing.slice(0, 8).map(row => ({
            date: row.dateKey,
            voucherNo: row.voucherNo,
            account: row.account,
            debit: row.debit,
            credit: row.credit
        })),
        sampleExtras: plan.extras.slice(0, 8).map(row => ({
            date: row.dateKey,
            voucherNo: row.voucherNo,
            account: row.account,
            debit: row.debit,
            credit: row.credit
        }))
    };

    if (!apply) {
        console.log(JSON.stringify(preview, null, 2));
        console.log("Dry run only. Re-run with --apply to create missing rows and delete extra copies.");
        return;
    }

    const user = await prisma.user.findFirst({
        where: { email: "admin@ashtavinayaka.com" },
        select: { id: true, branchId: true }
    });
    const branch = await prisma.branch.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true }
    });
    if (!user || !branch) throw new Error("Admin user or branch not found");
    const actor = {
        id: user.id,
        branchId: user.branchId || branch.id,
        branchAccessType: BranchAccessType.ALL
    };

    if (extraVoucherIds.length) {
        await deleteVouchers(extraVoucherIds);
    }
    if (plan.sideFixes.length) {
        const { EntryType } = await import("@prisma/client");
        for (const fix of plan.sideFixes) {
            await prisma.ledgerEntry.update({
                where: { id: fix.entryId },
                data: { entryType: fix.to === "DEBIT" ? EntryType.DEBIT : EntryType.CREDIT }
            });
            const voucher = await prisma.voucher.findUnique({
                where: { id: fix.voucherId },
                select: { id: true }
            });
            if (voucher) {
                await prisma.voucher.update({
                    where: { id: fix.voucherId },
                    data: {
                        totalDebit: fix.to === "DEBIT" ? fix.amount : 0,
                        totalCredit: fix.to === "CREDIT" ? fix.amount : 0
                    }
                });
            }
        }
    }
    const created = plan.missing.length
        ? await createMissing(actor, plan.missing)
        : { created: [], failed: [], ledgerIds: [] as string[] };

    const afterRows = await loadDbRows();
    const afterPlan = reconcile(excel, afterRows);
    const afterFyNet = Number(afterRows.filter(row => row.inFy).reduce((sum, row) => sum + row.debit - row.credit, 0).toFixed(2));
    const afterAllNet = Number(afterRows.reduce((sum, row) => sum + row.debit - row.credit, 0).toFixed(2));
    const ledgerIds = [...new Set([
        ...created.ledgerIds,
        ...plan.extras.map(row => row.ledgerId),
        ...afterRows.map(row => row.ledgerId)
    ])];
    for (const ledgerId of ledgerIds) {
        await LedgerService.syncCachedBalance(prisma, ledgerId);
    }

    console.log(JSON.stringify({
        ...preview,
        dryRun: false,
        deletedVouchers: extraVoucherIds.length,
        created: created.created.filter(row => row.status === "created").length,
        skippedExisting: created.created.filter(row => row.status === "skipped").length,
        failedCreates: created.failed,
        after: {
            dbRows: afterRows.length,
            stillMissing: afterPlan.missing.length,
            stillExtra: afterPlan.extras.length,
            fyNet: afterFyNet,
            allDatesNet: afterAllNet,
            excelClosingNetDr: excelNet,
            fyGap: Number((afterFyNet - excelNet).toFixed(2)),
            allDatesGap: Number((afterAllNet - excelNet).toFixed(2))
        }
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
