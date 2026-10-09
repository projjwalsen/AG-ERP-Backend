import * as XLSX from "xlsx";
import { EntryType, LedgerNature, VoucherType } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";

type VoucherLine = {
    sourceRow: number;
    voucherNo: string;
    voucherDate?: Date;
    groups: string[];
    accountName: string;
    debit: number;
    credit: number;
    narration: string;
};

type VoucherData = {
    voucherNo: string;
    voucherDate?: Date;
    lines: VoucherLine[];
    debit: number;
    credit: number;
};

const normalize = (value: unknown) => String(value ?? "")
    .replace(/[\u00a0\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const key = (value: unknown) => normalize(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const roundMoney = (value: number) => Math.round(value * 100) / 100;

const parseAmount = (value: unknown) => {
    if (typeof value === "number") return roundMoney(value);
    const text = normalize(value).replace(/[₹$,]/g, "");
    if (!text) return 0;
    const parsed = Number(text.replace(/[()]/g, ""));
    return Number.isFinite(parsed) ? roundMoney(parsed) : NaN;
};

const parseDate = (value: unknown): Date | undefined => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number") {
        const parts = XLSX.SSF.parse_date_code(value);
        if (parts) return new Date(parts.y, parts.m - 1, parts.d);
    }
    const text = normalize(value);
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (dmy) {
        let year = Number(dmy[3]);
        if (year < 100) year += year >= 70 ? 1900 : 2000;
        return new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    }
    const date = new Date(text);
    return text && !Number.isNaN(date.getTime()) ? date : undefined;
};

const columns: Record<string, string[]> = {
    date: ["date"],
    voucherNo: ["vouchernumber", "voucherno", "vchno"],
    journalGroup: ["journalgroup"],
    subGroup: ["subgroup"],
    subGroup2: ["subgroup2"],
    subGroup3: ["subgroup3"],
    voucherType: ["journalnametype", "journalname", "type"],
    accountName: ["accountledgername", "ledgeraccountname", "ledgername", "accountname"],
    debit: ["debitamount", "debit"],
    credit: ["creditamount", "credit"],
    narration: ["narration"]
};

function parseWorkbook(buffer: Buffer): VoucherData[] {
    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: true });
    } catch {
        throw new ApiError("Could not read the uploaded Excel workbook", 400);
    }

    const lines: VoucherLine[] = [];
    const invalid: string[] = [];
    for (const sheetName of workbook.SheetNames) {
        const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
            header: 1, defval: "", raw: true
        });
        const headerIndex = sheetRows.findIndex(row => {
            const headers = row.map(key);
            return columns.voucherNo.some(name => headers.includes(name)) &&
                headers.includes("journalgroup") &&
                columns.accountName.some(name => headers.includes(name)) &&
                columns.debit.some(name => headers.includes(name)) &&
                columns.credit.some(name => headers.includes(name));
        });
        if (headerIndex < 0) continue;
        const headers = sheetRows[headerIndex].map(key);
        const columnIndex = (name: string) => headers.findIndex(header => columns[name].includes(header));
        const col = {
            date: columnIndex("date"), voucherNo: columnIndex("voucherNo"),
            journalGroup: columnIndex("journalGroup"), subGroup: columnIndex("subGroup"),
            subGroup2: columnIndex("subGroup2"), subGroup3: columnIndex("subGroup3"),
            voucherType: columnIndex("voucherType"), accountName: columnIndex("accountName"),
            debit: columnIndex("debit"), credit: columnIndex("credit"), narration: columnIndex("narration")
        };

        let currentVoucherNo = "";
        let currentVoucherDate: Date | undefined;
        for (let index = headerIndex + 1; index < sheetRows.length; index++) {
            const cells = sheetRows[index];
            const rowVoucherNo = normalize(cells[col.voucherNo]).replace(/\.0$/, "");
            const parsedRowDate = parseDate(cells[col.date]);
            if (rowVoucherNo) {
                currentVoucherNo = rowVoucherNo;
                currentVoucherDate = parsedRowDate;
            } else if (parsedRowDate && currentVoucherDate &&
                parsedRowDate.toDateString() !== currentVoucherDate.toDateString()) {
                // A changed date marks a new voucher boundary. Do not carry a
                // merged voucher number into the next dated transaction.
                currentVoucherNo = "";
                currentVoucherDate = parsedRowDate;
            }
            const voucherNo = rowVoucherNo || currentVoucherNo;
            const accountName = normalize(cells[col.accountName]);
            if (!voucherNo && !accountName) continue;
            if (!voucherNo && /total|closing balance|opening balance/i.test(cells.map(normalize).join(" "))) continue;

            const voucherType = normalize(cells[col.voucherType]).toLowerCase().replace(/[^a-z]/g, "");
            const debit = parseAmount(cells[col.debit]);
            const credit = parseAmount(cells[col.credit]);
            const groupNames = [col.journalGroup, col.subGroup, col.subGroup2, col.subGroup3]
                .map(cell => normalize(cells[cell])).filter(Boolean);
            const problems: string[] = [];
            if (!voucherNo) problems.push("voucher number is blank");
            if (voucherType !== "payment") problems.push(`expected Payment type; found "${normalize(cells[col.voucherType]) || "blank"}"`);
            if (!accountName) problems.push("Account / Ledger Name is blank");
            if (!groupNames.length) problems.push("Journal Group/Sub Group path is blank");
            if (!Number.isFinite(debit) || !Number.isFinite(credit)) problems.push("debit/credit amount is invalid");
            else if ((debit > 0) === (credit > 0)) problems.push("exactly one of Debit Amount or Credit Amount must be positive");
            if (problems.length) {
                invalid.push(`${index + 1} (${problems.join("; ")})`);
                continue;
            }
            lines.push({
                sourceRow: index + 1,
                voucherNo,
                voucherDate: parsedRowDate || currentVoucherDate,
                groups: groupNames,
                accountName,
                debit,
                credit,
                narration: normalize(cells[col.narration])
            });
        }
    }

    if (invalid.length) throw new ApiError(`Invalid Payment voucher row(s): ${invalid.slice(0, 30).join(", ")}`, 400);
    if (!lines.length) throw new ApiError("No Payment voucher rows found with the expected register columns", 400);

    const vouchers = new Map<string, VoucherData>();
    for (const line of lines) {
        const dateKey = line.voucherDate
            ? `${line.voucherDate.getFullYear()}-${line.voucherDate.getMonth() + 1}-${line.voucherDate.getDate()}`
            : "undated";
        const groupKey = `${line.voucherNo.toLowerCase()}|${dateKey}`;
        const voucher = vouchers.get(groupKey) || {
            voucherNo: line.voucherNo, voucherDate: line.voucherDate, lines: [], debit: 0, credit: 0
        };
        voucher.voucherDate ||= line.voucherDate;
        voucher.lines.push(line);
        voucher.debit = roundMoney(voucher.debit + line.debit);
        voucher.credit = roundMoney(voucher.credit + line.credit);
        vouchers.set(groupKey, voucher);
    }
    return [...vouchers.values()];
}

