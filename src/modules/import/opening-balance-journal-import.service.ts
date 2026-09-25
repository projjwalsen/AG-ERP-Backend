import { createHash } from "crypto";
import ExcelJS from "exceljs";
import {
    EntryType,
    AgencyType,
    JournalDirection,
    JournalHeadType,
    JournalStatus,
    LedgerNature,
    LedgerType,
    PaymentMode,
    VoucherType
} from "@prisma/client";
import { Express } from "express";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { createSimpleImportErrorReport } from "./multer.import";

type OpeningNode = {
    row: number;
    name: string;
    indent: number;
    debit: number;
    credit: number;
    parent?: OpeningNode;
    children: OpeningNode[];
};

type OpeningColumns = {
    debit: number;
    credit: number;
    balance?: number;
};

type ImportSummary = {
    total: number;
    processed: number;
    success: number;
    skipped: number;
    failed: number;
    percentage: number;
    errors: Array<{
        row: number;
        name: string;
        path?: string;
        debit?: number;
        credit?: number;
        message: string;
    }>;
    errorReport?: { reportId: string; fileName: string };
};

const normalizeName = (value: unknown) => String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const numberValue = (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
};

const openingAmountsMatch = (
    leftDebit: number,
    leftCredit: number,
    rightDebit: number,
    rightCredit: number
) => Math.abs(leftDebit - rightDebit) < 0.005
    && Math.abs(leftCredit - rightCredit) < 0.005;

const sourceKey = (branchId: string, path: string) =>
    `OPENING_BALANCE:${branchId}:${createHash("sha1")
        .update(path.toUpperCase())
        .digest("hex")
        .slice(0, 32)}`;

const parseTallyPeriodStart = (value: string) => {
    const start = value.split(/\s+to\s+/i)[0]?.trim();
    const match = start?.match(/^(\d{1,2})[-\s]+([A-Za-z]{3})[-\s]+(\d{2,4})$/);
    if (!match) return undefined;
    const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        .indexOf(match[2].toUpperCase());
    if (month < 0) return undefined;
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return new Date(year, month, Number(match[1]), 0, 0, 0, 0);
};

/**
 * Tally exports two common trial-balance layouts:
 *
 * 1. Opening Balance -> Debit/Credit (the original Tally export).
 * 2. Opening -> Balance, followed by Transactions -> Debit/Credit
 *    (the newer `trial-balance (8).xlsx` export).
 *
 * Do not assume that columns B/C are always opening debit/credit. In the
 * second layout column C is transaction debit, which was previously being
 * imported as opening credit.
 */
const resolveOpeningColumns = (worksheet: ExcelJS.Worksheet, headerRow: number): OpeningColumns => {
    const firstHeader = normalizeName(worksheet.getRow(headerRow + 1).getCell(2).value).toUpperCase();
    const secondHeader = normalizeName(worksheet.getRow(headerRow + 2).getCell(2).value).toUpperCase();
    const thirdHeader = normalizeName(worksheet.getRow(headerRow + 2).getCell(3).value).toUpperCase();

    if (secondHeader === "BALANCE" && thirdHeader === "DEBIT") {
        // Opening Balance is a signed display value. The number format carries
        // the Dr/Cr suffix; the importer converts it into the two ledger sides.
        return { debit: 2, credit: 2, balance: 2 };
    }

    if (firstHeader.includes("OPENING") && secondHeader === "DEBIT" && thirdHeader === "CREDIT") {
        return { debit: 2, credit: 3 };
    }

    // Conservative fallback for older/hand-edited files.
    return { debit: 2, credit: 3 };
};

const signedOpeningAmount = (cell: ExcelJS.Cell) => {
    const amount = Math.abs(numberValue(cell.value));
    const format = String(cell.numFmt || "").toUpperCase();
    if (format.includes("CR")) return { debit: 0, credit: amount };
    return { debit: amount, credit: 0 };
};

/**
 * Parse a Tally Trial Balance sheet. Indented rows are children of the nearest
 * preceding row with a smaller indentation. Amounts on parent rows are totals
 * only; only leaf rows are eligible for posting.
 */
