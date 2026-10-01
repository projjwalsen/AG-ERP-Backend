import * as XLSX from "xlsx";
import { EntryType, LedgerType, VoucherType } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";

type TdsRow = {
    voucherNo: string;
    voucherId?: string;
    category: string;
    voucherType: string;
    debit: number;
    credit: number;
    customer: string;
    narration?: string;
    sheet: string;
    row: number;
};

const normalize = (value: unknown) => String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const normalizeHeader = (value: unknown) => normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeCustomer = (value: unknown) => normalize(value)
    .replace(/\s*[-–—]\s*(?:dr|cr|pb)\s*$/i, "")
    .replace(/\s*\((?:drs?|crs?)\)\s*$/i, "")
    .replace(/\s+-\s+sundry\s+(?:debtor|creditor)\s*$/i, "")
    .replace(/\bPRIVATE\b/gi, "PVT")
    .replace(/\bLIMITED\b/gi, "LTD")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

const amount = (value: unknown) => {
    const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const readValue = (row: Record<string, unknown>, ...names: string[]) => {
    const wanted = new Set(names.map(normalizeHeader));
    const key = Object.keys(row).find(name => wanted.has(normalizeHeader(name)));
    return key ? row[key] : undefined;
};

const parseRows = (buffer: Buffer): TdsRow[] => {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
    const rows: TdsRow[] = [];

    for (const sheet of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheet];
        const values = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
            header: 1,
            defval: "",
            raw: false
        });
        if (!values.length) continue;

        const headerIndex = values.findIndex(row => {
            const headers = (row as unknown[]).map(normalizeHeader);
            return headers.includes("vouchar number") ||
                headers.includes("voucharnumber") ||
                headers.includes("voucherno");
        });
        if (headerIndex < 0) continue;

        const headers = (values[headerIndex] as unknown[]).map(value => normalize(value));
        for (let index = headerIndex + 1; index < values.length; index++) {
            const cells = values[index] as unknown[];
            const row: Record<string, unknown> = {};
            headers.forEach((header, column) => { row[header] = cells[column]; });

            const voucherNo = normalize(readValue(row, "Voucher Number", "Vouchar Number", "Voucher No", "Vch No"));
            const category = normalize(readValue(row, "Category"));
            const voucherType = normalize(readValue(row, "Voucher Type", "Vouchar Type", "Vch Type"));
            const customer = normalize(readValue(row, "Particulars", "Customer", "Party"));
            if (!voucherNo && !customer) continue;

            rows.push({
                voucherNo,
                voucherId: normalize(readValue(row, "Voucher ID", "Voucher Id", "Voucher UUID")) || undefined,
                category,
                voucherType,
                debit: amount(readValue(row, "Db", "Debit", "Debit Amount")),
                credit: amount(readValue(row, "Cr", "Credit", "Credit Amount")),
                customer,
                narration: normalize(readValue(row, "Narration", "Remarks", "Remark")) || undefined,
                sheet,
                row: index + 1
            });
        }
    }

    return rows;
};