const normalizedPath = (values: string[]) => values.map(value => value.replace(/\s+/g, " ").trim().toLowerCase());
const normalizedPartyName = (value: unknown) => normalize(value)
    .replace(/\s+-\s+sundry\s+creditor\s*$/i, "")
    .toLowerCase();

export class PaymentVoucherRepairService {
    static async reconcile(
        actor: any,
        buffer: Buffer,
        entry = false,
        requestedBranchId?: string,
        onVoucher?: (voucher: Record<string, unknown>) => void,
        onProgress?: (progress: { processed: number; total: number; voucherNo: string }) => void
    ) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        if (requestedBranchId && actor.branchAccessType !== "ALL" && requestedBranchId !== actor.branchId) {
            throw new ApiError("You do not have access to this branch", 403);
        }
        const branchId = actor.branchAccessType === "ALL" ? requestedBranchId : actor.branchId;
        if (!branchId) throw new ApiError("branchId is required for payment voucher reconciliation", 400);

        const vouchers = parseWorkbook(buffer);
        // Payment registers identify a creditor by the account name and its
        // Sundry Creditors path. Resolve that name back to the Agency master
        // so the posting uses the canonical agency-linked VENDOR ledger.
        const agencies = await prisma.agency.findMany({
            select: { id: true, name: true }
        });
        const agenciesByName = new Map<string, typeof agencies>();
        for (const agency of agencies) {
            const name = normalizedPartyName(agency.name);
            agenciesByName.set(name, [...(agenciesByName.get(name) || []), agency]);
        }
        const resolveCreditorAgency = (line: VoucherLine) => {
            const isSundryCreditor = line.groups.some(group =>
                key(group) === "sundrycreditors"
            );
            if (!isSundryCreditor) return undefined;
            const matches = agenciesByName.get(normalizedPartyName(line.accountName)) || [];
            // Never guess when Agency master contains duplicate normalized names.
            return matches.length === 1 ? matches[0] : undefined;
        };
        const allGroups = await prisma.ledgerGroup.findMany({ select: { id: true, name: true, parentId: true } });
        const groupById = new Map(allGroups.map(group => [group.id, group]));
        const actualPath = (ledger: { name: string; groupId: string }) => {
            const result: string[] = [];
            let group = groupById.get(ledger.groupId);
            while (group) {
                result.unshift(group.name);
                group = group.parentId ? groupById.get(group.parentId) : undefined;
            }
            return [...result, ledger.name];
        };