export const parseTallyOpeningBalanceTree = async (buffer: Buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets.find(sheet =>
        /trial\s*balance/i.test(sheet.name)
    ) || workbook.worksheets[0];

    if (!worksheet) throw new ApiError("The workbook has no worksheet", 400);

    let particularsHeaderRow = 0;
    worksheet.eachRow((row, rowNumber) => {
        if (normalizeName(row.getCell(1).value).toUpperCase() === "PARTICULARS") {
            particularsHeaderRow = rowNumber;
        }
    });
    if (!particularsHeaderRow) {
        throw new ApiError("Expected a Tally Trial Balance sheet with a Particulars column", 400);
    }

    const openingColumns = resolveOpeningColumns(worksheet, particularsHeaderRow);

    const nodes: OpeningNode[] = [];
    const stack: OpeningNode[] = [];
    for (let rowNumber = particularsHeaderRow + 3; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const name = normalizeName(row.getCell(1).value);
        if (!name || /^grand total$/i.test(name)) continue;

        const node: OpeningNode = {
            row: rowNumber,
            name,
            indent: Number(row.getCell(1).alignment?.indent || 0),
            debit: openingColumns.balance
                ? signedOpeningAmount(row.getCell(openingColumns.balance)).debit
                : numberValue(row.getCell(openingColumns.debit).value),
            credit: openingColumns.balance
                ? signedOpeningAmount(row.getCell(openingColumns.balance)).credit
                : numberValue(row.getCell(openingColumns.credit).value),
            children: []
        };
        while (stack.length && stack[stack.length - 1].indent >= node.indent) {
            stack.pop();
        }
        const parent = stack[stack.length - 1];
        if (parent) {
            node.parent = parent;
            parent.children.push(node);
        }
        nodes.push(node);
        stack.push(node);
    }

    const leaves = nodes.filter(node =>
        node.children.length === 0 && (node.debit !== 0 || node.credit !== 0)
    );
    if (leaves.length === 0) {
        throw new ApiError("No non-zero opening-balance leaf rows were found", 400);
    }
    return {
        nodes,
        leaves,
        periodStart: parseTallyPeriodStart(
            normalizeName(worksheet.getRow(particularsHeaderRow).getCell(2).value)
        )
    };
};

