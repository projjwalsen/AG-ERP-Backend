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

type OpeningNode = {
    row: number;
    name: string;
    indent: number;
    debit: number;
    credit: number;
    parent?: OpeningNode;
    children: OpeningNode[];
};

type ImportSummary = {
    total: number;
    processed: number;
    success: number;
    skipped: number;
    failed: number;
    percentage: number;
    errors: Array<{ row: number; name: string; message: string }>;
};

const normalizeName = (value: unknown) => String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const numberValue = (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
};

const sourceKey = (branchId: string, path: string) =>
    `OPENING_BALANCE:${branchId}:${createHash("sha1")
        .update(path.toUpperCase())
        .digest("hex")
        .slice(0, 32)}`;

const parseTallyPeriodStart = (value: string) => {
    const start = value.split(/\s+to\s+/i)[0]?.trim();
    const match = start?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (!match) return undefined;
    const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        .indexOf(match[2].toUpperCase());
    if (month < 0) return undefined;
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return new Date(year, month, Number(match[1]), 0, 0, 0, 0);
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
            debit: numberValue(row.getCell(2).value),
            credit: numberValue(row.getCell(3).value),
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
            try {
                const pathNodes: OpeningNode[] = [];
                for (let current: OpeningNode | undefined = leaf; current; current = current.parent) {
                    pathNodes.unshift(current);
                }
                const path = pathNodes.map(node => node.name).join(" > ");
                const importKey = sourceKey(branchId, path);
                const debit = Number(leaf.debit.toFixed(2));
                const credit = Number(leaf.credit.toFixed(2));
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
                                branchId: { in: [branchId, null] },
                                group: {
                                    name: {
                                        equals: leaf.parent.name,
                                        mode: "insensitive"
                                    }
                                }
                            }
                        })
                        : null;
                    const existing = await tx.journal.findUnique({
                        where: { importKey },
                        include: { journalHead: true, voucher: true }
                    });

                    if (existing) {
                        // Earlier versions made an imported parent ledger even
                        // where a matching ledger already existed. Re-running
                        // the same file repairs that mapping without adding a
                        // second opening-balance amount.
                        if (existingLeafLedger && existing.journalHead.ledgerId !== existingLeafLedger.id) {
                            if (existing.voucherId) {
                                await tx.ledgerEntry.updateMany({
                                    where: { voucherId: existing.voucherId },
                                    data: { ledgerId: existingLeafLedger.id }
                                });
                            }
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
                summary.errors.push({ row: leaf.row, name: leaf.name, message: error?.message || "Import failed" });
            } finally {
                summary.processed++;
                summary.percentage = Number(((summary.processed / summary.total) * 100).toFixed(2));
                onProgress?.(summary);
            }
        }
        return summary;
    }
}
