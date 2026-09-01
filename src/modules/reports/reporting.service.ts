import { DebitCreditNoteStatus, DebitCreditNoteType, EntryType, JournalStatus, LedgerNature, LedgerType, OutstandingType, Prisma, PurchaseStatus, SalesStatus, TransactionDirection, VoucherType } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { parseDate, resolveBalanceType } from "../../core/utils/loc.utils";
import { LedgerService } from "../accounting/ledger/ledger.service";
import {
    buildTrialBalanceBranchFilter,
    calculateTrialBalanceAmounts,
    effectiveMovementStart,
    hasTrialBalanceActivity,
    openingAppliesAt,
    resolveTrialBalancePeriod,
    sumTrialBalanceEntryGroups
} from "./trial-balance.utils";

// Older generated Prisma clients do not expose CASH_RECEIPT yet. Keep this
// filter valid during a rolling schema/client update.
const CASH_VOUCHER_TYPES = [
    VoucherType.CASH_PAYMENT,
    (VoucherType as any).CASH_RECEIPT ?? "CASH_RECEIPT",
    VoucherType.OPENING_BALANCE
] as VoucherType[];

export class ReportingService {
    private static adjustedSaleTotal(sale: any) {
        const debitNotes = (sale.debitCreditNotes || [])
            .filter((note: any) => note.type === DebitCreditNoteType.DEBIT_NOTE)
            .reduce((sum: number, note: any) => sum + Number(note.totalAmount), 0);

        const creditNotes = (sale.debitCreditNotes || [])
            .filter((note: any) => note.type === DebitCreditNoteType.CREDIT_NOTE)
            .reduce((sum: number, note: any) => sum + Number(note.totalAmount), 0);

        return Number(sale.grandTotal) + debitNotes - creditNotes;
    }

    private static splitSignedBalance(value: number) {
        const rounded = Number(value.toFixed(2));

        return {
            debit: rounded > 0 ? rounded : 0,
            credit: rounded < 0 ? Math.abs(rounded) : 0
        };
    }

    private static sumEntryGroups(
        groups: Array<{ ledgerId: string; entryType: EntryType; _sum: { amount: any } }>
    ) {
        const map = new Map<string, { debit: number; credit: number }>();

        for (const group of groups) {
            const current = map.get(group.ledgerId) || { debit: 0, credit: 0 };
            const amount = Number(group._sum.amount || 0);

            if (group.entryType === EntryType.DEBIT) {
                current.debit += amount;
            } else {
                current.credit += amount;
            }

            map.set(group.ledgerId, current);
        }

        return map;
    }

    private static async getCashDiagnostics(
        ledgers: any[],
        branchEntryFilter: Prisma.LedgerEntryWhereInput | undefined,
        startDate: Date,
        endDate: Date,
        rawRows: any[]
    ) {
        const cashLedgers = ledgers.filter(
            ledger => ledger.category === LedgerType.CASH
        );
        const cashLedgerIds = cashLedgers.map(ledger => ledger.id);

        if (cashLedgerIds.length === 0) {
            return {
                cashLedgerCount: 0,
                cashLedgers: [],
                duplicateSourceIds: [],
                outsidePeriodEntryCount: 0,
                periodDebit: 0,
                periodCredit: 0
            };
        }

        const cashEntryWhere: Prisma.LedgerEntryWhereInput = {
            AND: [
                ...(branchEntryFilter ? [branchEntryFilter] : []),
                { ledgerId: { in: cashLedgerIds } },
                // Cash-In-Hand includes cash receipts/payments and opening-balance vouchers.
                { voucher: { voucherType: { in: CASH_VOUCHER_TYPES } } }
            ]
        };
        const periodCashEntryWhere: Prisma.LedgerEntryWhereInput = {
            AND: [
                cashEntryWhere,
                {
                    voucher: {
                        voucherDate: {
                            gte: startDate,
                            lte: endDate
                        }
                    }
                }
            ]
        };

        const [entries, allCashEntryCount] = await Promise.all([
            prisma.ledgerEntry.findMany({
                where: periodCashEntryWhere,
                select: {
                    ledgerId: true,
                    entryType: true,
                    amount: true,
                    voucher: {
                        select: {
                            sourceId: true,
                            voucherNo: true
                        }
                    }
                }
            }),
            prisma.ledgerEntry.count({ where: cashEntryWhere })
        ]);

        const sourceCounts = new Map<string, number>();
        let periodDebit = 0;
        let periodCredit = 0;

        for (const entry of entries) {
            const amount = Number(entry.amount || 0);
            if (entry.entryType === EntryType.DEBIT) periodDebit += amount;
            else periodCredit += amount;

            const sourceId = entry.voucher.sourceId;
            sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1);
        }