        // Load the workbook's existing vouchers and candidate ledgers once.
        // The old per-voucher/per-line lookups caused thousands of serial DB
        // round trips, making large imports appear to freeze mid-stream.
        const voucherBatchSize = 300;
        const existingByNumber = new Map<string, any[]>();
        const voucherNumbers = [...new Set(vouchers.map(voucher => voucher.voucherNo))];
        for (let index = 0; index < voucherNumbers.length; index += voucherBatchSize) {
            const batch = await prisma.voucher.findMany({
                where: {
                    voucherNo: { in: voucherNumbers.slice(index, index + voucherBatchSize) },
                    voucherType: VoucherType.PAYMENT
                },
                include: { entries: true }
            });
            for (const voucher of batch) {
                existingByNumber.set(voucher.voucherNo, [
                    ...(existingByNumber.get(voucher.voucherNo) || []), voucher
                ]);
            }
        }

        const ledgerNames = [...new Set(vouchers.flatMap(voucher =>
            voucher.lines.map(line => normalize(line.accountName))
        ))];
        const ledgersByName = new Map<string, any[]>();
        for (let index = 0; index < ledgerNames.length; index += voucherBatchSize) {
            const batch = await prisma.ledger.findMany({
                where: {
                    name: { in: ledgerNames.slice(index, index + voucherBatchSize), mode: "insensitive" },
                    isActive: true,
                    OR: [{ branchId }, { branchId: null }]
                },
                select: { id: true, name: true, groupId: true }
            });
            for (const ledger of batch) {
                const normalizedName = normalize(ledger.name).toLowerCase();
                ledgersByName.set(normalizedName, [
                    ...(ledgersByName.get(normalizedName) || []), ledger
                ]);
            }
        }