export class OpeningBalanceJournalImportService {
    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        requestedBranchId: string | undefined,
        openingDate: Date | undefined,
        onProgress?: (summary: ImportSummary) => void
    ) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        const branchId = actor.branchAccessType === "ALL"
            ? requestedBranchId
            : actor.branchId;
        if (!branchId) {
            throw new ApiError("Select a branch before importing opening balances", 400);
        }
        if (requestedBranchId && actor.branchAccessType !== "ALL" && requestedBranchId !== actor.branchId) {
            throw new ApiError("You do not have access to this branch", 403);
        }
        const branch = await prisma.branch.findUnique({ where: { id: branchId } });
        if (!branch || !branch.isActive) throw new ApiError("Branch not found or inactive", 404);

        const { leaves, periodStart } = await parseTallyOpeningBalanceTree(file.buffer);
        // A Tally Trial Balance labels its source period above the table. When
        // the user leaves the date blank, preserve that accounting start date
        // instead of incorrectly dating every opening entry to today.
        const effectiveOpeningDate = openingDate || periodStart || new Date();
        const summary: ImportSummary = {
            total: leaves.length,
            processed: 0,
            success: 0,
            skipped: 0,
            failed: 0,
            percentage: 0,
            errors: []
        };
        const headCache = new Map<OpeningNode, any>();
        const nodePath = (node: OpeningNode) => {
            const path: string[] = [];
            for (let current: OpeningNode | undefined = node; current; current = current.parent) {
                path.unshift(current.name);
            }
            return path.join(" > ");
        };

        // A previous parser version could post a parent subtotal as if it were
        // a ledger. Once indentation is understood, that subtotal must not
        // remain as an opening posting because the leaf rows already contain
        // the same amount. Remove only opening-balance postings for parent
        // paths present in this workbook; normal purchase/sale/accounting
        // vouchers are never touched.
        const staleParentPaths = new Set(
            nodes
                .filter(node => node.children.length > 0)
                .map(nodePath)
        );
        if (staleParentPaths.size > 0) {
            await prisma.$transaction(async tx => {
                const stale = await tx.journal.findMany({
                    where: {
                        branchId,
                        remarks: { startsWith: "Opening balance import:" },
                        voucher: { is: { voucherType: VoucherType.OPENING_BALANCE } }
                    },
                    include: { voucher: true, journalHead: true }
                });
                for (const journal of stale) {
                    const importedPath = String(journal.remarks || "").replace(/^Opening balance import:\s*/i, "");
                    if (!staleParentPaths.has(importedPath)) continue;
                    const ledgerId = journal.journalHead.ledgerId;
                    if (journal.voucherId) {
                        await tx.ledgerEntry.deleteMany({ where: { voucherId: journal.voucherId } });
                        await tx.journal.update({ where: { id: journal.id }, data: { voucherId: null } });
                        await tx.voucher.delete({ where: { id: journal.voucherId } });
                    }
                    await tx.journal.delete({ where: { id: journal.id } });
                    await LedgerService.syncCachedBalance(tx, ledgerId);
                }
            });
        }

        const ensureHead = async (tx: any, node: OpeningNode, ledgerOverride?: any): Promise<any> => {
            const cached = headCache.get(node);
            if (cached) return cached;

            const parentHead = node.parent ? await ensureHead(tx, node.parent) : null;
            let head = await tx.journalHead.findFirst({
                where: {
                    parentId: parentHead?.id || null,
                    name: { equals: node.name, mode: "insensitive" }
                },
                include: { ledger: true }
            });
            if (head) {
                headCache.set(node, head);
                return head;
            }
            const group = ledgerOverride ? null : await LedgerService.getOrCreateImportedJournalGroup(
                tx, node.name, parentHead?.ledger?.groupId || null, LedgerNature.DEBIT
            );
            const ledger = ledgerOverride || await LedgerService.getOrCreateImportedJournalLedger(
                tx, branchId, node.name, group!.id, LedgerNature.DEBIT
            );
            head = await tx.journalHead.create({
                data: {
                    name: node.name,
                    parentId: parentHead?.id || null,
                    ledgerId: ledger.id,
                    type: JournalHeadType.BOTH,
                    isActive: true
                },
                include: { ledger: true }
            });
            headCache.set(node, head);
            return head;
        };

        for (const leaf of leaves) {
            let path = leaf.name;
            let debit = 0;
            let credit = 0;
            try {
                const pathNodes: OpeningNode[] = [];
                for (let current: OpeningNode | undefined = leaf; current; current = current.parent) {
                    pathNodes.unshift(current);
                }
                path = pathNodes.map(node => node.name).join(" > ");
                const importKey = sourceKey(branchId, path);
                debit = Number(leaf.debit.toFixed(2));
                credit = Number(leaf.credit.toFixed(2));
                const direction = debit > 0
                    ? JournalDirection.OUTWARD
                    : JournalDirection.INWARD;
                const amount = debit || credit;

                const result = await prisma.$transaction(async tx => {
                    const ancestorNames = pathNodes.map(node => node.name.toUpperCase());
                    const agencyType = ancestorNames.includes("SUNDRY DEBTORS")
                        ? AgencyType.CLIENT
                        : ancestorNames.includes("SUNDRY CREDITORS")
                            ? AgencyType.VENDOR
                            : null;
                    let agency: any = null;
                    let head: any;
                    const categoryParent = leaf.parent || leaf;
                    let categoryName = leaf.parent ? leaf.name : "Opening Balance";
                    // Prefer an accounting ledger that already represents the
                    // leaf under the same Tally parent. For example, reuse
                    // Investments -> GOLD & ORNAMENTS instead of creating an
                    // imported JOURNAL ledger also named Investments.
                    const existingLeafLedger = !agencyType && leaf.parent
                        ? await tx.ledger.findFirst({
                            where: {
                                name: { equals: leaf.name, mode: "insensitive" },
                                // Prisma does not permit null inside an `in`
                                // filter. Match ledgers owned by this branch
                                // or shared/global ledgers explicitly.
                                OR: [
                                    { branchId },
                                    { branchId: null }
                                ],
                                group: {
                                    name: {
                                        equals: leaf.parent.name,
                                        mode: "insensitive"
                                    }
                                }
                            }
                        })
                        : null;
                    const existingByPath = await tx.journal.findUnique({
                        where: { importKey },
                        include: { journalHead: true, voucher: true }
                    });
                    // A previous upload without indentation can have posted
                    // the parent subtotal as a ledger (for example,
                    // "Investments" instead of "Investments > GOLD &
                    // ORNAMENTS"). If its amount is exactly this leaf's
                    // amount, reuse that one existing opening posting and
                    // move it to the real existing ledger. This keeps the
                    // balance single-counted while repairing its location in
                    // the trial-balance hierarchy.
                    const legacyParentImport = !existingByPath && existingLeafLedger && leaf.parent
                        && openingAmountsMatch(leaf.parent.debit, leaf.parent.credit, debit, credit)
                        ? await tx.journal.findFirst({
                            where: {
                                branchId,
                                amount,
                                direction,
                                importKey: { startsWith: `OPENING_BALANCE:${branchId}:` },
                                remarks: {
                                    equals: `Opening balance import: ${leaf.parent.name}`,
                                    mode: "insensitive"
                                },
                                voucher: { is: { voucherType: VoucherType.OPENING_BALANCE } }
                            },
                            include: { journalHead: true, voucher: true }
                        })
                        : null;
                    // An earlier flat import may instead have used the leaf
                    // name by itself. Treat it as the same opening amount on
                    // a later correctly-indented upload.
                    const legacyLeafImport = !existingByPath && !legacyParentImport && existingLeafLedger
                        ? await tx.journal.findFirst({
                            where: {
                                branchId,
                                amount,
                                direction,
                                importKey: { startsWith: `OPENING_BALANCE:${branchId}:` },
                                remarks: {
                                    equals: `Opening balance import: ${leaf.name}`,
                                    mode: "insensitive"
                                },
                                voucher: { is: { voucherType: VoucherType.OPENING_BALANCE } }
                            },
                            include: { journalHead: true, voucher: true }
                        })
                        : null;
                    const existing = existingByPath || legacyParentImport || legacyLeafImport;

                    if (existing) {
                        // Re-running either workbook is also a reconciliation
                        // pass. Older versions read transaction columns as
                        // opening amounts, so simply skipping by importKey
                        // would preserve the wrong value forever.
                        let targetHead = existing.journalHead;
                        if (existingLeafLedger && existing.journalHead.ledgerId !== existingLeafLedger.id) {
                            targetHead = await ensureHead(tx, leaf, existingLeafLedger);
                            let targetCategory = await tx.journalCategory.findFirst({
                                where: {
                                    journalHeadId: targetHead.id,
                                    name: { equals: categoryName, mode: "insensitive" }
                                }
                            });
                            if (!targetCategory) {
                                targetCategory = await tx.journalCategory.create({
                                    data: { name: categoryName, journalHeadId: targetHead.id, isActive: true }
                                });
                            }
                            await tx.journal.update({
                                where: { id: existing.id },
                                data: { journalHeadId: targetHead.id, categoryId: targetCategory.id }
                            });
                        }
                        const targetLedgerId = targetHead.ledgerId;
                        const previousLedgerId = existing.journalHead.ledgerId;
                        await tx.journal.update({
                            where: { id: existing.id },
                            data: {
                                amount,
                                direction,
                                journalDate: effectiveOpeningDate,
                                remarks: `Opening balance import: ${path}`
                            }
                        });
                        if (existing.voucherId) {
                            await tx.voucher.update({
                                where: { id: existing.voucherId },
                                data: {
                                    totalDebit: debit,
                                    totalCredit: credit,
                                    voucherDate: effectiveOpeningDate,
                                    narration: `Opening balance import: ${path}`
                                }
                            });
                            await tx.ledgerEntry.updateMany({
                                where: { voucherId: existing.voucherId },
                                data: {
                                    ledgerId: targetLedgerId,
                                    entryType: debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                                    amount,
                                    narration: `Opening balance: ${categoryName}`
                                }
                            });
                        }
                        await LedgerService.syncCachedBalance(tx, previousLedgerId);
                        if (targetLedgerId !== previousLedgerId) {
                            await LedgerService.syncCachedBalance(tx, targetLedgerId);
                        }
                        return "skipped" as const;
                    }

                    if (agencyType) {
                        agency = await tx.agency.findFirst({
                            where: { name: { equals: leaf.name, mode: "insensitive" } }
                        });
                        if (!agency) {
                            agency = await tx.agency.create({
                                data: {
                                    name: leaf.name,
                                    type: agencyType,
                                    branches: { create: { branchId } }
                                }
                            });
                        } else {
                            await tx.agencyBranch.upsert({
                                where: { agencyId_branchId: { agencyId: agency.id, branchId } },
                                update: { isActive: true },
                                create: { agencyId: agency.id, branchId }
                            });
                        }
                        const agencyLedger = agencyType === AgencyType.CLIENT
                            ? await LedgerService.getOrCreateCustomerLedger(tx, branchId, agency.id)
                            : await LedgerService.getOrCreateVendorLedger(tx, branchId, agency.id);
                        head = await ensureHead(tx, leaf, agencyLedger);
                        categoryName = "Opening Balance";
                    } else if (existingLeafLedger) {
                        head = await ensureHead(tx, leaf, existingLeafLedger);
                        categoryName = "Opening Balance";
                    } else {
                        head = await ensureHead(tx, categoryParent);
                    }
                    let category = await tx.journalCategory.findFirst({
                        where: {
                            journalHeadId: head.id,
                            name: { equals: categoryName, mode: "insensitive" }
                        }
                    });
                    if (!category) {
                        category = await tx.journalCategory.create({
                            data: { name: categoryName, journalHeadId: head.id, isActive: true }
                        });
                    }

                    const journal = await tx.journal.create({
                        data: {
                            branchId,
                            agencyId: agency?.id || null,
                            journalHeadId: head.id,
                            categoryId: category.id,
                            importKey,
                            amount,
                            direction,
                            paymentMode: PaymentMode.OFFLINE,
                            remarks: `Opening balance import: ${path}`,
                            journalDate: effectiveOpeningDate,
                            status: JournalStatus.APPROVED,
                            createdById: actor.id,
                            approvedById: actor.id,
                            approvedAt: new Date()
                        }
                    });
                    const voucher = await tx.voucher.create({
                        data: {
                            voucherNo: `OPN-${journal.id.slice(0, 8).toUpperCase()}`,
                            voucherType: VoucherType.OPENING_BALANCE,
                            sourceId: journal.id,
                            branchId,
                            narration: `Opening balance import: ${path}`,
                            voucherDate: effectiveOpeningDate,
                            totalDebit: debit,
                            totalCredit: credit,
                            entries: {
                                create: {
                                    ledgerId: head.ledgerId,
                                    branchId,
                                    entryType: debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                                    amount,
                                    narration: `Opening balance: ${categoryName}`
                                }
                            }
                        }
                    });
                    await tx.journal.update({ where: { id: journal.id }, data: { voucherId: voucher.id } });
                    return "created" as const;
                });
                if (result === "skipped") summary.skipped++;
                else summary.success++;
            } catch (error: any) {
                summary.failed++;
                summary.errors.push({
                    row: leaf.row,
                    name: leaf.name,
                    path,
                    debit,
                    credit,
                    message: error?.message || "Import failed"
                });
            } finally {
                summary.processed++;
                summary.percentage = Number(((summary.processed / summary.total) * 100).toFixed(2));
                onProgress?.(summary);
            }
        }
        if (summary.errors.length > 0) {
            summary.errorReport = await createSimpleImportErrorReport(
                summary.errors.map(error => ({
                    "Source Row": error.row,
                    "Particular Name": error.name,
                    "Hierarchy Path": error.path || error.name,
                    Debit: error.debit ?? "",
                    Credit: error.credit ?? "",
                    "Failure Reason": error.message
                })),
                "opening-balance"
            );
        }
        return summary;
    }
}