export class TdsAssetsReconciliationService {
    static async reconcile(buffer: Buffer, dryRun = false) {
        const parsed = parseRows(buffer);
        if (!parsed.length) throw new ApiError("No TDS Assets rows found in workbook", 400);

        const invalid = parsed.filter(row =>
            row.category.toUpperCase() !== "TDS ASSETS FY 2025-26" ||
            row.voucherType.toUpperCase() !== "JOURNAL" ||
            !row.voucherNo ||
            !row.customer ||
            ((row.debit > 0) === (row.credit > 0))
        );
        if (invalid.length) {
            throw new ApiError(
                `Workbook contains ${invalid.length} invalid/non-TDS rows; no changes were applied`,
                400
            );
        }

        // The workbook contains duplicate sheets. Identical voucher rows are
        // processed once; conflicting duplicates are rejected as ambiguous.
        const unique = new Map<string, TdsRow>();
        for (const row of parsed) {
            const key = `${row.voucherId || row.voucherNo}|${normalizeCustomer(row.customer)}|${row.debit.toFixed(2)}|${row.credit.toFixed(2)}`;
            if (!unique.has(key)) unique.set(key, row);
        }
        const rows = [...unique.values()];
        const conflicting = new Map<string, TdsRow>();
        for (const row of rows) {
            const key = row.voucherId || row.voucherNo;
            const previous = conflicting.get(key);
            if (previous && (
                normalizeCustomer(previous.customer) !== normalizeCustomer(row.customer) ||
                previous.debit !== row.debit ||
                previous.credit !== row.credit
            )) {
                throw new ApiError(
                    `Voucher ${key} has conflicting customer or amount rows; no changes were applied`,
                    400
                );
            }
            conflicting.set(key, row);
        }

        return prisma.$transaction(async tx => {
            const agencies = await tx.agency.findMany({
                where: { isActive: true },
                select: { id: true, name: true, type: true }
            });
            const agencyByName = new Map<string, typeof agencies[number]>();
            for (const agency of agencies) agencyByName.set(normalizeCustomer(agency.name), agency);

            const failures: Array<Record<string, unknown>> = [];
            const plans: Array<{
                row: TdsRow;
                voucherId: string;
                agencyId: string;
                ledgerId: string;
                entryId: string;
                entryType: EntryType;
                journalIds: string[];
            }> = [];

            for (const row of rows) {
                const agency = agencyByName.get(normalizeCustomer(row.customer));
                if (!agency) {
                    failures.push({ row: row.row, voucherNo: row.voucherNo, customer: row.customer, error: "Customer agency not found" });
                    continue;
                }

                const vouchers = row.voucherId
                    ? await tx.voucher.findMany({ where: { id: row.voucherId, voucherType: VoucherType.JOURNAL }, include: { entries: { include: { ledger: true } }, journals: true } })
                    : await tx.voucher.findMany({
                        where: {
                            voucherType: VoucherType.JOURNAL,
                            OR: [
                                { voucherNo: row.voucherNo },
                                { journals: { some: { serialNo: row.voucherNo } } },
                                { journals: { some: { voucherNo: row.voucherNo } } }
                            ]
                        },
                        include: { entries: { include: { ledger: true } }, journals: true }
                    });
                if (vouchers.length !== 1) {
                    failures.push({ row: row.row, voucherNo: row.voucherNo, error: `Expected exactly one existing JOURNAL voucher, found ${vouchers.length}` });
                    continue;
                }
                const voucher = vouchers[0];
                const branchId = voucher.branchId || voucher.journals[0]?.branchId;
                const ledger = await tx.ledger.findFirst({
                    where: {
                        agencyId: agency.id,
                        category: LedgerType.CUSTOMER,
                        ...(branchId ? { branchId } : {})
                    },
                    select: { id: true }
                });
                if (!ledger) {
                    failures.push({ row: row.row, voucherNo: row.voucherNo, customer: row.customer, error: "Customer ledger not found for voucher branch" });
                    continue;
                }

                const expectedAmount = row.debit > 0 ? row.debit : row.credit;
                const candidates = voucher.entries.filter(entry =>
                    entry.ledgerId !== ledger.id &&
                    Number(entry.amount) === expectedAmount &&
                    entry.ledger.category !== LedgerType.BANK &&
                    entry.ledger.category !== LedgerType.CASH
                );
                if (candidates.length !== 1) {
                    failures.push({ row: row.row, voucherNo: row.voucherNo, error: `Expected one non-bank TDS posting to remap, found ${candidates.length}` });
                    continue;
                }

                plans.push({
                    row,
                    voucherId: voucher.id,
                    agencyId: agency.id,
                    ledgerId: ledger.id,
                    entryId: candidates[0].id,
                    entryType: row.debit > 0 ? EntryType.CREDIT : EntryType.DEBIT,
                    journalIds: voucher.journals.map(journal => journal.id)
                });
            }

            if (failures.length) {
                throw new ApiError(`TDS reconciliation aborted; ${failures.length} rows could not be matched`, 400);
            }
            if (dryRun) return { dryRun: true, workbookRows: parsed.length, uniqueRows: rows.length, updated: plans.length };

            const affectedLedgers = new Set<string>();
            for (const plan of plans) {
                const previous = await tx.ledgerEntry.findUnique({ where: { id: plan.entryId }, select: { ledgerId: true } });
                await tx.ledgerEntry.update({ where: { id: plan.entryId }, data: { ledgerId: plan.ledgerId, entryType: plan.entryType } });
                for (const journalId of plan.journalIds) await tx.journal.update({ where: { id: journalId }, data: { agencyId: plan.agencyId } });
                affectedLedgers.add(plan.ledgerId);
                if (previous) affectedLedgers.add(previous.ledgerId);
            }
            for (const ledgerId of affectedLedgers) await LedgerService.syncCachedBalance(tx, ledgerId);

            return { dryRun: false, workbookRows: parsed.length, uniqueRows: rows.length, updated: plans.length };
        }, { maxWait: 120_000, timeout: 15 * 60_000 });
    }
}