        const results: Array<Record<string, unknown>> = [];
        const addResult = (result: Record<string, unknown>) => {
            results.push(result);
            onVoucher?.(result);
        };
        let created = 0;
        const createVoucher = async (voucher: VoucherData) => prisma.$transaction(async tx => {
            const postingLines: Array<{
                ledgerId: string; entryType: EntryType; amount: number; branchId: string; narration?: string
            }> = [];
            const postingMetadata: Array<Record<string, unknown>> = [];
            for (const line of voucher.lines) {
                const creditorAgency = resolveCreditorAgency(line);
                if (creditorAgency) {
                    const vendorLedger = await LedgerService.getOrCreateVendorLedger(tx, branchId, creditorAgency.id);
                    postingLines.push({
                        ledgerId: vendorLedger.id,
                        entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                        amount: Math.max(line.debit, line.credit),
                        branchId,
                        narration: line.narration || undefined
                    });
                    postingMetadata.push({
                        sourceRow: line.sourceRow, accountName: line.accountName,
                        ledgerId: vendorLedger.id, ledgerName: vendorLedger.name,
                        ledgerCategory: vendorLedger.category, path: [...line.groups, line.accountName],
                        entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                        amount: Math.max(line.debit, line.credit)
                    });
                    continue;
                }

                const nature = /LIABIL|CREDIT|INCOME|CAPITAL|DUTI|TAX|CREDITOR/i.test(line.groups[0] || "")
                    ? LedgerNature.CREDIT : LedgerNature.DEBIT;
                let parentId: string | null = null;
                for (const groupName of line.groups) {
                    const group = await LedgerService.getOrCreateImportedJournalGroup(tx, groupName, parentId, nature);
                    parentId = group.id;
                }
                const ledger = await LedgerService.getOrCreateImportedJournalLedger(tx, branchId, line.accountName, parentId!, nature);
                postingLines.push({
                    ledgerId: ledger.id,
                    entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                    amount: Math.max(line.debit, line.credit),
                    branchId,
                    narration: line.narration || undefined
                });
                postingMetadata.push({
                    sourceRow: line.sourceRow, accountName: line.accountName,
                    ledgerId: ledger.id, ledgerName: ledger.name, ledgerCategory: ledger.category,
                    path: actualPath({ name: ledger.name, groupId: ledger.groupId }),
                    entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                    amount: Math.max(line.debit, line.credit)
                });
            }
            const createdVoucher = await LedgerService.createVoucher({
                voucherNo: voucher.voucherNo,
                voucherType: VoucherType.PAYMENT,
                sourceId: randomUUID(),
                branchId,
                voucherDate: voucher.voucherDate!,
                narration: voucher.lines.map(line => line.narration).filter(Boolean).join(" | ").slice(0, 1000),
                entries: postingLines
            }, tx);
            return { createdVoucher, postingLines, postingMetadata };
        }, { maxWait: 60_000, timeout: 5 * 60_000 });
        for (const [voucherIndex, voucher] of vouchers.entries()) {
            onProgress?.({
                processed: voucherIndex,
                total: vouchers.length,
                voucherNo: voucher.voucherNo
            });
            const systemVouchers = existingByNumber.get(voucher.voucherNo) || [];
            if (systemVouchers.length > 1) {
                addResult({ voucherNo: voucher.voucherNo, voucherDate: voucher.voucherDate, status: "ambiguous", reason: "More than one PAYMENT voucher has this number" });
                continue;
            }
            if (systemVouchers.length === 0) {
                const balanced = Math.abs(voucher.debit - voucher.credit) < 0.005;
                const dateAvailable = Boolean(voucher.voucherDate);
                const status = balanced && dateAvailable ? "missing" : "invalidMissingVoucher";
                const result: Record<string, unknown> = {
                    voucherNo: voucher.voucherNo, status, voucherDate: voucher.voucherDate,
                    debit: voucher.debit, credit: voucher.credit, balanced, dateAvailable,
                    rows: voucher.lines.map(line => {
                        const agency = resolveCreditorAgency(line);
                        return {
                            sourceRow: line.sourceRow,
                            accountName: line.accountName,
                            path: [...line.groups, line.accountName],
                            debit: line.debit,
                            credit: line.credit,
                            ...(agency ? {
                                resolvedAgencyId: agency.id,
                                resolvedAgencyName: agency.name,
                                postingLedgerCategory: "VENDOR"
                            } : {})
                        };
                    })
                };
                if (entry && status === "missing") {
                    try {
                        const { createdVoucher, postingLines, postingMetadata } = await createVoucher(voucher);
                        created++;
                        Object.assign(result, {
                            status: "created",
                            voucherId: createdVoucher.id,
                            voucherType: createdVoucher.voucherType,
                            branchId: createdVoucher.branchId,
                            createdAt: createdVoucher.createdAt,
                            entryCount: postingLines.length,
                            rows: postingMetadata
                        });
                        existingByNumber.set(voucher.voucherNo, [createdVoucher]);
                    } catch (error) {
                        Object.assign(result, {
                            status: "creationFailed",
                            reason: error instanceof Error ? error.message : "Voucher creation failed"
                        });
                    }
                }
                addResult(result);
                continue;
            }

            const systemVoucher = systemVouchers[0];
            const checks: Array<Record<string, unknown>> = [];
            for (const line of voucher.lines) {
                const ledgers = ledgersByName.get(normalize(line.accountName).toLowerCase()) || [];
                const expectedPath = normalizedPath([...line.groups, line.accountName]);
                const correctPathLedgers = ledgers.filter(ledger =>
                    JSON.stringify(normalizedPath(actualPath(ledger))) === JSON.stringify(expectedPath));
                const expectedLedger = correctPathLedgers.length === 1 ? correctPathLedgers[0] : undefined;
                const side = line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT;
                const value = Math.max(line.debit, line.credit);
                const correctEntry = expectedLedger && systemVoucher.entries.some(item =>
                    item.ledgerId === expectedLedger.id && item.entryType === side && Math.abs(Number(item.amount) - value) < 0.005);
                const wrongPathLedger = ledgers.find(ledger => systemVoucher.entries.some(item =>
                    item.ledgerId === ledger.id && item.entryType === side && Math.abs(Number(item.amount) - value) < 0.005));
                const status = correctEntry ? "correctSubGroup"
                    : correctPathLedgers.length > 1 ? "ledgerPathAmbiguous"
                        : wrongPathLedger ? "wrongSubGroup"
                            : expectedLedger ? "postingMissing" : "ledgerPathNotFound";
                checks.push({
                    sourceRow: line.sourceRow, accountName: line.accountName,
                    expectedPath: [...line.groups, line.accountName], actualPath: wrongPathLedger ? actualPath(wrongPathLedger) : undefined,
                    status, debit: line.debit, credit: line.credit
                });
            }
            const issues = checks.filter(check => check.status !== "correctSubGroup").length;
            addResult({
                voucherNo: voucher.voucherNo,
                voucherId: systemVoucher.id,
                // Reconciliation is non-mutating for existing vouchers. Report
                // them explicitly as skipped and retain the check outcome so
                // callers can distinguish a correct voucher from one needing repair.
                status: "skipped",
                reconciliationStatus: issues ? "existsWithSubGroupIssues" : "existsCorrectly",
                reason: "Voucher already exists; existing ledger entries were not changed",
                voucherDate: voucher.voucherDate,
                debit: voucher.debit,
                credit: voucher.credit,
                balanced: Math.abs(voucher.debit - voucher.credit) < 0.005,
                rows: checks
            });
        }

        return {
            branchId,
            entry,
            voucherType: VoucherType.PAYMENT,
            workbookVouchers: vouchers.length,
            created,
            summary: {
                missing: results.filter(result => result.status === "missing").length,
                skipped: results.filter(result => result.status === "skipped").length,
                existsCorrectly: results.filter(result => result.reconciliationStatus === "existsCorrectly").length,
                existsWithSubGroupIssues: results.filter(result => result.reconciliationStatus === "existsWithSubGroupIssues").length,
                invalid: results.filter(result => result.status === "invalidMissingVoucher").length,
                ambiguous: results.filter(result => result.status === "ambiguous").length,
                creationFailed: results.filter(result => result.status === "creationFailed").length
            },
            vouchers: results
        };
    }
}