        return {
            cashLedgerCount: cashLedgers.length,
            cashLedgers: cashLedgers.map(ledger => {
                const row = rawRows.find(item => item.ledgerId === ledger.id);
                return {
                    ledgerId: ledger.id,
                    code: ledger.code,
                    name: ledger.name,
                    branchId: ledger.branchId || null,
                    branchName: ledger.branch?.name || null,
                    openingDebit: Number(row?.openingDebit || 0),
                    openingCredit: Number(row?.openingCredit || 0),
                    periodDebit: Number(row?.periodDebit || 0),
                    periodCredit: Number(row?.periodCredit || 0),
                    closingDebit: Number(row?.closingDebit || 0),
                    closingCredit: Number(row?.closingCredit || 0)
                };
            }),
            duplicateSourceIds: Array.from(sourceCounts.entries())
                .filter(([, count]) => count > 1)
                .map(([sourceId, count]) => ({ sourceId, entryCount: count })),
            outsidePeriodEntryCount: Math.max(allCashEntryCount - entries.length, 0),
            periodDebit: Number(periodDebit.toFixed(2)),
            periodCredit: Number(periodCredit.toFixed(2))
        };
    }

    static async getTrialBalanceReport(
        actor: any,
        query?: {
            branchId?: string;
            startDate?: string;
            endDate?: string;
            includeZero?: boolean;
            requireBranch?: boolean;
        }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        /**
         * ============================================================
         * 1. BRANCH ACCESS
         * ============================================================
         */

        let branchId =
            actor.branchAccessType === "ALL"
                ? query?.branchId
                : actor.branchId;

        if (
            query?.branchId &&
            actor.branchAccessType !== "ALL" &&
            query.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "You do not have access to this branch",
                403
            );
        }

        let branch: {
            id: string;
            name: string;
            code: string;
            gstin: string | null;
        } | null = null;

        if (!branchId && actor.branchAccessType === "ALL") {
            const activeBranches = await prisma.branch.findMany({
                where: {
                    isActive: true
                },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    gstin: true
                },
                take: 2,
                orderBy: {
                    createdAt: "asc"
                }
            });

            if (activeBranches.length === 1) {
                branch = activeBranches[0];
                branchId = branch.id;
            }
        }

        if (branchId && !branch) {
            branch = await prisma.branch.findUnique({
                where: {
                    id: branchId
                },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    gstin: true
                }
            });

            if (!branch) {
                throw new ApiError(
                    "Branch not found",
                    404
                );
            }
        }

        if (query?.requireBranch && !branchId) {
            throw new ApiError(
                "A branchId is required for an exact trial-balance comparison",
                400
            );
        }

        /**
         * ============================================================
         * 2. REPORT PERIOD
         * ============================================================
         */

        const requestedStartDate =
            query?.startDate
                ? parseDate(
                    query.startDate,
                    "startDate"
                )
                : undefined;

        const requestedEndDate =
            query?.endDate
                ? parseDate(
                    query.endDate,
                    "endDate"
                )
                : new Date();

        if (
            requestedStartDate &&
            requestedStartDate > requestedEndDate
        ) {
            throw new ApiError(
                "startDate cannot be after endDate",
                400
            );
        }

        const {
            startDate,
            endDate,
            normalizedFromBeginning
        } = resolveTrialBalancePeriod(
            requestedStartDate,
            requestedEndDate
        );

        /**
         * ============================================================
         * 3. BRANCH ENTRY FILTER
         * ============================================================
         *
         * LedgerEntry can carry branchId directly.
         * Voucher also carries branchId.
         *
         * Existing architecture supports both.
         */

        const branchEntryFilter:
            Prisma.LedgerEntryWhereInput | undefined =
            buildTrialBalanceBranchFilter(branchId);

        /**
         * ============================================================
         * 4. PERIOD MOVEMENT
         * ============================================================
         *
         * Debit/Credit columns represent transactions inside:
         *
         * startDate -> endDate
         *
         * If startDate is not provided, the most recently completed Indian
         * financial year is used.
         */

        /**
         * ============================================================
         * 5. PRIOR MOVEMENT
         * ============================================================
         *
         * Needed only for calculating Closing Balance.
         *
         * We don't display Opening Balance, but closing balance still
         * requires everything that happened before startDate.
         */

        /**
         * ============================================================
         * 6. LEDGERS
         * ============================================================
         */

        const ledgerWhere:
            Prisma.LedgerWhereInput = {

            isActive: true,

            ...(branchId
                ? {
                    OR: [
                        {
                            branchId
                        },

                        {
                            branchId: null
                        },

                        {
                            entries: {
                                some:
                                    branchEntryFilter
                            }
                        }
                    ]
                }
                : {})
        };

        /**
         * ============================================================
         * 7. FETCH DATA
         * ============================================================
         */

        type LedgerGroupReportRow = {
            id: string;
            code: string;
            name: string;
            parentId: string | null;
        };

        const [ledgers, ledgerGroups] = await Promise.all([
            prisma.ledger.findMany({
                where:
                    ledgerWhere,

                include: {
                    group: true,

                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true
                        }
                    }
                },

                orderBy: [
                    {
                        group: {
                            name: "asc"
                        }
                    },
                    {
                        name: "asc"
                    }
                ]
            }),
            prisma.ledgerGroup.findMany({
                select: {
                    id: true,
                    code: true,
                    name: true,
                    parentId: true,
                    nature: true
                },
                orderBy: { name: "asc" }
            })
        ]) as [any[], LedgerGroupReportRow[]];

        const aggregateWindows = async (window: "period" | "prior") => {
            const byCutoff = new Map<string, {
                cutoff?: Date;
                ledgerIds: string[];
            }>();

            for (const ledger of ledgers) {
                const mayUseOpening =
                    (!branchId || ledger.branchId === branchId) &&
                    openingAppliesAt(ledger.openingBalanceDate, endDate);
                const openingDate = mayUseOpening
                    ? ledger.openingBalanceDate || undefined
                    : undefined;

                if (
                    window === "prior" &&
                    openingDate &&
                    openingDate >= startDate
                ) {
                    continue;
                }

                const cutoff = window === "period"
                    ? effectiveMovementStart(startDate, openingDate, endDate)
                    : openingDate;
                const key = cutoff ? cutoff.toISOString() : "__all__";
                const bucket = byCutoff.get(key) || {
                    cutoff,
                    ledgerIds: []
                };

                bucket.ledgerIds.push(ledger.id);
                byCutoff.set(key, bucket);
            }

            const groups: any[] = [];
            const batchSize = 250;

            for (const bucket of byCutoff.values()) {
                for (
                    let index = 0;
                    index < bucket.ledgerIds.length;
                    index += batchSize
                ) {
                    const ledgerIds =
                        bucket.ledgerIds.slice(index, index + batchSize);
                    const voucherDate = window === "period"
                        ? {
                            gte: bucket.cutoff || startDate,
                            lte: endDate
                        }
                        : {
                            ...(bucket.cutoff ? { gte: bucket.cutoff } : {}),
                            lt: startDate
                        };

                    const batch = await prisma.ledgerEntry.groupBy({
                        by: ["ledgerId", "entryType"],
                        where: {
                            AND: [
                                ...(branchEntryFilter
                                    ? [branchEntryFilter]
                                    : []),
                                {
                                    ledgerId: { in: ledgerIds },
                                    voucher: { voucherDate }
                                },
                                {
                                    OR: [
                                        // Non-cash ledgers retain all voucher types.
                                        {
                                            ledger: {
                                                category: { not: LedgerType.CASH }
                                            }
                                        },
                                        // Cash in Hand is driven by Cash Receipt/Payment and Opening Balance vouchers.
                                        {
                                            ledger: { category: LedgerType.CASH },
                                            voucher: { voucherType: { in: CASH_VOUCHER_TYPES } }
                                        }
                                    ]
                                }
                            ]
                        },
                        _sum: { amount: true }
                    });

                    groups.push(...batch);
                }
            }

            return groups;
        };

        const [periodGroups, priorGroups] = await Promise.all([
            aggregateWindows("period"),
            aggregateWindows("prior")
        ]);
        const periodMap = sumTrialBalanceEntryGroups(periodGroups);
        const priorMap = sumTrialBalanceEntryGroups(priorGroups);

        /**
         * ============================================================
         * 8. BUILD ACCOUNT-WISE TRIAL BALANCE
         * ============================================================
         *
         * Signed balance convention:
         *
         * Debit  = +
         * Credit = -
         *
         * Closing =
         * ledger opening
         * + prior debit
         * - prior credit
         * + period debit
         * - period credit
         */

        const rawRows =
            ledgers.map(ledger => {

                /**
                 * A branch-specific report must not blindly inherit
                 * another branch's opening balance.
                 */
                const shouldUseLedgerOpening =
                    (!branchId || ledger.branchId === branchId) &&
                    openingAppliesAt(
                        ledger.openingBalanceDate,
                        endDate
                    );

                const prior =
                    priorMap.get(
                        ledger.id
                    ) || {
                        debit: 0,
                        credit: 0
                    };

                const period =
                    periodMap.get(
                        ledger.id
                    ) || {
                        debit: 0,
                        credit: 0
                    };

                const amounts = calculateTrialBalanceAmounts(
                    ledger,
                    prior,
                    period,
                    shouldUseLedgerOpening
                );

                return {
                    ledgerId:
                        ledger.id,

                    ledgerCode:
                        ledger.code,

                    account:
                        ledger.name,

                    parentGroup:
                        ledger.group.name,

                    groupCode:
                        ledger.group.code,

                    groupId:
                        ledger.groupId,

                    ledgerCategory:
                        ledger.category,

                    ledgerNature:
                        ledger.nature,

                    branchId:
                        ledger.branchId ||
                        branch?.id ||
                        null,

                    branchName:
                        ledger.branch?.name ||
                        branch?.name ||
                        null,

                    /**
                     * Trial balance columns show the closing balance.
                     * Period movement is retained for diagnostics.
                     */
                    debit:
                        amounts.closingDebit,

                    credit:
                        amounts.closingCredit,

                    periodDebit:
                        amounts.periodDebit,

                    periodCredit:
                        amounts.periodCredit,

                    openingDebit:
                        amounts.openingDebit,

                    openingCredit:
                        amounts.openingCredit,

                    /**
                     * Numeric closing balance
                     */
                    closingDebit:
                        amounts.closingDebit,

                    closingCredit:
                        amounts.closingCredit,

                    /**
                     * Signed value is useful internally.
                     */
                    closingSigned:
                        amounts.closingSigned
                };
            });

        const cashDiagnostics = await this.getCashDiagnostics(
            ledgers,
            branchEntryFilter,
            startDate,
            endDate,
            rawRows
        );

        // Keep cash ledgers separate. Netting multiple cash balances before
        // splitting Dr/Cr understates both sides and also detaches the
        // synthetic row from the LedgerGroup hierarchy.
        const consolidatedRows = rawRows;

        const groupById = new Map(ledgerGroups.map(group => [group.id, group]));
        const groupByCode = new Map(ledgerGroups.map(group => [group.code, group]));

        // The report hierarchy follows the LedgerGroup tree.  This is the
        // same expandable structure shown by Tally: accounting head -> group
        // -> ledger, rather than a flat list of ledger balances.
        const rowsWithHierarchy = consolidatedRows.map(row => {
            const group = row.groupId
                ? groupById.get(row.groupId)
                : groupByCode.get(String(row.groupCode || ""));
            const parentGroup = group?.parentId
                ? groupById.get(group.parentId)
                : undefined;

            return {
                ...row,
                groupId: group?.id || row.groupId || null,
                groupCode: group?.code || row.groupCode,
                parentGroup: group?.name || row.parentGroup,
                reportParentCode: parentGroup?.code || group?.code || row.groupCode,
                reportParentName: parentGroup?.name || group?.name || row.parentGroup,
                reportChildCode: group?.code || row.groupCode,
                reportChildName: group?.name || row.parentGroup
            };
        });

        /**
         * ============================================================
         * 9. REMOVE ZERO ACCOUNTS
         * ============================================================
         */

        const filteredRows =
            rowsWithHierarchy.filter(row => {

                if (query?.includeZero) {
                    return true;
                }

                return hasTrialBalanceActivity(row);
            });

        /**
         * ============================================================
         * 10. SR. NO.
         * ============================================================
         */

        const rows = filteredRows.map((row, index) => ({
            srNo: index + 1,
            rowType: "ledger" as const,
            level: 0,
            ...row,
            // Tally uses one closing column.  Keep the signed value and its
            // Dr/Cr marker so a UI does not have to infer accounting signs.
            closingBalance: Math.abs(row.closingSigned),
            closingBalanceType:
                row.closingSigned > 0
                    ? "Dr" as const
                    : row.closingSigned < 0
                        ? "Cr" as const
                        : null
        }));

        const visibleGroupIds = new Set<string>();
        for (const row of rows) {
            let group = row.groupId ? groupById.get(row.groupId) : undefined;
            while (group) {
                visibleGroupIds.add(group.id);
                group = group.parentId ? groupById.get(group.parentId) : undefined;
            }
        }

        const treeNodes = new Map<string, any>();
        for (const group of ledgerGroups) {
            if (!query?.includeZero && !visibleGroupIds.has(group.id)) continue;

            treeNodes.set(group.id, {
                id: `group:${group.id}`,
                groupId: group.id,
                code: group.code,
                name: group.name,
                rowType: "accountingHeader",
                parentId: group.parentId ? `group:${group.parentId}` : null,
                level: 0,
                periodDebit: 0,
                periodCredit: 0,
                closingDebit: 0,
                closingCredit: 0,
                closingSigned: 0,
                children: []
            });
        }

        for (const row of rows) {
            const groupNode = row.groupId ? treeNodes.get(row.groupId) : undefined;
            if (!groupNode) continue;
            groupNode.children.push({
                ...row,
                id: `ledger:${row.ledgerId || row.ledgerCode}`,
                parentId: groupNode.id,
                level: 0,
                hasChildren: false,
                children: []
            });
        }

        const rootNodes: any[] = [];
        for (const node of treeNodes.values()) {
            const parent = node.parentId ? treeNodes.get(node.parentId.replace("group:", "")) : undefined;
            if (parent) parent.children.push(node);
            else rootNodes.push(node);
        }

        const finalizeNode = (node: any, level: number) => {
            node.level = level;
            node.children.sort((a: any, b: any) => {
                if (a.rowType !== b.rowType) return a.rowType === "accountingHeader" ? -1 : 1;
                return String(a.name || a.account).localeCompare(String(b.name || b.account));
            });

            for (const child of node.children) {
                if (child.rowType === "accountingHeader") finalizeNode(child, level + 1);
                node.periodDebit += Number(child.periodDebit || 0);
                node.periodCredit += Number(child.periodCredit || 0);
                node.closingDebit += Number(child.closingDebit || 0);
                node.closingCredit += Number(child.closingCredit || 0);
                node.closingSigned += Number(child.closingSigned || 0);
            }

            node.periodDebit = Number(node.periodDebit.toFixed(2));
            node.periodCredit = Number(node.periodCredit.toFixed(2));
            node.closingDebit = Number(node.closingDebit.toFixed(2));
            node.closingCredit = Number(node.closingCredit.toFixed(2));
            node.closingSigned = Number(node.closingSigned.toFixed(2));
            node.closingBalance = Math.abs(node.closingSigned);
            node.closingBalanceType = node.closingSigned > 0 ? "Dr" : node.closingSigned < 0 ? "Cr" : null;
            node.hasChildren = node.children.length > 0;
        };

        rootNodes.sort((a, b) => a.name.localeCompare(b.name));
        rootNodes.forEach(node => finalizeNode(node, 0));
        const accountGroups = rootNodes;

        /**
         * ============================================================
         * 11. SUMMARY
         * ============================================================
         *
         * In a properly balanced double-entry system:
         *
         * Period Debit = Period Credit
         *
         * and
         *
         * Closing Debit = Closing Credit
         */

        const summary =
            rows.reduce(
                (total, row) => {

                    // Total Debit/Credit represent transaction turnover.
                    // Closing balances are reported separately below.
                    total.totalDebit +=
                        row.periodDebit;

                    total.totalCredit +=
                        row.periodCredit;

                    total.totalClosingDebit +=
                        row.closingDebit;

                    total.totalClosingCredit +=
                        row.closingCredit;

                    total.totalPeriodDebit +=
                        row.periodDebit;

                    total.totalPeriodCredit +=
                        row.periodCredit;

                    return total;
                },
                {
                    totalDebit: 0,
                    totalCredit: 0,
                    totalClosingDebit: 0,
                    totalClosingCredit: 0,
                    totalPeriodDebit: 0,
                    totalPeriodCredit: 0
                }
            );

        summary.totalDebit =
            Number(
                summary.totalDebit.toFixed(2)
            );

        summary.totalCredit =
            Number(
                summary.totalCredit.toFixed(2)
            );

        summary.totalPeriodDebit =
            Number(
                summary.totalPeriodDebit.toFixed(2)
            );

        summary.totalPeriodCredit =
            Number(
                summary.totalPeriodCredit.toFixed(2)
            );

        summary.totalClosingDebit =
            Number(summary.totalClosingDebit.toFixed(2));

        summary.totalClosingCredit =
            Number(summary.totalClosingCredit.toFixed(2));

        const periodDifference =
            Number(
                (
                    summary.totalPeriodDebit -
                    summary.totalPeriodCredit
                ).toFixed(2)
            );

        const closingDifference =
            Number(
                (
                    summary.totalClosingDebit -
                    summary.totalClosingCredit
                ).toFixed(2)
            );

        return {
            reportName:
                "Trial Balance",

            generatedAt:
                new Date(),

            branchId:
                branchId || null,

            branch,

            period: {
                startDate:
                    startDate,

                endDate,

                normalizedFromBeginning
            },

            // Render contract for the frontend.  `tree` can be displayed
            // directly, and every accountingHeader node can be expanded
            // without another report request.
            layout: {
                style: "tally-trial-balance",
                hierarchy: ["accountingHeader", "accountingHeader", "ledger"],
                columns: [
                    { key: "name", label: "Particulars", rowKey: "account" },
                    { key: "periodDebit", label: "Debit", section: "Transactions" },
                    { key: "periodCredit", label: "Credit", section: "Transactions" },
                    { key: "closingBalance", label: "Balance", section: "Closing", balanceTypeKey: "closingBalanceType" }
                ]
            },

            summary: {
                ...summary,

                periodDifference,

                closingDifference,

                isPeriodBalanced:
                    Math.abs(
                        periodDifference
                    ) < 0.01,

                isClosingBalanced:
                    Math.abs(
                        closingDifference
                    ) < 0.01,

                isBalanced:
                    Math.abs(
                        closingDifference
                    ) < 0.01
            },

            diagnostics: {
                period: {
                    startDate,
                    endDate,
                    normalizedFromBeginning
                },
                cash: cashDiagnostics
            },

            rows,
            // `tree` is the frontend-ready, click-to-expand representation.
            // `accountGroups` is retained as its backwards-compatible alias.
            tree: accountGroups,
            accountGroups
        };
    }

    static async getBranchDayBook(
        actor: any,
        branchId: string,
        query?: {
            startDate?: string;
            endDate?: string;
            bankAccountId?: string;
            page?: number;
            limit?: number;
        }
    ) {
        // 1. Validate branch access
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(
            actor.branchAccessType !== "ALL" &&
            actor.branchId !== branchId
        ) {
            throw new ApiError("You do not have access to this branch", 403);
        }

        const branch = await prisma.branch.findUnique({
            where: {
                id: branchId
            }
        });

        if(!branch) {
            throw new ApiError("Branch not found", 404);
        }

        let bankAccount = null;

        if (query?.bankAccountId) {
            bankAccount =
                await prisma.bankAccount.findFirst({
                    where: {
                        id: query.bankAccountId,
                        branchId
                    }
                });

            if (!bankAccount) {
                throw new ApiError(
                    "Bank Account not found for selected branch",
                    404
                );
            }
        }

        // 2. Validate date range
        const startDate = query?.startDate ? parseDate(query.startDate, "startDate") : undefined;
        const endDate = query?.endDate ? parseDate(query.endDate, "endDate") : new Date();

        if(startDate) {
            startDate.setHours(0, 0, 0, 0);
        }

        if(endDate) {
            endDate.setHours(23, 59, 59, 999);
        }

        const periodDateFilter = {
            ...(startDate
                ? {
                    gte: startDate
                }
                : {}),

            lte: endDate
        };

        const transactions =
            await prisma.transaction.findMany({
                where: {
                    branchId,
                    status: "APPROVED",
                    ...(query?.bankAccountId && {
                        bankAccountId: query.bankAccountId
                    }),

                    ...(startDate || endDate
                        ? {
                            OR: [
                                {
                                    sale: {
                                        invoiceDate: periodDateFilter
                                    }
                                },
                                {
                                    purchase: {
                                        invoiceDate: periodDateFilter
                                    }
                                },
                                {
                                    voucher: {
                                        some: {
                                            voucherDate: periodDateFilter
                                        }
                                    }
                                },
                                {
                                    createdAt: periodDateFilter
                                }
                            ]
                        }
                        : {})
                },
                include: {
                    agency: true,
                    thirdPartyAgency: true,
                    bankAccount: true,
                    createdBy: {
                        select: {
                            name: true
                        }
                    },

                    sale: true,

                    purchase: true,

                    voucher: true,

                    allocations: {
                        include: {
                            sale: true,
                            purchase: true
                        }
                    }
                },
            });

        const voucherWhere: Prisma.VoucherWhereInput = {
            branchId,
            voucherDate: periodDateFilter
        };

        const transactionSourceIds = new Set(
            transactions.map(transaction => transaction.id)
        );

        const voucherHeaders =
            await prisma.voucher.findMany({
                where: voucherWhere,
                orderBy: [
                    {
                        voucherDate: "asc"
                    },
                    {
                        voucherNo: "asc"
                    }
                ]
            });

        const filteredVoucherHeaders = query?.bankAccountId
            ? voucherHeaders.filter(voucher =>
                transactionSourceIds.has(voucher.sourceId)
            )
            : voucherHeaders;

        // Do not load all nested ledger entries through one relation query.
        // Large day-book ranges can exceed the database parameter limit.
        const voucherEntries: any[] = [];
        const voucherIds = filteredVoucherHeaders.map(voucher => voucher.id);
        const entryBatchSize = 250;

        for (let index = 0; index < voucherIds.length; index += entryBatchSize) {
            const batchIds = voucherIds.slice(index, index + entryBatchSize);
            const batchEntries = await prisma.ledgerEntry.findMany({
                where: {
                    voucherId: {
                        in: batchIds
                    }
                },
                include: {
                    ledger: {
                        include: {
                            group: true
                        }
                    }
                },
                orderBy: {
                    createdAt: "asc"
                }
            });

            voucherEntries.push(...batchEntries);
        }

        const entriesByVoucher = new Map<string, any[]>();
        for (const entry of voucherEntries) {
            const entries = entriesByVoucher.get(entry.voucherId) || [];
            entries.push(entry);
            entriesByVoucher.set(entry.voucherId, entries);
        }

        const vouchers = filteredVoucherHeaders.map(voucher => ({
            ...voucher,
            entries: entriesByVoucher.get(voucher.id) || []
        }));

        const sourceIds =
            Array.from(
                new Set(
                    vouchers
                        .map(voucher => voucher.sourceId)
                        .filter(Boolean)
                )
            );

        const sourceTransactions: any[] = [];
        const sourceJournals: any[] = [];

        for (let index = 0; index < sourceIds.length; index += entryBatchSize) {
            const sourceIdBatch = sourceIds.slice(index, index + entryBatchSize);
            const [transactionBatch, journalBatch] = await Promise.all([
                prisma.transaction.findMany({
                    where: {
                        id: {
                            in: sourceIdBatch
                        }
                    },
                    include: {
                        agency: true,
                        thirdPartyAgency: true,
                        bankAccount: true,
                        sale: true,
                        purchase: true,
                        createdBy: {
                            select: {
                                name: true
                            }
                        }
                    }
                }),
                prisma.journal.findMany({
                    where: {
                        id: {
                            in: sourceIdBatch
                        }
                    },
                    include: {
                        journalHead: true,
                        createdBy: {
                            select: {
                                name: true
                            }
                        }
                    }
                })
            ]);

            sourceTransactions.push(...transactionBatch);
            sourceJournals.push(...journalBatch);
        }

        const transactionSourceMap =
            new Map(
                sourceTransactions.map(txn => [
                    txn.id,
                    txn
                ])
            );

        const journalSourceMap =
            new Map(
                sourceJournals.map(journal => [
                    journal.id,
                    journal
                ])
            );

        const formatVoucherType = (value: string) =>
            String(value || "")
                .replace(/_/g, " ")
                .toLowerCase()
                .replace(/\b\w/g, char => char.toUpperCase());

        const getVoucherParty = (
            voucher: typeof vouchers[number],
            sourceTxn?: typeof sourceTransactions[number],
            sourceJournal?: typeof sourceJournals[number]
        ) =>
            sourceTxn?.agency?.name ||
            sourceTxn?.thirdPartyAgency?.name ||
            sourceJournal?.journalHead?.name ||
            voucher.entries.find(entry =>
                ![
                    "BANK",
                    "CASH",
                    "GST",
                    "ROUND_OFF"
                ].includes(String(entry.ledger.category))
            )?.ledger.name ||
            voucher.entries[0]?.ledger.name ||
            "";

        const getVoucherReference = (
            sourceTxn?: typeof sourceTransactions[number],
            sourceJournal?: typeof sourceJournals[number]
        ) =>
            sourceTxn?.transactionRefNo ||
            sourceTxn?.referenceNo ||
            sourceTxn?.sale?.invoiceNo ||
            sourceTxn?.purchase?.invoiceNo ||
            sourceJournal?.importKey ||
            "";

        const getPaymentMode = (
            sourceTxn?: typeof sourceTransactions[number],
            sourceJournal?: typeof sourceJournals[number]
        ) =>
            sourceTxn?.paymentThrough ||
            sourceTxn?.paymentMode ||
            sourceTxn?.paymentType ||
            sourceJournal?.paymentThrough ||
            sourceJournal?.paymentMode ||
            "";

        const getSummaryAmounts = (
            voucher: typeof vouchers[number],
            sourceTxn?: typeof sourceTransactions[number]
        ) => {
            const amount =
                Number(sourceTxn?.amount || 0) ||
                Math.max(
                    Number(voucher.totalDebit || 0),
                    Number(voucher.totalCredit || 0)
                );

            switch (String(voucher.voucherType)) {

                case "PURCHASE":
                case "RCM_PURCHASE":
                case "RECEIPT":
                case "CREDIT_NOTE":
                case "OPENING_BALANCE":
                    return {
                        debit: amount,
                        credit: 0
                    };

                case "SALE":
                case "PAYMENT":
                case "DEBIT_NOTE":
                    return {
                        debit: 0,
                        credit: amount
                    };

                default:
                    return {
                        debit: Number(voucher.totalDebit || 0),
                        credit: Number(voucher.totalCredit || 0)
                    };
            }
        };

        const voucherSummaryRows =
            vouchers.map((voucher, index) => {
                const sourceTxn =
                    transactionSourceMap.get(voucher.sourceId);

                const sourceJournal =
                    journalSourceMap.get(voucher.sourceId);

                const amounts =
                    getSummaryAmounts(
                        voucher,
                        sourceTxn
                    );

                return {
                    serialNo:
                        index + 1,

                    date:
                        voucher.voucherDate,

                    voucherNo:
                        voucher.voucherNo,

                    voucherType:
                        formatVoucherType(
                            String(voucher.voucherType)
                        ),

                    partyLedger:
                        getVoucherParty(
                            voucher,
                            sourceTxn,
                            sourceJournal
                        ),

                    referenceNo:
                        getVoucherReference(
                            sourceTxn,
                            sourceJournal
                        ),

                    narration:
                        voucher.narration ||
                        sourceTxn?.remarks ||
                        sourceJournal?.remarks ||
                        voucher.entries[0]?.narration ||
                        "",

                    debit:
                        amounts.debit,

                    credit:
                        amounts.credit,

                    paymentMode:
                        getPaymentMode(
                            sourceTxn,
                            sourceJournal
                        ),

                    createdBy:
                        sourceTxn?.createdBy?.name ||
                        sourceJournal?.createdBy?.name ||
                        "System",

                    status:
                        "Posted",

                    branch:
                        branch.name
                };
            });

        const doubleEntryRows =
            vouchers.flatMap(voucher => {
                const sourceTxn =
                    transactionSourceMap.get(voucher.sourceId);

                const sourceJournal =
                    journalSourceMap.get(voucher.sourceId);

                return voucher.entries.map(entry => ({
                    date:
                        voucher.voucherDate,

                    voucherNo:
                        voucher.voucherNo,

                    voucherType:
                        formatVoucherType(
                            String(voucher.voucherType)
                        ),

                    ledgerCode:
                        entry.ledger.code,

                    ledgerAccount:
                        entry.ledger.name,

                    ledgerGroup:
                        entry.ledger.group?.name ||
                        String(entry.ledger.category || ""),

                    particulars:
                        getVoucherParty(
                            voucher,
                            sourceTxn,
                            sourceJournal
                        ),

                    narration:
                        entry.narration ||
                        voucher.narration ||
                        sourceTxn?.remarks ||
                        sourceJournal?.remarks ||
                        "",

                    debit:
                        entry.entryType === EntryType.DEBIT
                            ? Number(entry.amount)
                            : 0,

                    credit:
                        entry.entryType === EntryType.CREDIT
                            ? Number(entry.amount)
                            : 0,

                    status:
                        "Posted",

                    createdBy:
                        sourceTxn?.createdBy?.name ||
                        sourceJournal?.createdBy?.name ||
                        "System"
                }));
            });

        const getTransactionDate = (txn: typeof transactions[number]) =>
            txn.sale?.invoiceDate ??
            txn.purchase?.invoiceDate ??
            txn.sale?.createdAt ??
            txn.purchase?.createdAt ??
            txn.createdAt;

        transactions.sort(
            (a, b) =>
                getTransactionDate(a).getTime() -
                getTransactionDate(b).getTime()
        );

        let runningBalance = 0;

        const entries =
            transactions.map((txn, index) => {

                const credit =
                    txn.direction === TransactionDirection.INWARD
                        ? Number(txn.amount)
                        : 0;

                const debit =
                    txn.direction === TransactionDirection.OUTWARD
                        ? Number(txn.amount)
                        : 0;

                runningBalance =
                    runningBalance + credit - debit;

                    // console.log("transaction ", txn);

                    const transactionDate = getTransactionDate(txn);

                    const voucher = txn.voucher[0];

                    const voucherNo =
                        voucher?.voucherNo ??
                        txn.sale?.invoiceNo ??
                        txn.purchase?.invoiceNo ??
                        txn.transactionNo;

                    const voucherType =
                        voucher?.voucherType ??
                        txn.sale?.voucherType ??
                        txn.purchase?.voucherType ??
                        "";

                return {

                    serialNo: index + 1,

                    voucherId: txn.transactionNo,

                    transactionId: txn.id,

                    transactionDate,

                    primaryAgencyName:
                        txn.agency?.name || null,

                    secondaryAgencyName:
                        txn.thirdPartyAgency?.name || null,

                    paymentMode:
                        txn.paymentMode,

                    paymentType:
                        txn.paymentType,

                    transactionRef:
                        txn.transactionRefNo ||
                        txn.referenceNo ||
                        null,

                    inRoutedVia:
                        !!txn.thirdPartyAgencyId,

                    debit,

                    credit,

                    runningBalance,

                    remarks:
                        txn.remarks,

                    bankAccount: txn.bankAccount
                        ? {
                            id: txn.bankAccount.id,
                            bankName: txn.bankAccount.bankName,
                            accountNumber: txn.bankAccount.accountNumber,
                            ifscCode: txn.bankAccount.ifscCode
                        }
                        : null,

                    allocations:
                        txn.allocations.map(a => ({
                            sourceType: a.sourceType,

                            invoiceNo:
                                a.sale?.invoiceNo ||
                                a.purchase?.invoiceNo,

                            allocatedAmount:
                                Number(a.allocatedAmount)
                        })),
                        particulars:
                            txn.agency?.name ?? "",

                        voucherType,

                        voucherNo,

                        debitAmount:
                            debit,

                        creditAmount:
                            credit,

                        date: transactionDate
                };
            })

        const totalReceipts =
            entries.reduce(
                (sum, row) =>
                    sum + row.credit,
                0
            );

        const totalPayments =
            entries.reduce(
                (sum, row) =>
                    sum + row.debit,
                0
            );

        // Summary must reflect the full unfiltered set so totals stay
        // stable across pages. runningBalance above was already computed
        // against every transaction in date order.
        const totalEntries = entries.length;

        // Page slice — applied AFTER runningBalance so each row keeps
        // its true running balance, not a per-page reset.
        const page = Number(query?.page || 1);
        const limit = Number(query?.limit || 25);
        const safePage = page < 1 ? 1 : page;
        const safeLimit = limit < 1 ? 25 : limit;
        const start = (safePage - 1) * safeLimit;
        const paginatedEntries = entries.slice(start, start + safeLimit);

        return {
            branch,
            dateRange: {
                startDate, endDate
            },
            summary: {
                totalTransactions: totalEntries,
                totalReceipts: totalReceipts,
                totalPayments: totalPayments,
                netCashFlow: totalReceipts - totalPayments
            },
            pagination: {
                page: safePage,
                limit: safeLimit,
                totalEntries,
                totalPages: Math.max(
                    1,
                    Math.ceil(totalEntries / safeLimit)
                )
            },
            entries: paginatedEntries,

            voucherSummaryRows,

            doubleEntryRows
        };
    }


    static async getGSTR1Report(
        actor: any,
        query?: {
            branchId?: string;
            startDate?: string;
            endDate?: string;
        }
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const startDate = query?.startDate ? parseDate(query.startDate, "startDate") : undefined;
        const endDate = query?.endDate ? parseDate(query.endDate, "endDate") : new Date();

        if(startDate) {
            startDate.setHours(0, 0, 0, 0);
        }

        if(endDate) {
            endDate.setHours(23, 59, 59, 999);
        }

        const branchId = actor.branchAccessType === "ALL" ? query?.branchId : actor.branchId;

        const sales = await prisma.sale.findMany({
            where: {
                status: SalesStatus.APPROVED,
                ...(branchId ? { branchId } : {}),
                ...(startDate || endDate
                    ? {
                         invoiceDate: {
                            ...(startDate && {
                                gte: startDate
                            }),

                            ...(endDate && {
                                lte: endDate
                            })
                        }
                    } 
                    : {})
            },
            include: {
                agency: true,
                branch: true,
                items: true
            },
            orderBy: {
                invoiceDate: "asc"
            }
        });

        const money = (value: number) =>
            Math.round(Number(value || 0) * 100) / 100;

        const rows =
            sales.map((sale) => {

                const customerGSTIN =
                    sale.agency?.gstin || null;

                // Imported TAX INVOICE vouchers are persisted as approved Sale
                // records. Every such sale belongs to the requested B2B
                // voucher section; GSTIN is displayed when available but is
                // not used to exclude an agency from the section.
                const classification = "B2B";

                const branchStateCode =
                    sale.branch.stateCode;

                const posStateCode =
                    sale.agency?.stateCode;

                const isIntraState =
                    branchStateCode === posStateCode;

                const itemTotals = sale.items.reduce(
                    (totals: { taxable: number; cgst: number; sgst: number; igst: number; gst: number; total: number }, item: any) => ({
                        taxable: totals.taxable + Number(item.taxableAmount || 0),
                        cgst: totals.cgst + Number(item.cgstAmount || 0),
                        sgst: totals.sgst + Number(item.sgstAmount || 0),
                        igst: totals.igst + Number(item.igstAmount || 0),
                        gst: totals.gst + Number(item.gstAmount || 0),
                        total: totals.total + Number(item.totalAmount || 0)
                    }),
                    { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, total: 0 }
                );

                // TAX INVOICE imports are persisted as Sale/SalesItem records.
                // Use line values because older imported headers may contain zero GST totals.
                const hasItemAmounts = sale.items.length > 0 && (
                    itemTotals.taxable !== 0 ||
                    itemTotals.cgst !== 0 ||
                    itemTotals.sgst !== 0 ||
                    itemTotals.igst !== 0
                );
                const taxableValue = hasItemAmounts ? itemTotals.taxable : Number(sale.subTotalAmount || 0);
                const cgst = hasItemAmounts ? itemTotals.cgst : Number(sale.totalCGSTAmount || 0);
                const sgst = hasItemAmounts ? itemTotals.sgst : Number(sale.totalSGSTAmount || 0);
                const igst = hasItemAmounts ? itemTotals.igst : Number(sale.totalIGSTAmount || 0);
                const gst = hasItemAmounts ? itemTotals.gst : Number(sale.totalGSTAmount || 0);

                return {
                    branchName: sale.branch.name,

                    branchGst: sale.branch.gstin,

                    agency_id: sale.agencyId,

                    classification,

                    customer_gstin:
                        customerGSTIN,

                    invoice_number:
                        sale.invoiceNo,

                    invoice_date:
                        sale.invoiceDate,

                    place_of_supply_pos:
                        sale.agency?.state
                            || sale.agency?.stateCode,

                    taxable_value: money(taxableValue),

                    cgst_rate_amount:
                        isIntraState
                            ? money(cgst)
                            : 0,

                    sgst_rate_amount:
                        isIntraState
                            ? money(sgst)
                            : 0,

                    igst_rate_amount:
                        !isIntraState
                            ? money(igst)
                            : 0,

                    branch_state_code:
                        branchStateCode,

                    customer_state_code:
                        posStateCode,

                    gst_amount: money(gst),

                    invoice_total: money(Number(sale.grandTotal || 0) || itemTotals.total)
                };
            });

        const b2bSummaryMap = new Map<string, any>();
        // The Tally B2B section is based on imported TAX INVOICE vouchers.
        // Do not use GSTIN presence as the grouping filter: imported agencies
        // without master GSTIN/state data must still appear in the report.
        for (const row of rows) {
            const key = row.agency_id || row.customer_gstin || row.customer_state_code || row.invoice_number;
            const current = b2bSummaryMap.get(key) || {
                agency_id: row.agency_id,
                customer_gstin: row.customer_gstin,
                agency_name: sales.find(sale => sale.invoiceNo === row.invoice_number)?.agency?.name || "",
                voucher_count: 0,
                taxable_value: 0,
                igst_rate_amount: 0,
                cgst_rate_amount: 0,
                sgst_rate_amount: 0,
                cess_amount: 0,
                gst_amount: 0,
                invoice_total: 0
            };
            current.voucher_count += 1;
            current.taxable_value += row.taxable_value;
            current.igst_rate_amount += row.igst_rate_amount;
            current.cgst_rate_amount += row.cgst_rate_amount;
            current.sgst_rate_amount += row.sgst_rate_amount;
            current.gst_amount += row.gst_amount;
            current.invoice_total += row.invoice_total;
            b2bSummaryMap.set(key, current);
        }

        const b2bSummary = [...b2bSummaryMap.values()].map(row => ({
            ...row,
            taxable_value: money(row.taxable_value),
            igst_rate_amount: money(row.igst_rate_amount),
            cgst_rate_amount: money(row.cgst_rate_amount),
            sgst_rate_amount: money(row.sgst_rate_amount),
            cess_amount: money(row.cess_amount),
            gst_amount: money(row.gst_amount),
            invoice_total: money(row.invoice_total)
        }));

        const noteVoucherTypes = [
            "OUTWARD DEBIT NOTE",
            "OUTWARD CREDIT NOTE",
            "INWARD DEBIT NOTE",
            "INWARD CREDIT NOTE"
        ];
        const noteJournals = await prisma.journal.findMany({
            where: {
                status: JournalStatus.APPROVED,
                ...(branchId ? { branchId } : {}),
                ...(startDate || endDate ? {
                    journalDate: {
                        ...(startDate ? { gte: startDate } : {}),
                        ...(endDate ? { lte: endDate } : {})
                    }
                } : {}),
                OR: noteVoucherTypes.map(type => ({
                    importKey: { startsWith: `${type}_` }
                }))
            },
            include: {
                journalHead: {
                    include: {
                        ledger: {
                            include: { agency: true }
                        }
                    }
                }
            },
            orderBy: { journalDate: "asc" }
        });

        const noteSummaryMap = new Map<string, any>();
        for (const journal of noteJournals) {
            const agency = journal.journalHead.ledger.agency;
            const key = agency?.id || journal.journalHead.ledgerId;
            const current = noteSummaryMap.get(key) || {
                customer_gstin: agency?.gstin || null,
                agency_name: agency?.name || journal.journalHead.name,
                voucher_count: 0,
                taxable_value: 0,
                igst_rate_amount: 0,
                cgst_rate_amount: 0,
                sgst_rate_amount: 0,
                cess_amount: 0,
                gst_amount: 0,
                invoice_total: 0
            };
            const amount = money(Number(journal.amount || 0));
            current.voucher_count += 1;
            // Imported note journals expose the note amount, not a tax split.
            // Keep the amount in invoice/tax totals and leave the unavailable split as zero.
            current.gst_amount += amount;
            current.invoice_total += amount;
            noteSummaryMap.set(key, current);
        }
        const creditDebitNoteSummary = [...noteSummaryMap.values()].map(row => ({
            ...row,
            taxable_value: money(row.taxable_value),
            igst_rate_amount: money(row.igst_rate_amount),
            cgst_rate_amount: money(row.cgst_rate_amount),
            sgst_rate_amount: money(row.sgst_rate_amount),
            cess_amount: money(row.cess_amount),
            gst_amount: money(row.gst_amount),
            invoice_total: money(row.invoice_total)
        }));

        const summary = {

            totalInvoices:
                rows.length,

            b2bInvoices:
                rows.filter(
                    x => x.classification === "B2B"
                ).length,

            b2cInvoices:
                rows.filter(
                    x => x.classification === "B2C"
                ).length,

            totalTaxableValue:
                rows.reduce(
                    (sum, x) =>
                        sum + x.taxable_value,
                    0
                ),

            totalCGST:
                rows.reduce(
                    (sum, x) =>
                        sum + x.cgst_rate_amount,
                    0
                ),

            totalSGST:
                rows.reduce(
                    (sum, x) =>
                        sum + x.sgst_rate_amount,
                    0
                ),

            totalIGST:
                rows.reduce(
                    (sum, x) =>
                        sum + x.igst_rate_amount,
                    0
                ),

            totalGST:
                rows.reduce(
                    (sum, x) =>
                        sum +
                        x.cgst_rate_amount +
                        x.sgst_rate_amount +
                        x.igst_rate_amount,
                    0
                ),

            totalInvoiceValue:
                rows.reduce(
                    (sum, x) =>
                        sum + x.invoice_total,
                    0
                )
        };

        return {

            reportName:
                "GSTR-1 Outward Supplies Report",

            generatedAt:
                new Date(),

            period: {
                startDate,
                endDate
            },

            branchId,

            summary,

            b2bSummary,

            creditDebitNoteSummary,

            rows
        };
    } 

    static async getGSTSuspenseAccountLog(
        actor: any,
        query?: {
            branchId?: string;
            startDate?: string;
            endDate?: string;
        }
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const startDate = query?.startDate ? parseDate(query.startDate, "startDate") : undefined;
        const endDate = query?.endDate ? parseDate(query.endDate, "endDate") : new Date();

        if(startDate) {
            startDate.setHours(0, 0, 0, 0);
        }

        if(endDate) {
            endDate.setHours(23, 59, 59, 999);
        }

        const branchId = actor.branchAccessType === "ALL" ? query?.branchId : actor.branchId;

        const transactions = await prisma.transaction.findMany({
            where: {
                suspenseAccount: true,
                ...(branchId ? { branchId } : {}),
                ...(startDate || endDate
                    ? {
                        createdAt: {
                            ...(startDate && {
                                gte: startDate
                            }),
                            ...(endDate && {
                                lte: endDate
                            })
                        }
                    }
                    : {})
            },
            include: {
                agency: true,
                branch: true,
            },
            orderBy: {
                createdAt: "asc"
            }
        });

        const rows =
        transactions.map(tx => ({

            suspense_id:
                tx.transactionNo,

            bank_clearance_date:
                tx.createdAt,

            amount_received:
                Number(tx.amount),

            payment_channel:
                tx.paymentThrough ||
                tx.paymentMode,

            reported_remarks:
                tx.remarks ||

                "Source identity not verified",

            auth_status:
                tx.agencyId
                    ? "AUTHENTICATED"
                    : "PENDING_AUTHENTICATION",

            agency_id:
                tx.agencyId,

            agency_name:
                tx.agency?.name || null,

            branch: {
                id: tx.branch.id,
                code: tx.branch.code,
                name: tx.branch.name
            }
        }));

        return {

            reportName:
                "GST Suspense Account Clearing Log",

            generatedAt:
                new Date(),

            summary: {

                totalSuspenseEntries:
                    rows.length,

                pendingAuthentication:
                    rows.filter(
                        x =>
                            x.auth_status ===
                            "PENDING_AUTHENTICATION"
                    ).length,

                authenticated:
                    rows.filter(
                        x =>
                            x.auth_status ===
                            "AUTHENTICATED"
                    ).length,

                totalAmount:
                    rows.reduce(
                        (sum, x) =>
                            sum + x.amount_received,
                        0
                    )
            },

            rows
        };
    }

    static async getStockInventoryReport(
        actor: any,
        query?: {
            branchId?: string;
            productId?: string;
            startDate?: string;
            endDate?: string;
        }
    ) {

        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const branchId =
            actor.branchAccessType === "ALL"
                ? query?.branchId
                : actor.branchId;

        const startDate =
            query?.startDate
                ? parseDate(query.startDate, "startDate")
                : undefined;

        const endDate =
            query?.endDate
                ? parseDate(query.endDate, "endDate")
                : undefined;

        if (startDate) {
            startDate.setHours(0, 0, 0, 0);
        }

        if (endDate) {
            endDate.setHours(23, 59, 59, 999);
        }

        const batches =
            await prisma.inventoryBatch.findMany({

                where: {

                    ...(branchId && {
                        branchId
                    }),

                    ...(query?.productId && {
                        productId: query.productId
                    }),

                    ...(startDate || endDate
                        ? {
                            createdAt: {
                                ...(startDate && {
                                    gte: startDate
                                }),

                                ...(endDate && {
                                    lte: endDate
                                })
                            }
                        }
                        : {})
                },

                include: {
                    product: true,
                    branch: true
                },

                orderBy: [
                    {
                        product: {
                            name: "asc"
                        }
                    },
                    {
                        batchNo: "asc"
                    }
                ]
            });

        const rows =
            batches.map(batch => ({

                productCode:
                    batch.product.sku,

                productName:
                    batch.product.name,

                batchId:
                    batch.batchNo,

                branch: {
                    id: batch.branch.id,
                    code: batch.branch.code,
                    name: batch.branch.name,
                    gstn: batch.branch.gstin
                },

                stockKG:
                    Number(
                        batch.availableQtyKG
                    ),

                stockLTR:
                    Number(
                        batch.availableQtyLTR
                    ),

                createdAt:
                    batch.createdAt,

                updatedAt:
                    batch.lastUpdated
            }));

        return {

            reportName:
                "Stock Inventory Report",

            generatedAt:
                new Date(),

            summary: {

                totalProducts:
                    new Set(
                        rows.map(
                            x => x.productCode
                        )
                    ).size,

                totalBatches:
                    rows.length,

                totalStockKG:
                    rows.reduce(
                        (sum, x) =>
                            sum + x.stockKG,
                        0
                    ),

                totalStockLTR:
                    rows.reduce(
                        (sum, x) =>
                            sum + x.stockLTR,
                        0
                    )
            },

            rows
        };
    }

    static async getOutstandingReport(
        actor: any,
        query?: {
            branchId?: string;
            agencyId?: string;
            type?: "RECEIVABLE" | "PAYABLE";
            export?: boolean;
        }
    ) {

        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const branchId =
            actor.branchAccessType === "ALL"
                ? query?.branchId
                : actor.branchId;

                let agency = null;

        if (query?.agencyId) {
            agency =
                await prisma.agency.findUnique({
                    where: {
                        id: query.agencyId
                    },
                    select: {
                        id: true,
                        name: true
                    }
                });

            if (!agency) {
                throw new ApiError(
                    "Agency not found",
                    404
                );
            }
        }

        const today = new Date();
        const detailRows: any[] = [];
        const resolveAgingBucket = (ageDays: number) => {
            if (ageDays <= 60) return "0-60 Days";
            if (ageDays <= 120) return "61-120 Days";
            if (ageDays <= 180) return "121-180 Days";
            return "180+ Days";
        };

        const agencyMap = new Map<
            string,
            {
                agencyId: string;
                agencyName: string;

                vendorCode: string;
                gstin: string | null;
                branchName: string | null;
                balanceType?: "RECEIVABLE" | "PAYABLE";
                createdAt?: Date | null;
                agingDays?: number;

                totalOutstanding: number;

                bucket_0_60_days: {
                    amount: number;
                    invoices: any[];
                };
                bucket_61_120_days: {
                    amount: number;
                    invoices: any[];
                };
                bucket_121_180_days: {
                    amount: number;
                    invoices: any[];
                };
                bucket_180_plus_days: {
                    amount: number;
                    invoices: any[];
                };
            }
        >();

        if(query.type === "RECEIVABLE") {
            const sales = await prisma.sale.findMany({
                where: {
                    status: SalesStatus.APPROVED,

                    ...(branchId && {
                        branchId
                    }),

                    ...(query.agencyId && {
                        agencyId: query.agencyId
                    })
                },
                include: {
                    agency: true,
                    branch: true,
                    allocations: true,
                    debitCreditNotes: {
                        where: {
                            status: DebitCreditNoteStatus.APPROVED
                        }
                    }
                },
                orderBy: {
                    invoiceDate: "asc"
                }
            });

            for(const sale of sales) {
                const allocated =
                    sale.allocations.reduce(
                        (sum, a) =>
                            sum + Number(a.allocatedAmount),
                        0
                    );

                const adjustedTotal = this.adjustedSaleTotal(sale);
                const outstanding = adjustedTotal - allocated;

                if(outstanding <= 0) continue;

                const ageDays = 
                    Math.floor(
                        (
                            today.getTime() -
                            sale.invoiceDate.getTime()
                        ) / 86400000
                    );
                detailRows.push({

                    vendorCode:
                        sale.agency.id, // change to agency.code later if added

                    vendorName:
                        sale.agency.name,

                    billNo:
                        sale.invoiceNo,

                    billDate:
                        sale.invoiceDate,

                    dueDate:
                        sale.invoiceDate, // replace when dueDate exists

                    billAmount:
                        Number(sale.subTotalAmount),

                    gstAmount:
                        Number(sale.totalGSTAmount),

                    tds: 0,

                    paidAmount:
                        allocated,

                    balanceAmount:
                        outstanding,

                    agingDays:
                        ageDays,

                    agingBucket:
                        resolveAgingBucket(ageDays),

                    branch:
                        sale.branchId,

                    remarks:
                        sale.remarks ?? ""
                });

                const invoice = {

                    invoiceId:
                        sale.id,

                    invoiceType:
                        "SALE",

                    invoiceNo:
                        sale.invoiceNo,

                    invoiceDate:
                        sale.invoiceDate,

                    invoiceAgeDays:
                        ageDays,

                    grandTotal:
                        adjustedTotal,

                    originalGrandTotal:
                        Number(sale.grandTotal),

                    allocatedAmount:
                        allocated,

                    outstandingAmount:
                        outstanding,

                    settlementStatus:
                        allocated === 0
                            ? "UNPAID"
                            : outstanding === 0
                                ? "FULLY_SETTLED"
                                : "PARTIALLY_SETTLED",

                    invoice:
                        sale

                };

                if(!agencyMap.has(sale.agencyId)) {
                    agencyMap.set(sale.agencyId, {
                        agencyId: sale.agencyId,
                        agencyName: sale.agency?.name || null,
                        vendorCode: "",
                        gstin: sale.agency?.gstin || null,
                        branchName: sale.branch?.name || null,
                        createdAt: sale.invoiceDate,
                        totalOutstanding: 0,
                        bucket_0_60_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_61_120_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_121_180_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_180_plus_days: {
                            amount: 0,
                            invoices: []
                        }
                    })
                }

                const agency = agencyMap.get(sale.agencyId)!;

                if (!agency.createdAt || sale.invoiceDate < agency.createdAt) {
                    agency.createdAt = sale.invoiceDate;
                }

                if (agency.branchName && agency.branchName !== sale.branch?.name) {
                    agency.branchName = "Multiple";
                }

                agency.totalOutstanding += outstanding;

                let bucket;

                if(ageDays <= 60){

                    bucket =
                        agency.bucket_0_60_days;

                }
                else if(ageDays <= 120){

                    bucket =
                        agency.bucket_61_120_days;

                }
                else if(ageDays <= 180){

                    bucket =
                        agency.bucket_121_180_days;

                }
                else{

                    bucket =
                        agency.bucket_180_plus_days;

                }

                bucket.amount += outstanding;

                bucket.invoices.push(invoice);
            }
        } else {
            const purchases = await prisma.purchase.findMany({
                where: {
                    status: PurchaseStatus.APPROVED,

                    ...(branchId && {
                        branchId
                    }),

                    ...(query.agencyId && {
                        agencyId: query.agencyId
                    })
                },
                include: {
                    agency: true,
                    branch: true,
                    allocations: true
                },
                orderBy: {
                    createdAt: "asc"
                }
            });

            for(const purchase of purchases) {
                const allocated =
                    purchase.allocations.reduce(
                        (sum, a) =>
                            sum + Number(a.allocatedAmount),
                        0
                    );

                const outstanding =
                    Number(purchase.grandTotal) - allocated;

                if(outstanding <= 0) continue;
                

                const ageDays =
                    Math.floor(
                        (
                            today.getTime() -
                            purchase.createdAt.getTime()
                        ) / 86400000
                    );

                detailRows.push({

                    vendorCode:
                        purchase.agency.id, // or agency.code later if you add one

                    vendorName:
                        purchase.agency.name,

                    billNo:
                        purchase.invoiceNo,

                    billDate:
                        purchase.createdAt,

                    dueDate:
                        purchase.createdAt, // replace with purchase.dueDate once added

                    billAmount:
                        Number(purchase.subtotalAmount),

                    gstAmount:
                        Number(purchase.totalGSTAmount),

                    tds: 0,

                    paidAmount:
                        allocated,

                    balanceAmount:
                        outstanding,

                    agingDays:
                        ageDays,

                    agingBucket:
                        resolveAgingBucket(ageDays),

                    branch:
                        purchase.branchId,

                    remarks:
                        purchase.remarks ?? ""
                });    

                const invoice = {
                    invoiceId:
                        purchase.id,

                    invoiceType:
                        "PURCHASE",

                    invoiceNo:
                        purchase.invoiceNo,

                    invoiceDate:
                        purchase.createdAt,

                    invoiceAgeDays:
                        ageDays,

                    grandTotal:
                        Number(purchase.grandTotal),

                    allocatedAmount:
                        allocated,

                    outstandingAmount:
                        outstanding,

                    settlementStatus:
                        allocated === 0
                            ? "UNPAID"
                            : outstanding === 0
                                ? "FULLY_SETTLED"
                                : "PARTIALLY_SETTLED",

                    invoice:
                        purchase
                };

                if(!agencyMap.has(purchase.agencyId)) {
                    agencyMap.set(purchase.agencyId, {
                        agencyId: purchase.agencyId,
                        agencyName: purchase.agency?.name || null,
                        vendorCode: "",
                        gstin: purchase.agency?.gstin || null,
                        branchName: purchase.branch?.name || null,
                        createdAt: purchase.createdAt,
                        totalOutstanding: 0,
                        bucket_0_60_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_61_120_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_121_180_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_180_plus_days: {
                            amount: 0,
                            invoices: []
                        }
                    })
                }

                const agency = agencyMap.get(purchase.agencyId)!;

                if (!agency.createdAt || purchase.createdAt < agency.createdAt) {
                    agency.createdAt = purchase.createdAt;
                }

                if (agency.branchName && agency.branchName !== purchase.branch?.name) {
                    agency.branchName = "Multiple";
                }

                agency.totalOutstanding += outstanding;

                let bucket;

                if (ageDays <= 60) {

                    bucket =
                        agency.bucket_0_60_days;

                }
                else if (ageDays <= 120) {

                    bucket =
                        agency.bucket_61_120_days;

                }
                else if (ageDays <= 180) {

                    bucket =
                        agency.bucket_121_180_days;

                }
                else {

                    bucket =
                        agency.bucket_180_plus_days;

                }

                bucket.amount +=
                    outstanding;

                bucket.invoices.push(
                    invoice
                );

            }
        }

        /**
         * AR is invoice-based above, but imported opening balances and other
         * customer-ledger postings do not have a Sale row. Include the
         * positive customer-ledger remainder so AR agrees with the agency
         * ledger report. Existing invoice outstanding is not added twice.
         */
        if (query.type === "RECEIVABLE") {
            const customerLedgers = await prisma.ledger.findMany({
                where: {
                    category: LedgerType.CUSTOMER,
                    ...(branchId ? { branchId } : {}),
                    ...(query.agencyId ? { agencyId: query.agencyId } : {})
                },
                include: {
                    agency: true,
                    branch: true
                }
            });

            for (const ledger of customerLedgers) {
                const balance = await LedgerService.calculateLedgerBalance(ledger.id);
                const ledgerReceivable = Math.max(Number(balance.closingBalance), 0);
                const invoiceOutstanding = agencyMap.get(ledger.agencyId)?.totalOutstanding || 0;
                const remainder = Number((ledgerReceivable - invoiceOutstanding).toFixed(2));

                if (remainder <= 0) continue;

                let agency = agencyMap.get(ledger.agencyId);
                if (!agency) {
                    agency = {
                        agencyId: ledger.agencyId,
                        agencyName: ledger.agency?.name || ledger.name,
                        vendorCode: "",
                        gstin: ledger.agency?.gstin || null,
                        branchName: ledger.branch?.name || null,
                        createdAt: ledger.createdAt,
                        totalOutstanding: 0,
                        bucket_0_60_days: { amount: 0, invoices: [] },
                        bucket_61_120_days: { amount: 0, invoices: [] },
                        bucket_121_180_days: { amount: 0, invoices: [] },
                        bucket_180_plus_days: { amount: 0, invoices: [] }
                    };
                    agencyMap.set(ledger.agencyId, agency);
                }

                const invoice = {
                    invoiceId: `ledger-opening-${ledger.id}`,
                    invoiceType: "OPENING_BALANCE",
                    invoiceNo: "OPENING / LEDGER BALANCE",
                    invoiceDate: ledger.createdAt,
                    invoiceAgeDays: Math.max(
                        Math.floor((today.getTime() - ledger.createdAt.getTime()) / 86400000),
                        0
                    ),
                    grandTotal: remainder,
                    originalGrandTotal: remainder,
                    allocatedAmount: 0,
                    outstandingAmount: remainder,
                    settlementStatus: "UNPAID",
                    sourceLedgerId: ledger.id
                };

                agency.totalOutstanding += remainder;
                agency.bucket_180_plus_days.amount += remainder;
                agency.bucket_180_plus_days.invoices.push(invoice);
            }
        }

        const rows =
        [...agencyMap.values()]
            .sort(
                (a, b) =>
                    a.agencyName.localeCompare(
                        b.agencyName
                    )
            );

        rows.forEach((row, index) => {

            row.vendorCode =
                `V${String(index + 1).padStart(3, "0")}`;

            // The account-level aging shown in the UI is based on its oldest
            // outstanding invoice/balance date. Expose the same value for the
            // summary Excel export.
            row.agingDays = row.createdAt
                ? Math.floor(
                    (today.getTime() - row.createdAt.getTime()) /
                    86400000
                )
                : 0;

            row.balanceType =
                query.type === "RECEIVABLE"
                    ? "RECEIVABLE"
                    : "PAYABLE";

        });
        

        const summary = {

            totalAgencies:
                rows.length,

            totalInvoices:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        row.bucket_0_60_days.invoices.length +
                        row.bucket_61_120_days.invoices.length +
                        row.bucket_121_180_days.invoices.length +
                        row.bucket_180_plus_days.invoices.length,
                    0
                ),

            totalOutstanding:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        row.totalOutstanding,
                    0
                ),

            bucket_0_60_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_0_60_days?.amount ?? 0),
                    0
                ),

            bucket_61_120_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_61_120_days?.amount ?? 0),
                    0
                ),

            bucket_121_180_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_121_180_days?.amount ?? 0),
                    0
                ),

            bucket_180_plus_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_180_plus_days?.amount ?? 0),
                    0
                )

        };
        

        const agencyDetails =
            query?.agencyId
                ? rows.find(
                    row =>
                        row.agencyId === query.agencyId
                ) ?? null
                : null;

        return {
            reportName:
                query.type === "RECEIVABLE"
                    ? "Accounts Receivable Aging Report"
                    : "Accounts Payable Aging Report",
            generatedAt:
                new Date(),
            branchId,
            agency,
            agencyId:
                query.agencyId,
            summary,
            rows:
                query?.agencyId && !query?.export
                    ? undefined
                    : rows,
            agencyDetails:
                query?.agencyId && !query?.export
                    ? agencyDetails
                    : undefined,
            exportData:
                query?.export
                    ? detailRows
                    : undefined
        };
    }
}
