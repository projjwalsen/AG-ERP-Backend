import { DebitCreditNoteSourceType, DebitCreditNoteStatus, DebitCreditNoteType, EntryType, JournalDirection, JournalStatus, LedgerNature, LedgerType, OutstandingType, Prisma, PurchaseStatus, SalesStatus, TransactionDirection, TransactionStatus, VoucherType } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { parseDate, resolveBalanceType } from "../../core/utils/loc.utils";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { importedTransactionTypeFromPath } from "../import/transaction-import.utils";
import {
    buildTrialBalanceBranchFilter,
    calculateTrialBalanceAmounts,
    effectiveMovementStart,
    hasTrialBalanceActivity,
    openingAppliesAt,
    resolveTrialBalancePeriod,
    sumTrialBalanceEntryGroups
} from "./trial-balance.utils";
import {
    normalizeTallySundryDebtorName,
    TALLY_SUNDRY_DEBTOR_ALLOWLIST
} from "./tally-sundry-debtors.allowlist";
import {
    normalizeTallyBankAccountName,
    TALLY_BANK_ACCOUNT_ALLOWLIST,
    TALLY_BANK_ACCOUNT_BRANCH_ID,
    TALLY_BANK_ACCOUNT_NAMES
} from "./tally-bank-accounts.allowlist";
import { buildDuplicateLedgerGroupDisplayMap } from "../accounting/ledger/ledger-group-display";

const PURCHASE_TB_VOUCHER_TYPES: VoucherType[] = [
    VoucherType.PURCHASE,
    VoucherType.RCM_PURCHASE,
    VoucherType.GST_PURCHASE,
    VoucherType.IGST_PURCHASE,
    VoucherType.CST_PURCHASE,
    VoucherType.DISCOUNT_PURCHASE,
    VoucherType.HIGH_SEAS_PURCHASE,
    VoucherType.IMPORT_PURCHASE,
    VoucherType.VAT_PURCHASE,
    VoucherType.INTEREST_SAUNDRY_CREDITORS
];
const BANK_RECEIPT_TYPE = (VoucherType as any).BANK_RECEIPT ?? "BANK_RECEIPT";
const BANK_PAYMENT_TYPE = VoucherType.BANK_PAYMENT;
const BANK_VOUCHER_TYPES = [
    BANK_RECEIPT_TYPE,
    BANK_PAYMENT_TYPE,
    // Imported Receipt/Payment vouchers can use the plain voucher type
    // while still posting to a BANK ledger.
    VoucherType.RECEIPT,
    VoucherType.PAYMENT,
    // Tally bank books record transfers between cash/bank ledgers as Contra.
    VoucherType.CONTRA
] as VoucherType[];
// Trial Balance cash-in-hand is intentionally limited to the Journal
// voucher whose subhead is Cash under the Cash in Hand journal head.
const CASH_IN_HAND_JOURNAL_VOUCHER_FILTER: Prisma.VoucherWhereInput = {
    voucherType: VoucherType.JOURNAL,
    journals: {
        some: {
            status: JournalStatus.APPROVED,
            journalHead: {
                name: { equals: "Cash", mode: "insensitive" },
                parent: {
                    name: { equals: "Cash in Hand", mode: "insensitive" }
                }
            }
        }
    }
};
const CUSTOM_TRIAL_BALANCE_GROUP_CODES = new Set([
    "CONSUMABLE_PRODUCT"
]);
const PURCHASE_TRIAL_BALANCE_HEADS = new Set([
    "CST PURCHASE",
    "DISCOUNT",
    "GST PURCHASE",
    "HIGH SEAS PURCHASE",
    "IGST PURCHASE",
    "IMPORT PURCHASE",
    "INCENTIVES RECEIVED",
    "INTEREST PAID TO S.CREDITORS",
    "VAT PURCHASE"
]);
const SALES_NOTE_ADJUSTMENT_HEADS = new Set([
    "SALES CREDIT NOTE ADJUSTMENTS",
    "SALES DEBIT NOTE ADJUSTMENTS"
]);
const PURCHASE_NOTE_ADJUSTMENT_HEADS = new Set([
    "PURCHASE CREDIT NOTE ADJUSTMENTS",
    "PURCHASE DEBIT NOTE ADJUSTMENTS"
]);
// Keep party ledgers visible in the Trial Balance tree. Collapsing these
// control groups into a synthetic summary row hid the individual debtor /
// creditor movements and caused the group name to appear twice in exports.
const COLLAPSED_TRIAL_BALANCE_GROUP_CODES = new Set<string>();
const PURCHASE_SUB_GROUP_MARKER = "TB_PURCHASE_SUBGROUPS";

const readPurchaseSubGroups = (remarks: string | null) => {
    const match = remarks?.match(
        // The payload itself is a JSON array. Its closing `]` is immediately
        // followed by the marker's `]]`, so a generic `(.*?)]]` expression
        // incorrectly consumes the JSON closing bracket and JSON.parse fails.
        new RegExp(`\\[\\[${PURCHASE_SUB_GROUP_MARKER}:(\\[[\\s\\S]*?\\])\\]\\]`)
    );
    if (!match) return [] as Array<{
        name: string;
        entryType: EntryType;
        amount: number;
    }>;

    try {
        const parsed = JSON.parse(match[1]);
        return Array.isArray(parsed)
            ? parsed
                .filter(item =>
                    item &&
                    typeof item.name === "string" &&
                    (item.entryType === EntryType.DEBIT || item.entryType === EntryType.CREDIT) &&
                    Number.isFinite(Number(item.amount))
                )
                .map(item => ({
                    name: String(item.name).trim(),
                    entryType: item.entryType as EntryType,
                    amount: Number(item.amount)
                }))
                .filter(item => item.name && item.amount !== 0)
            : [];
    } catch {
        return [];
    }
};

// Imported inward-note paths are stored as a hierarchy, for example
// "Purchase Accounts / Carriage Outward-URD". Trial Balance displays the
// leaf category as the Purchase Accounts sub-row. Some approved notes do not
// have a purchaseId, so their category must be resolved from this path.
const purchaseCategoryFromImportedPath = (value: string | null) => {
    const head = importedTransactionTypeFromPath(value);
    if (!head) return "";
    if (head === "DISCOUNT PURCHASE") return "DISCOUNT";
    return head;
};

const salesCategoryFromImportedPath = (value: string | null) => {
    const parts = String(value || "")
        .replace(/\\/g, "/")
        .split(/[/>]/)
        .map(part => part.replace(/_/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean);

    if (parts.length < 2 || parts[0].toUpperCase() !== "SALES ACCOUNTS") {
        return "";
    }

    const category = parts[parts.length - 1].toUpperCase();
    return category === "GST SALES" || category === "IGST SALES"
        ? category
        : "";
};


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
                // Cash movements are restricted to the approved Cash journal
                // subhead. Imported opening-balance vouchers are excluded.
                { voucher: CASH_IN_HAND_JOURNAL_VOUCHER_FILTER }
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

        // Imported purchase vouchers can post the supplier's credit directly
        // to a JOURNAL-category ledger. Those vouchers have no linked Journal
        // row, so the journal-only filter below was dropping the supplier
        // credit while keeping the paired payment/debit entries. Include a
        // purchase voucher only when its source Purchase is approved; this
        // preserves the approval boundary for operational purchases.
        const approvedPurchaseIds = (await prisma.purchase.findMany({
            where: {
                status: PurchaseStatus.APPROVED,
                ...(branchId ? { branchId } : {})
            },
            select: { id: true }
        })).map(purchase => purchase.id);

        const approvedSaleIds = (await prisma.sale.findMany({
            where: {
                status: SalesStatus.APPROVED,
                ...(branchId ? { branchId } : {})
            },
            select: { id: true }
        })).map(sale => sale.id);

        const groupRows = await prisma.ledgerGroup.findMany({
            select: { id: true, name: true, parentId: true }
        });
        const currentLiabilitiesGroup = groupRows.find(group =>
            group.name.trim().toLocaleLowerCase() === "current liabilities" &&
            !group.parentId
        );
        const advanceFromSDebtorsRoot = currentLiabilitiesGroup
            ? groupRows.find(group =>
                group.parentId === currentLiabilitiesGroup.id &&
                group.name.trim().toLocaleLowerCase() === "advance from s. debtors"
            )
            : undefined;
        const collectDescendantGroupIds = (rootId?: string) => {
            const ids = new Set<string>();
            if (!rootId) return ids;
            ids.add(rootId);
            let hasNewGroup = true;
            while (hasNewGroup) {
                hasNewGroup = false;
                for (const group of groupRows) {
                    if (
                        group.parentId &&
                        ids.has(group.parentId) &&
                        !ids.has(group.id)
                    ) {
                        ids.add(group.id);
                        hasNewGroup = true;
                    }
                }
            }
            return ids;
        };
        const advanceFromSDebtorsGroupIds = collectDescendantGroupIds(
            advanceFromSDebtorsRoot?.id
        );
        const outstandingExpRoot = currentLiabilitiesGroup
            ? groupRows.find(group =>
                group.parentId === currentLiabilitiesGroup.id &&
                group.name.trim().toLocaleLowerCase() === "outstanding exp"
            )
            : undefined;
        const outstandingExpGroupIds = collectDescendantGroupIds(
            outstandingExpRoot?.id
        );
        const tallyDutiesRoot = currentLiabilitiesGroup
            ? groupRows.find(group =>
                group.parentId === currentLiabilitiesGroup.id &&
                group.name.trim().toLocaleLowerCase() === "duties & taxes"
            )
            : undefined;
        const tallyDutiesGroupIds = collectDescendantGroupIds(
            tallyDutiesRoot?.id
        );
        const tallySundryCreditorsRoot = currentLiabilitiesGroup
            ? groupRows.find(group =>
                group.parentId === currentLiabilitiesGroup.id &&
                group.name.trim().toLocaleLowerCase() === "sundry creditors"
            )
            : undefined;
        const tallySundryCreditorGroupIds = collectDescendantGroupIds(
            tallySundryCreditorsRoot?.id
        );
        const tallyUnsecuredLoanGroupIds = new Set<string>();
        for (const group of groupRows) {
            if (group.name.trim().toLocaleLowerCase() === "unsecured loans") {
                for (const id of collectDescendantGroupIds(group.id)) {
                    tallyUnsecuredLoanGroupIds.add(id);
                }
            }
        }

        // Approved journals are the normal source. The narrow exceptions
        // below admit Path-classified Purchase entries, legacy inward-note
        // ledger entries without a saved Path, and Sales ledger entries
        // belonging to actual Sale vouchers. New inward notes are totalled
        // directly from DebitCreditNote.categoryPath below. Imports created
        // through the regular Journal importer are approved Journals, while
        // the dedicated note-only endpoint leaves notes PENDING until
        // accounting approval.
        const journalEntryFilter: Prisma.LedgerEntryWhereInput = ({
            OR: [
                // Receipt and payment imports are posted as balanced Voucher
                // records.  Older imports may not have a Journal relation,
                // so do not make their Trial Balance visibility depend on
                // that relation.  LedgerEntry.entryType remains the source
                // of the transaction Debit/Credit amount below.
                {
                    voucher: {
                        voucherType: {
                            in: [
                                VoucherType.RECEIPT,
                                VoucherType.PAYMENT,
                                VoucherType.CASH_RECEIPT,
                                VoucherType.CASH_PAYMENT,
                                VoucherType.BANK_RECEIPT,
                                VoucherType.BANK_PAYMENT,
                                VoucherType.CONTRA
                            ]
                        }
                    }
                },
                ...(approvedPurchaseIds.length > 0
                    ? [{
                        voucher: {
                            voucherType: { in: PURCHASE_TB_VOUCHER_TYPES },
                            sourceId: { in: approvedPurchaseIds }
                        }
                    }]
                    : []),
                ...(approvedSaleIds.length > 0 && advanceFromSDebtorsGroupIds.size > 0
                    ? [{
                        AND: [
                            {
                                ledger: {
                                    category: LedgerType.JOURNAL,
                                    groupId: { in: [...advanceFromSDebtorsGroupIds] }
                                }
                            },
                            {
                                voucher: {
                                    voucherType: VoucherType.SALE,
                                    sourceId: { in: approvedSaleIds }
                                }
                            }
                        ]
                    }]
                    : []),
                {
                    voucher: {
                        journals: {
                            some: {
                                status: JournalStatus.APPROVED,
                                categoryPath: null
                            }
                        }
                    }
                },
                {
                    voucher: {
                        journals: {
                            some: {
                                status: JournalStatus.APPROVED,
                                categoryPath: { not: null }
                            }
                        }
                    }
                },
                {
                    // Receipt/payment and other approved transaction
                    // vouchers carry the debtor/creditor settlement entries.
                    // They do not normally have a Journal row, so excluding
                    // them leaves Sundry Debtors/Creditors with only opening
                    // balances in Trial Balance.
                    voucher: {
                        transaction: {
                            some: {
                                status: TransactionStatus.APPROVED
                            }
                        }
                    }
                },
                {
                    AND: [
                        { ledger: { category: LedgerType.PURCHASE } },
                        {
                            voucher: {
                                OR: [
                                    {
                                        debitCreditNotes: {
                                            some: {
                                                sourceType: DebitCreditNoteSourceType.PURCHASE,
                                                status: DebitCreditNoteStatus.APPROVED,
                                                categoryPath: null
                                            }
                                        }
                                    },
                                    {
                                        transaction: {
                                            some: {
                                                status: TransactionStatus.APPROVED,
                                                debitCreditNote: {
                                                    is: {
                                                        sourceType: DebitCreditNoteSourceType.PURCHASE,
                                                        status: DebitCreditNoteStatus.APPROVED,
                                                        categoryPath: null
                                                    }
                                                }
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                },
                {
                    AND: [
                        {
                            ledger: {
                                category: LedgerType.PURCHASE,
                                code: { startsWith: "PURCHASE-TYPE-" }
                            }
                        },
                        {
                            voucher: {
                                voucherType: {
                                    in: PURCHASE_TB_VOUCHER_TYPES
                                }
                            }
                        }
                    ]
                },
                {
                    // RCM purchase journals can be posted through the
                    // Journal Import flow and may not have a PURCHASE-type
                    // ledger. Include the voucher explicitly so its ledger
                    // entries are available to Trial Balance.
                    voucher: {
                        voucherType: VoucherType.RCM_PURCHASE
                    }
                },
                {
                    // Debit/credit-note imports are also voucher-backed
                    // journal rows. Do not make their Trial Balance
                    // visibility depend on the Journal relation being
                    // present/approved: the LedgerEntry already contains
                    // the authoritative debit or credit side and its ledger
                    // belongs to the imported header/subheader hierarchy.
                    voucher: {
                        voucherType: {
                            in: [VoucherType.DEBIT_NOTE, VoucherType.CREDIT_NOTE]
                        }
                    }
                },
                {
                    // Some approved notes are attached to a voucher whose
                    // voucherType is not DEBIT_NOTE/CREDIT_NOTE. The note
                    // relation is authoritative in that case, especially
                    // for imported notes without a purchaseId.
                    voucher: {
                        debitCreditNotes: {
                            some: {
                                status: DebitCreditNoteStatus.APPROVED
                            }
                        }
                    }
                },
                {
                    AND: [
                        { ledger: { category: LedgerType.SALES } },
                        { voucher: { voucherType: VoucherType.SALE } }
                    ]
                },
                {
                    AND: [
                        // Sale invoices debit the agency's customer ledger by
                        // the invoice grand total. Include that posting so it
                        // is visible under the Sundry Debtors control head.
                        { ledger: { category: LedgerType.CUSTOMER } },
                        { voucher: { voucherType: VoucherType.SALE } }
                    ]
                },
                {
                    AND: [
                        // TDS Assets reconciliation remaps the existing
                        // journal posting to the customer ledger. Include
                        // that posting by ledger/category even when the
                        // source Journal relation is unavailable.
                        { ledger: { category: LedgerType.CUSTOMER } },
                        { voucher: { voucherType: VoucherType.JOURNAL } }
                    ]
                },
                {
                    AND: [
                        // Purchase invoices credit the agency's vendor ledger
                        // by the invoice grand total. Include that posting so
                        // it is visible under the Sundry Creditors control head.
                        { ledger: { category: LedgerType.VENDOR } },
                        {
                            voucher: {
                                voucherType: {
                                    in: PURCHASE_TB_VOUCHER_TYPES
                                }
                            }
                        }
                    ]
                },
                ...(tallySundryCreditorGroupIds.size > 0
                    ? [{
                        // Tally Current Liabilities > Sundry Creditors is the
                        // source group summary. Include every voucher on those
                        // ledgers, including imported Journal/Purchase rows
                        // that have no approved Journal relation.
                        ledger: { groupId: { in: [...tallySundryCreditorGroupIds] } }
                    }]
                    : []),
                ...(advanceFromSDebtorsGroupIds.size > 0
                    ? [{
                        // The Advance From S. Debtors subhead is reconciled
                        // from the Tally voucher register. Include its posted
                        // ledger entries even when an imported source voucher
                        // has no approved Journal/Transaction master.
                        ledger: { groupId: { in: [...advanceFromSDebtorsGroupIds] } }
                    }]
                    : []),
                ...(outstandingExpGroupIds.size > 0
                    ? [{
                        // Outstanding Exp is reconciled from Tally ledger
                        // statements, including approved and imported payment
                        // vouchers without a Journal master relation.
                        ledger: { groupId: { in: [...outstandingExpGroupIds] } }
                    }]
                    : []),
                ...(tallyDutiesGroupIds.size > 0
                    ? [{
                        // Tally Current Liabilities > Duties & Taxes includes
                        // GST on Sale/Purchase vouchers posted to these
                        // ledgers, not only Journal-register rows.
                        ledger: { groupId: { in: [...tallyDutiesGroupIds] } }
                    }]
                    : []),
                ...(tallyUnsecuredLoanGroupIds.size > 0
                    ? [{
                        // Unsecured Loans is reconciled from Tally ledger
                        // prints. Include every voucher on those ledgers,
                        // including imported Journal rows with no approved
                        // Journal master relation.
                        ledger: { groupId: { in: [...tallyUnsecuredLoanGroupIds] } }
                    }]
                    : [])
            ]
        } as any);
        const scopedJournalEntryFilter: Prisma.LedgerEntryWhereInput = {
            AND: [
                journalEntryFilter,
                ...(branchEntryFilter ? [branchEntryFilter] : [])
            ]
        };

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

            OR: [
                { entries: { some: scopedJournalEntryFilter } },
                {
                    journalHeads: {
                        some: {
                            journals: {
                                some: {
                                    status: JournalStatus.APPROVED,
                                    OR: [
                                        { voucherId: null },
                                        {
                                            voucherId: { not: null },
                                            voucher: { entries: { none: {} } }
                                        }
                                    ],
                                    ...(branchId ? { branchId } : {})
                                }
                            }
                        }
                    }
                },
                ...(tallySundryCreditorGroupIds.size > 0
                    ? [{
                        groupId: { in: [...tallySundryCreditorGroupIds] },
                        isActive: true
                    } as Prisma.LedgerWhereInput]
                    : []),
                ...(advanceFromSDebtorsGroupIds.size > 0
                    ? [{
                        groupId: { in: [...advanceFromSDebtorsGroupIds] },
                        isActive: true,
                        ...(branchId
                            ? {
                                OR: [
                                    { branchId },
                                    { entries: { some: branchEntryFilter } }
                                ]
                            }
                            : {})
                    } as Prisma.LedgerWhereInput]
                    : []),
                ...(outstandingExpGroupIds.size > 0
                    ? [{
                        groupId: { in: [...outstandingExpGroupIds] },
                        isActive: true,
                        ...(branchId
                            ? {
                                OR: [
                                    { branchId },
                                    { entries: { some: branchEntryFilter } }
                                ]
                            }
                            : {})
                    } as Prisma.LedgerWhereInput]
                    : []),
                ...(tallyDutiesGroupIds.size > 0
                    ? [{
                        groupId: { in: [...tallyDutiesGroupIds] },
                        isActive: true,
                        ...(branchId
                            ? {
                                OR: [
                                    { branchId },
                                    { entries: { some: branchEntryFilter } }
                                ]
                            }
                            : {})
                    } as Prisma.LedgerWhereInput]
                    : []),
                ...(tallyUnsecuredLoanGroupIds.size > 0
                    ? [{
                        groupId: { in: [...tallyUnsecuredLoanGroupIds] },
                        isActive: true,
                        ...(branchId
                            ? {
                                OR: [
                                    { branchId },
                                    { entries: { some: branchEntryFilter } }
                                ]
                            }
                            : {})
                    } as Prisma.LedgerWhereInput]
                    : []),
                ...(branchId === TALLY_BANK_ACCOUNT_BRANCH_ID
                    ? [{
                        // Include the Tally-listed accounts even when their
                        // ledger has only opening-balance entries and no
                        // ledger-level branch assignment.
                        name: { in: TALLY_BANK_ACCOUNT_NAMES, mode: "insensitive" },
                        OR: [{ branchId }, { entries: { some: { branchId } } }]
                    } as Prisma.LedgerWhereInput]
                    : [])
            ]
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
                    },

                    agency: {
                        select: {
                            id: true,
                            name: true
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

        const pathClassifiedPurchases = await prisma.purchase.findMany({
            where: {
                status: PurchaseStatus.APPROVED,
                ...(branchId ? { branchId } : {}),
                AND: [
                    { path: { not: null } },
                    { path: { not: "" } }
                ]
            },
            select: {
                id: true,
                invoiceNo: true,
                path: true,
                invoiceDate: true,
                createdAt: true
            }
        });
        const pathClassifiedPurchaseIds = pathClassifiedPurchases.map(row => row.id);

        const aggregateWindows = async (
            window: "period" | "prior",
            purchaseAccountsOnly = false
        ) => {
            const byCutoff = new Map<string, {
                cutoff?: Date;
                ledgerIds: string[];
            }>();

            for (const ledger of ledgers) {
                const mayUseOpening =
                    (!branchId || ledger.branchId === branchId) &&
                    ledger.category !== LedgerType.BANK &&
                    ledger.category !== LedgerType.CASH &&
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
                                scopedJournalEntryFilter,
                                {
                                        ledgerId: { in: ledgerIds },
                                        voucher: {
                                            voucherDate,
                                            voucherType: purchaseAccountsOnly
                                            ? {
                                                in: [
                                                    ...PURCHASE_TB_VOUCHER_TYPES,
                                                    VoucherType.DEBIT_NOTE,
                                                    VoucherType.CREDIT_NOTE
                                                ]
                                            }
                                            : { not: VoucherType.OPENING_BALANCE },
                                            ...(purchaseAccountsOnly && pathClassifiedPurchaseIds.length > 0
                                                ? { sourceId: { notIn: pathClassifiedPurchaseIds } }
                                                : {})
                                        }
                                },
                                {
                                    OR: [
                                        // Non-cash/non-bank ledgers retain all voucher types.
                                        {
                                            ledger: {
                                                category: { notIn: [LedgerType.CASH, LedgerType.BANK] }
                                            }
                                        },
                                        // Cash in Hand is driven only by the
                                        // approved Journal / Cash in Hand / Cash
                                        // subhead combination.
                                        {
                                            ledger: { category: LedgerType.CASH },
                                            voucher: CASH_IN_HAND_JOURNAL_VOUCHER_FILTER
                                        },
                                        // Bank accounts are driven by bank
                                        // receipts/payments and Contra transfers.
                                        {
                                            ledger: { category: LedgerType.BANK },
                                            voucher: { voucherType: { in: BANK_VOUCHER_TYPES } }
                                        }
                                    ]
                                }
                            ]
                        },
                        _sum: { amount: true }
                    });

                    groups.push(...batch);

                    if (purchaseAccountsOnly) continue;

                    // Legacy journal imports can remain as approved Journal
                    // rows without a Voucher/LedgerEntry. Include those
                    // postings in Trial Balance; otherwise the ledger
                    // balance and Trial Balance disagree.
                    const directJournals = await prisma.journal.findMany({
                        where: {
                            journalHead: { ledgerId: { in: ledgerIds } },
                            status: JournalStatus.APPROVED,
                            // A normal voucher-backed journal is represented
                            // by its LedgerEntry. Older imports can have the
                            // Journal and Voucher but no LedgerEntry, so
                            // include those rows as a fallback. The `none`
                            // condition prevents double-counting healthy
                            // voucher-backed journals. Opening-balance
                            // vouchers are already applied as opening, even
                            // when they have no LedgerEntry.
                            OR: [
                                { voucherId: null },
                                {
                                    voucherId: { not: null },
                                    voucher: {
                                        entries: { none: {} },
                                        voucherType: { not: VoucherType.OPENING_BALANCE }
                                    }
                                }
                            ],
                            ...(branchId ? { branchId } : {}),
                            journalDate: voucherDate
                        },
                        select: {
                            amount: true,
                            direction: true,
                            journalHead: { select: { ledgerId: true, type: true } }
                        }
                    });

                    groups.push(...directJournals.map(journal => ({
                        ledgerId: journal.journalHead.ledgerId,
                        entryType: (
                            (journal.direction || journal.journalHead.type) === JournalDirection.INWARD
                                ? EntryType.DEBIT
                                : EntryType.CREDIT
                        ),
                        _sum: { amount: journal.amount }
                    })));
                }
            }

            
            return groups;
        };

        const [periodGroups, priorGroups, purchasePeriodGroups, purchasePriorGroups] = await Promise.all([
            aggregateWindows("period"),
            aggregateWindows("prior"),
            aggregateWindows("period", true),
            aggregateWindows("prior", true)
        ]);
        const periodMap = sumTrialBalanceEntryGroups(periodGroups);
        const priorMap = sumTrialBalanceEntryGroups(priorGroups);
        const purchasePeriodMap = sumTrialBalanceEntryGroups(purchasePeriodGroups);
        const purchasePriorMap = sumTrialBalanceEntryGroups(purchasePriorGroups);

        // Accounting-only inward notes are posted by the approval workflow to
        // the generic "Purchase ... Note Adjustments" journal ledger. When
        // the note has an imported categoryPath, the Trial Balance must show
        // that movement under the actual category ledger as well. Move the
        // adjustment-side movement report-wise; this keeps the Trial Balance
        // total unchanged while making, for example, Carriage Outward-URD
        // include its approved debit notes.
        const categoryNoteIds = new Set<string>();
        const categorizedInwardNotes = await prisma.debitCreditNote.findMany({
            where: {
                ...(branchId ? { branchId } : {}),
                sourceType: DebitCreditNoteSourceType.PURCHASE,
                status: DebitCreditNoteStatus.APPROVED,
                purchaseId: null,
                OR: [
                    { noteNo: { startsWith: "PDN/" } },
                    { noteNo: { startsWith: "PCN/" } }
                ],
                categoryPath: { not: null },
                noteDate: { lte: endDate },
                voucherId: { not: null }
            },
            select: {
                id: true,
                branchId: true,
                noteNo: true,
                categoryPath: true,
                noteDate: true,
                voucher: {
                    select: {
                        entries: {
                            select: {
                                entryType: true,
                                amount: true,
                                narration: true,
                                ledger: {
                                    select: { id: true, name: true, category: true }
                                }
                            }
                        }
                    }
                }
            }
        });

        const normalizedName = (value: unknown) => String(value || "")
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
        const compactNoteToken = (value: unknown) =>
            String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        const postedNoteTokensByLedger = new Map<string, Array<{ voucherNo: string; narration: string }>>();
        const loadPostedNoteTokens = async (ledgerId: string) => {
            const cached = postedNoteTokensByLedger.get(ledgerId);
            if (cached) return cached;
            const rows = await prisma.ledgerEntry.findMany({
                where: { ledgerId },
                select: {
                    narration: true,
                    voucher: { select: { voucherNo: true, narration: true } }
                }
            });
            const tokens = rows.map(row => ({
                voucherNo: compactNoteToken(row.voucher.voucherNo),
                narration: compactNoteToken([row.narration, row.voucher.narration].join(" "))
            }));
            postedNoteTokensByLedger.set(ledgerId, tokens);
            return tokens;
        };

        const categoryLeaf = (value: string | null) => {
            const parts = String(value || "")
                .replace(/\\/g, "/")
                .split(/[/>]/)
                .map(part => part.replace(/_/g, " ").replace(/\s+/g, " ").trim())
                .filter(Boolean);
            return parts.length > 0
                ? parts[parts.length - 1].toUpperCase()
                : "";
        };

        const processedCategoryNotes = new Set<string>();
        for (const note of categorizedInwardNotes) {
            const noteKey = [
                note.branchId,
                note.noteNo,
                normalizedName(note.categoryPath),
                String(note.voucher?.entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0) || 0)
            ].join("|");
            if (processedCategoryNotes.has(noteKey)) {
                categoryNoteIds.add(note.id);
                continue;
            }
            processedCategoryNotes.add(noteKey);
            const categoryPathText = String(note.categoryPath || "");
            // Party paths such as Current Liabilities / Sundry Creditors / ...
            // already have their Tally register posting on the creditor
            // ledger. Remapping the adjustment voucher onto that party
            // doubles the debit in the Sundry Creditors group summary.
            if (
                /sundry\s+creditors|sundry\s+debtors|advance\s+from\s+s\.?\s*debtors|duties\s*&\s*taxes|(?:^|[/\\>])\s*unsecured\s+loans?(?:\s|$|[/\\>])|loan\s+from\s+directors?|unsecured\s+from\s+(?:bank|other)/i
                    .test(categoryPathText)
            ) {
                categoryNoteIds.add(note.id);
                continue;
            }
            const targetName = categoryLeaf(note.categoryPath);
            if (PURCHASE_TRIAL_BALANCE_HEADS.has(normalizedName(targetName))) {
                continue;
            }
            const sameNamedLedgers = ledgers.filter(ledger =>
                normalizedName(ledger.name) === normalizedName(targetName) &&
                [LedgerType.JOURNAL, LedgerType.PURCHASE].includes(ledger.category)
            );
            const targetCandidates = sameNamedLedgers.filter(ledger =>
                ledger.branchId === (branchId || note.branchId)
            );
            const targetLedger = targetCandidates[0] || sameNamedLedgers[0];
            if (!targetLedger) continue;
            if (
                tallySundryCreditorGroupIds.has(targetLedger.groupId) ||
                advanceFromSDebtorsGroupIds.has(targetLedger.groupId) ||
                tallyDutiesGroupIds.has(targetLedger.groupId) ||
                tallyUnsecuredLoanGroupIds.has(targetLedger.groupId)
            ) {
                categoryNoteIds.add(note.id);
                continue;
            }

            // The same imported note may already have a journal-register
            // posting on the target category ledger. In that case the target
            // movement is already present and must not be added again from
            // the accounting-only note voucher. Imported journal voucher
            // numbers often keep Tally's spaced form ("PDN/M /2526 /078")
            // while the debit-note master stores "PDN/M/2526/078", so match
            // on compact tokens rather than a literal contains(). Check every
            // same-named ledger: imports can land the register on one copy
            // and the note remap on another.
            const noteToken = compactNoteToken(note.noteNo);
            let alreadyPostedToTarget = false;
            if (noteToken) {
                for (const candidate of sameNamedLedgers) {
                    alreadyPostedToTarget = (await loadPostedNoteTokens(candidate.id)).some(token =>
                        token.voucherNo === noteToken || token.narration.includes(noteToken)
                    );
                    if (alreadyPostedToTarget) break;
                }
            }
            if (alreadyPostedToTarget) continue;

            const sourceEntries = note.voucher?.entries.filter(entry =>
                entry.ledger.category === LedgerType.JOURNAL &&
                (!entry.narration || entry.narration.includes(note.categoryPath || ""))
            ) || [];
            if (sourceEntries.length === 0) continue;

            const sourceTotals = new Map<string, { debit: number; credit: number }>();
            for (const entry of sourceEntries) {
                const current = sourceTotals.get(entry.ledger.id) || { debit: 0, credit: 0 };
                current[entry.entryType === EntryType.DEBIT ? "debit" : "credit"] += Number(entry.amount || 0);
                sourceTotals.set(entry.ledger.id, current);
            }

            const targetMap = note.noteDate < startDate ? priorMap : periodMap;
            const targetTotals = targetMap.get(targetLedger.id) || { debit: 0, credit: 0 };
            for (const [sourceLedgerId, totals] of sourceTotals) {
                const sourceMap = targetMap.get(sourceLedgerId) || { debit: 0, credit: 0 };
                sourceMap.debit -= totals.debit;
                sourceMap.credit -= totals.credit;
                targetMap.set(sourceLedgerId, sourceMap);
                targetTotals.debit += totals.debit;
                targetTotals.credit += totals.credit;
            }
            targetMap.set(targetLedger.id, targetTotals);
            categoryNoteIds.add(note.id);
        }

        // Imported opening-balance vouchers are used only for ledgers that do
        // not already have an opening value stored on the ledger itself.
        // Some older imports populated both the Ledger opening fields and an
        // OPENING_BALANCE voucher; adding both would double the opening
        // balance in Trial Balance.
        const openingEntries = await prisma.ledgerEntry.findMany({
            where: {
                AND: [
                    // Opening vouchers are deliberately excluded from the
                    // ordinary movement filter. Read them separately, with
                    // only the branch scope applied, so imported openings
                    // can be used when the ledger has no stored opening.
                    ...(branchEntryFilter ? [branchEntryFilter] : []),
                    {
                        ledgerId: { in: ledgers.map(ledger => ledger.id) },
                        ledger: { category: { notIn: [LedgerType.BANK, LedgerType.CASH] } },
                        voucher: {
                            voucherType: VoucherType.OPENING_BALANCE,
                            voucherDate: { lte: endDate }
                        }
                    }
                ]
            },
            select: {
                id: true,
                ledgerId: true,
                voucherId: true,
                entryType: true,
                amount: true,
                narration: true,
                ledger: { select: { name: true, branchId: true } },
                voucher: { select: { voucherDate: true } }
            }
        });

        // Some legacy imports posted an opening voucher to the wrong ledger
        // while keeping the intended ledger name in the narration, for
        // example: MICROWAVE <- "Opening balance: WATER PURIFIER". If the
        // narrated target ledger exists in the same branch, the posting is
        // already represented by that target ledger and must not be counted
        // on the incorrectly attached ledger as well.
        const normalizeOpeningName = (value: unknown) => String(value || "")
            .replace(/^opening\s+balance\s*:\s*/i, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleUpperCase();
        const ledgerNameKeys = new Set(
            ledgers.map(ledger =>
                `${ledger.branchId || ""}|${normalizeOpeningName(ledger.name)}`
            )
        );
        const misassignedOpeningEntryIds = new Set<string>();
        for (const entry of openingEntries) {
            const narratedTarget = normalizeOpeningName(entry.narration);
            const currentLedger = normalizeOpeningName(entry.ledger.name);
            if (
                narratedTarget &&
                narratedTarget !== "OPENING BALANCE" &&
                narratedTarget !== currentLedger &&
                ledgerNameKeys.has(`${entry.ledger.branchId || ""}|${narratedTarget}`)
            ) {
                misassignedOpeningEntryIds.add(entry.id);
            }
        }

        // Some imports create two opening vouchers for the same ledger with
        // the same date, direction, and amount. Treat those identical postings
        // as one opening while preserving distinct or split opening amounts.
        const openingByVoucher = new Map<string, {
            ledgerId: string;
            voucherId: string;
            entryType: EntryType;
            amount: number;
            voucherDate: Date;
        }>();
        for (const entry of openingEntries) {
            if (misassignedOpeningEntryIds.has(entry.id)) continue;
            const key = `${entry.voucherId}|${entry.ledgerId}|${entry.entryType}`;
            const current = openingByVoucher.get(key);
            openingByVoucher.set(key, {
                ledgerId: entry.ledgerId,
                voucherId: entry.voucherId,
                entryType: entry.entryType,
                amount: (current?.amount || 0) + Number(entry.amount || 0),
                voucherDate: entry.voucher.voucherDate
            });
        }
        const seenOpeningPostings = new Set<string>();
        const openingGroups = [...openingByVoucher.values()]
            .filter(posting => {
                // Imports may create a repeated opening voucher for any
                // ledger category. Compare the business date in India because
                // midnight local time can be stored as the previous UTC date.
                const indiaDate = new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Kolkata",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit"
                }).format(posting.voucherDate);
                const key = [
                    posting.ledgerId,
                    indiaDate,
                    posting.entryType,
                    posting.amount.toFixed(2)
                ].join("|");
                if (seenOpeningPostings.has(key)) return false;
                seenOpeningPostings.add(key);
                return true;
            })
            .map(posting => ({
                ledgerId: posting.ledgerId,
                entryType: posting.entryType,
                _sum: { amount: posting.amount }
            }));
        const openingMap = sumTrialBalanceEntryGroups(openingGroups);

        // Older journal imports created a separate JOURNAL ledger for a
        // party, while the opening-balance import also stored the opening on
        // the canonical CUSTOMER/VENDOR ledger.  In that situation the
        // opening voucher on the legacy ledger is the same opening amount,
        // not another opening.  Suppress only that duplicate opening
        // voucher; keep the legacy ledger's ordinary journal movements.
        const partyBaseName = (value: unknown) => String(value || "")
            .replace(/\s+-\s+Sundry\s+(?:Debtor|Creditor)\s*$/i, "")
            .trim()
            .replace(/\s+/g, " ")
            .toUpperCase();
        const canonicalPartyOpenings = new Map<string, boolean>();

        for (const ledger of ledgers) {
            if (ledger.category !== LedgerType.CUSTOMER &&
                ledger.category !== LedgerType.VENDOR) continue;

            const hasOpening =
                Number(ledger.openingDebit || 0) !== 0 ||
                Number(ledger.openingCredit || 0) !== 0 ||
                Number(ledger.openingBalance || 0) !== 0;
            if (!hasOpening) continue;

            canonicalPartyOpenings.set(
                `${ledger.branchId || ""}|${ledger.category}|${partyBaseName(ledger.name)}`,
                true
            );
        }

        const duplicateLegacyOpeningLedgerIds = new Set<string>();
        for (const ledger of ledgers) {
            if (ledger.category !== LedgerType.JOURNAL) continue;
            // Current Liabilities > Sundry Creditors is the Tally source
            // head. Keep its opening vouchers even when a seeded vendor
            // ledger stores the same party's opening on ledger fields.
            if (
                tallySundryCreditorGroupIds.has(ledger.groupId) ||
                tallyUnsecuredLoanGroupIds.has(ledger.groupId)
            ) continue;

            const base = partyBaseName(ledger.name);
            const branch = ledger.branchId || "";
            if (
                canonicalPartyOpenings.has(`${branch}|${LedgerType.CUSTOMER}|${base}`) ||
                canonicalPartyOpenings.has(`${branch}|${LedgerType.VENDOR}|${base}`)
            ) {
                duplicateLegacyOpeningLedgerIds.add(ledger.id);
            }
        }

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

        const rawLedgerRows =
            ledgers
            .map(ledger => {

                /**
                 * A branch-specific report must not blindly inherit
                 * another branch's opening balance.
                 */
                const shouldUseLedgerOpening =
                    ledger.category !== LedgerType.BANK &&
                    ledger.category !== LedgerType.CASH &&
                    (!branchId || ledger.branchId === branchId) &&
                    openingAppliesAt(
                        ledger.openingBalanceDate,
                        endDate
                    );

                const movementPriorMap = ledger.category === LedgerType.PURCHASE
                    ? purchasePriorMap
                    : priorMap;
                const movementPeriodMap = ledger.category === LedgerType.PURCHASE
                    ? purchasePeriodMap
                    : periodMap;

                const prior =
                    movementPriorMap.get(
                        ledger.id
                    ) || {
                        debit: 0,
                        credit: 0
                    };

                const period =
                    movementPeriodMap.get(
                        ledger.id
                    ) || {
                        debit: 0,
                        credit: 0
                    };

                const isDuplicateLegacyOpening = duplicateLegacyOpeningLedgerIds.has(ledger.id);
                const voucherOpening = openingMap.get(ledger.id);
                // The imported opening vouchers are the source detail for the
                // ledger opening. Prefer their deduplicated total when present:
                // legacy imports can also have copied that same amount into
                // the Ledger fields (sometimes twice).
                const openingFromVoucher = !isDuplicateLegacyOpening && voucherOpening
                    ? voucherOpening
                    : { debit: 0, credit: 0 };
                const useVoucherOpening = openingFromVoucher.debit !== 0 ||
                    openingFromVoucher.credit !== 0;
                const ledgerWithImportedOpening = {
                    ...ledger,
                    openingDebit: useVoucherOpening
                        ? openingFromVoucher.debit
                        : isDuplicateLegacyOpening ? 0 : Number(ledger.openingDebit || 0),
                    openingCredit: useVoucherOpening
                        ? openingFromVoucher.credit
                        : isDuplicateLegacyOpening ? 0 : Number(ledger.openingCredit || 0),
                    openingBalance: useVoucherOpening
                        ? openingFromVoucher.debit - openingFromVoucher.credit
                        : isDuplicateLegacyOpening ? 0 : Number(ledger.openingBalance || 0)
                };

                const amounts = calculateTrialBalanceAmounts(
                    ledgerWithImportedOpening,
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
                        ledger.category === LedgerType.BANK &&
                            String(ledger.name).trim().toUpperCase() === "BANK"
                            ? "Bank Account"
                            : ledger.name,

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

                    agencyId:
                        ledger.agency?.id ||
                        null,

                    agencyName:
                        ledger.agency?.name ||
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

        // Imports can create more than one ledger for the same journal head
        // name (for example, one ledger from the RCM journal register and a
        // second one from the debit-note register). They can therefore look
        // like duplicate accounts in Trial Balance even though their voucher
        // postings are different. Merge only JOURNAL ledgers with the same
        // name, branch, and top-level accounting group; unrelated groups are
        // kept separate.
        const groupByIdForMerge = new Map(ledgerGroups.map(group => [group.id, group]));
        // Merge duplicate JOURNAL ledgers only within the same report head
        // (Sundry Creditors vs Advance From S. Debtors). Walking to the
        // Current Liabilities root mixed those heads and dropped creditor
        // movement from the Tally group summary.
        const reportHeadGroupId = (groupId: string) => {
            let group = groupByIdForMerge.get(groupId);
            while (group?.parentId) {
                const parent = groupByIdForMerge.get(group.parentId);
                if (!parent?.parentId) return group.id;
                group = parent;
            }
            return group?.id || groupId;
        };
        const mergedJournalRows = new Map<string, any[]>();
        const nonMergedRows: any[] = [];

        for (const row of rawLedgerRows) {
            if (row.ledgerCategory !== LedgerType.JOURNAL) {
                nonMergedRows.push(row);
                continue;
            }

            const key = [
                row.branchId || "",
                String(row.account || "").trim().replace(/\s+/g, " ").toUpperCase(),
                reportHeadGroupId(row.groupId)
            ].join("|");
            const rowsForKey = mergedJournalRows.get(key) || [];
            rowsForKey.push(row);
            mergedJournalRows.set(key, rowsForKey);
        }

        const roundMerged = (value: number) => Math.round(value * 100) / 100;
        const mergedJournalAccountRows = [...mergedJournalRows.values()].map(rowsForKey => {
            const first = [...rowsForKey].sort((a, b) => {
                const activity = (row: any) =>
                    Number(row.periodDebit || 0) + Number(row.periodCredit || 0);
                return activity(b) - activity(a);
            })[0];
            if (rowsForKey.length === 1) return { ...first };

            const sum = (field: string) => rowsForKey.reduce(
                (total, row) => total + Number(row[field] || 0),
                0
            );
            const periodDebit = roundMerged(sum("periodDebit"));
            const periodCredit = roundMerged(sum("periodCredit"));
            const openingSignedValues = rowsForKey.map(row =>
                roundMerged(Number(row.openingDebit || 0) - Number(row.openingCredit || 0))
            );
            const uniqueNonZeroOpenings = [...new Set(
                openingSignedValues.filter(value => value !== 0)
            )];
            const openingSigned = uniqueNonZeroOpenings.length === 1
                ? uniqueNonZeroOpenings[0]
                : roundMerged(openingSignedValues.reduce((total, value) => total + value, 0));
            const closingSigned = roundMerged(openingSigned + periodDebit - periodCredit);

            return {
                ...first,
                periodDebit,
                periodCredit,
                openingDebit: openingSigned > 0 ? openingSigned : 0,
                openingCredit: openingSigned < 0 ? Math.abs(openingSigned) : 0,
                debit: closingSigned > 0 ? closingSigned : 0,
                credit: closingSigned < 0 ? Math.abs(closingSigned) : 0,
                closingDebit: closingSigned > 0 ? closingSigned : 0,
                closingCredit: closingSigned < 0 ? Math.abs(closingSigned) : 0,
                closingSigned
            };
        });

        const consolidatedRawLedgerRows = [
            ...nonMergedRows,
            ...mergedJournalAccountRows
        ];

        /*
         * Older journal imports could create a JOURNAL ledger using the
         * party's plain name (for example, "ACME-DR"), while receipts and
         * sales use the canonical CUSTOMER ledger ("ACME-DR - Sundry
         * Debtor").  Those are the same accounting party, but the legacy
         * JOURNAL ledger is outside the Sundry Debtors hierarchy.  Fold the
         * legacy row into its matching CUSTOMER row for Trial Balance so
         * opening/journal debits and receipt credits are shown together.
         * This is report aggregation only; it does not duplicate postings.
         */
        const normalizePartyLedgerName = (value: unknown) => String(value || "")
            .trim()
            .toUpperCase()
            .replace(/\s*-\s*SUNDRY\s+(DEBTOR|CREDITOR)\s*$/i, "")
            .replace(/\s+/g, " ");
        const roundAmount = (value: number) =>
            Math.round(value * 100) / 100;

        const customerRowsByParty = new Map<string, any>();
        for (const row of consolidatedRawLedgerRows) {
            if (row.ledgerCategory === LedgerType.CUSTOMER) {
                customerRowsByParty.set(
                    `${row.branchId || ""}|${normalizePartyLedgerName(row.account)}`,
                    row
                );
            }
        }

        const legacyJournalRows = new Set<any>();
        for (const row of consolidatedRawLedgerRows) {
            if (row.ledgerCategory !== LedgerType.JOURNAL) continue;
            // Tally Sundry Creditors / Advance From S. Debtors journals are
            // creditor control-head accounts. Folding them into a matching
            // Sundry Debtor customer hides the creditor movement from the
            // group summary even when the same party also has a debtor ledger.
            if (
                tallySundryCreditorGroupIds.has(row.groupId) ||
                advanceFromSDebtorsGroupIds.has(row.groupId) ||
                tallyDutiesGroupIds.has(row.groupId) ||
                tallyUnsecuredLoanGroupIds.has(row.groupId)
            ) continue;

            const target = customerRowsByParty.get(
                `${row.branchId || ""}|${normalizePartyLedgerName(row.account)}`
            );
            if (!target) continue;

            for (const field of [
                "periodDebit",
                "periodCredit",
                "openingDebit",
                "openingCredit",
                "debit",
                "credit",
                "closingDebit",
                "closingCredit"
            ]) {
                target[field] = roundAmount(
                    Number(target[field] || 0) + Number(row[field] || 0)
                );
            }
            target.closingSigned = roundAmount(
                Number(target.closingDebit || 0) - Number(target.closingCredit || 0)
            );
            legacyJournalRows.add(row);
        }

        const normalizedLedgerRows = consolidatedRawLedgerRows.filter(
            row => !legacyJournalRows.has(row)
        );

        /*
         * Older imports stored the Excel Type on Transaction but posted the
         * sale voucher to the generic SALES-* ledger.  Until a ledger repair
         * is run, that left valid heads such as GST SALES invisible in Trial
         * Balance.  Attribute those generic voucher entries to the approved
         * transaction Type at report time.  New imports are already posted to
         * SALES-TYPE-* ledgers and are therefore not included here.
         */
        const typedSaleTransactions = await prisma.transaction.findMany({
            where: {
                status: "APPROVED",
                direction: TransactionDirection.INWARD,
                saleId: { not: null },
                type: { not: null },
                ...(branchId ? { branchId } : {})
            },
            select: {
                saleId: true,
                type: true
            }
        });
        const typeBySaleId = new Map<string, string>();
        const conflictingSaleIds = new Set<string>();

        for (const transaction of typedSaleTransactions) {
            if (!transaction.saleId || !transaction.type) continue;

            const type = String(transaction.type)
                .replace(/_/g, " ")
                .replace(/\bSALE\b/gi, "SALES")
                .replace(/\s*@\s*/g, " @")
                .replace(/\s+/g, " ")
                .trim()
                .toUpperCase();
            const existing = typeBySaleId.get(transaction.saleId);
            if (existing && existing !== type) {
                conflictingSaleIds.add(transaction.saleId);
                continue;
            }
            typeBySaleId.set(transaction.saleId, type);
        }
        for (const saleId of conflictingSaleIds) typeBySaleId.delete(saleId);

        const genericSalesLedgerIds = ledgers
            .filter(ledger =>
                ledger.category === LedgerType.SALES &&
                !String(ledger.code || "").startsWith("SALES-TYPE-")
            )
            .map(ledger => ledger.id);
        const genericTypedSalesEntries =
            typeBySaleId.size > 0 && genericSalesLedgerIds.length > 0
                ? await prisma.ledgerEntry.findMany({
                    where: {
                        AND: [
                            scopedJournalEntryFilter,
                            { ledgerId: { in: genericSalesLedgerIds } },
                            {
                                voucher: {
                                    sourceId: { in: [...typeBySaleId.keys()] },
                                    voucherType: VoucherType.SALE,
                                    voucherDate: { lte: endDate }
                                }
                            }
                        ]
                    },
                    select: {
                        entryType: true,
                        amount: true,
                        voucher: { select: { sourceId: true, voucherDate: true } }
                    }
                })
                : [];
        const salesGroup = ledgerGroups.find(group => group.code === "SALES");
        const typedSalesMovements = new Map<string, {
            prior: { debit: number; credit: number };
            period: { debit: number; credit: number };
        }>();

        for (const entry of genericTypedSalesEntries) {
            const type = typeBySaleId.get(entry.voucher.sourceId);
            if (!type) continue;

            const current = typedSalesMovements.get(type) || {
                prior: { debit: 0, credit: 0 },
                period: { debit: 0, credit: 0 }
            };
            const target = entry.voucher.voucherDate < startDate
                ? current.prior
                : current.period;
            target[entry.entryType === EntryType.DEBIT ? "debit" : "credit"] +=
                Number(entry.amount || 0);
            typedSalesMovements.set(type, current);
        }

        const typedSalesRows = [...typedSalesMovements.entries()].map(
            ([type, movement]) => {
                const amounts = calculateTrialBalanceAmounts(
                    {
                        nature: LedgerNature.CREDIT,
                        openingBalance: 0,
                        openingDebit: 0,
                        openingCredit: 0
                    },
                    movement.prior,
                    movement.period,
                    false
                );

                return {
                    ledgerId: `transaction-type-sales:${type}:${branchId || "all"}`,
                    ledgerCode: `SALES-TYPE-${type}`
                        .replace(/[^A-Z0-9_]+/gi, "_")
                        .toUpperCase(),
                    account: type,
                    parentGroup: salesGroup?.name || "Sales",
                    groupCode: "SALES",
                    groupId: salesGroup?.id || null,
                    ledgerCategory: LedgerType.SALES,
                    ledgerNature: LedgerNature.CREDIT,
                    branchId: branchId || null,
                    branchName: branch?.name || null,
                    debit: amounts.closingDebit,
                    credit: amounts.closingCredit,
                    periodDebit: amounts.periodDebit,
                    periodCredit: amounts.periodCredit,
                    openingDebit: amounts.openingDebit,
                    openingCredit: amounts.openingCredit,
                    closingDebit: amounts.closingDebit,
                    closingCredit: amounts.closingCredit,
                    closingSigned: amounts.closingSigned
                };
            }
        );

        // Existing purchases carry an optional path (Group/Sub Group from
        // Tally). Trial Balance groups those invoices under Purchase
        // Accounts from the stored path and the voucher amounts already in
        // the database. Excel-only voucher numbers are never invented here.
        const remarksClassifiedPurchases = await prisma.purchase.findMany({
            where: {
                ...(branchId ? { branchId } : {}),
                status: PurchaseStatus.APPROVED,
                remarks: { contains: `[[${PURCHASE_SUB_GROUP_MARKER}:` },
                OR: [
                    { path: null },
                    { path: "" }
                ]
            },
            select: {
                invoiceDate: true,
                createdAt: true,
                remarks: true
            }
        });
        // These imported rows are subheads of Purchase Accounts itself. Use
        // its root group rather than the optional legacy PURCHASE child group;
        // otherwise databases without that child lose the rows when the Excel
        // export renders the report tree.
        const purchaseGroup = ledgerGroups.find(group => group.code === "PURCHASE_ACCOUNTS") ||
            ledgerGroups.find(group => group.code === "PURCHASE");
        const purchaseSubGroupMovements = new Map<string, {
            prior: { debit: number; credit: number };
            period: { debit: number; credit: number };
        }>();

        // Approved inward purchase notes without a purchaseId are valid
        // accounting records. They are commonly posted to a JOURNAL
        // adjustment ledger rather than a PURCHASE ledger, so the normal
        // Purchase-category aggregation cannot create their imported
        // category row. Include them directly, except when the voucher
        // already contains a PURCHASE-category entry (which is already
        // represented by the normal ledger aggregation).
        const unlinkedInwardNotes = await prisma.debitCreditNote.findMany({
            where: {
                ...(branchId ? { branchId } : {}),
                sourceType: DebitCreditNoteSourceType.PURCHASE,
                status: DebitCreditNoteStatus.APPROVED,
                categoryPath: { not: null },
                noteDate: { lte: endDate },
                AND: [
                    {
                        OR: [
                            { noteNo: { startsWith: "PDN/" } },
                            { noteNo: { startsWith: "PCN/" } }
                        ]
                    },
                    {
                        OR: [
                            { voucherId: null },
                            {
                                voucher: {
                                    is: {
                                        entries: {
                                            none: {
                                                ledger: {
                                                    category: LedgerType.PURCHASE
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            select: {
                id: true,
                categoryPath: true,
                type: true,
                accountingEntryType: true,
                totalAmount: true,
                noteDate: true
            }
        });

        const pathPurchaseEntries = pathClassifiedPurchaseIds.length > 0
            ? await prisma.ledgerEntry.findMany({
                where: {
                    AND: [
                        scopedJournalEntryFilter,
                        {
                            ledger: { category: LedgerType.PURCHASE },
                            voucher: {
                                sourceId: { in: pathClassifiedPurchaseIds },
                                voucherType: {
                                    in: [
                                        ...PURCHASE_TB_VOUCHER_TYPES,
                                        VoucherType.DEBIT_NOTE,
                                        VoucherType.CREDIT_NOTE
                                    ]
                                },
                                voucherDate: { lte: endDate }
                            }
                        }
                    ]
                },
                select: {
                    entryType: true,
                    amount: true,
                    voucher: { select: { sourceId: true, voucherDate: true } }
                }
            })
            : [];
        const pathByPurchaseId = new Map(
            pathClassifiedPurchases.map(purchase => [purchase.id, purchase.path])
        );

        for (const entry of pathPurchaseEntries) {
            const category = purchaseCategoryFromImportedPath(
                pathByPurchaseId.get(entry.voucher.sourceId) || ""
            );
            if (!category || !PURCHASE_TRIAL_BALANCE_HEADS.has(category)) continue;

            const current = purchaseSubGroupMovements.get(category) || {
                prior: { debit: 0, credit: 0 },
                period: { debit: 0, credit: 0 }
            };
            const target = entry.voucher.voucherDate < startDate
                ? current.prior
                : current.period;
            target[entry.entryType === EntryType.DEBIT ? "debit" : "credit"] +=
                Number(entry.amount || 0);
            purchaseSubGroupMovements.set(category, current);
        }

        for (const purchase of remarksClassifiedPurchases) {
            const purchaseDate = purchase.invoiceDate || purchase.createdAt;
            if (purchaseDate > endDate) continue;

            for (const mapping of readPurchaseSubGroups(purchase.remarks)) {
                const current = purchaseSubGroupMovements.get(mapping.name) || {
                    prior: { debit: 0, credit: 0 },
                    period: { debit: 0, credit: 0 }
                };
                const target = purchaseDate < startDate ? current.prior : current.period;
                target[mapping.entryType === EntryType.DEBIT ? "debit" : "credit"] +=
                    mapping.amount;
                purchaseSubGroupMovements.set(mapping.name, current);
            }
        }

        for (const note of unlinkedInwardNotes) {
            if (categoryNoteIds.has(note.id)) continue;
            const category = purchaseCategoryFromImportedPath(note.categoryPath);
            const amount = Number(note.totalAmount || 0);
            if (!category || !Number.isFinite(amount) || amount === 0) continue;
            if (
                !PURCHASE_TRIAL_BALANCE_HEADS.has(category) ||
                category === "INCENTIVES RECEIVED"
            ) continue;

            const current = purchaseSubGroupMovements.get(category) || {
                prior: { debit: 0, credit: 0 },
                period: { debit: 0, credit: 0 }
            };
            const target = note.noteDate < startDate ? current.prior : current.period;
            const entryType = note.accountingEntryType || (
                note.type === DebitCreditNoteType.CREDIT_NOTE
                    ? EntryType.DEBIT
                    : EntryType.CREDIT
            );

            target[entryType === EntryType.DEBIT ? "debit" : "credit"] += amount;
            purchaseSubGroupMovements.set(category, current);
        }

        const purchaseSubGroupRows = [...purchaseSubGroupMovements.entries()].map(
            ([subGroup, movement]) => {
                const amounts = calculateTrialBalanceAmounts(
                    {
                        nature: LedgerNature.DEBIT,
                        openingBalance: 0,
                        openingDebit: 0,
                        openingCredit: 0
                    },
                    movement.prior,
                    movement.period,
                    false
                );

                return {
                    ledgerId: `purchase-sub-group:${subGroup}:${branchId || "all"}`,
                    ledgerCode: `PURCHASE-SUB-GROUP-${subGroup}`
                        .replace(/[^A-Z0-9_]+/gi, "_")
                        .toUpperCase(),
                    account: subGroup,
                    parentGroup: purchaseGroup?.name || "Purchase Accounts",
                    groupCode: purchaseGroup?.code || "PURCHASE_ACCOUNTS",
                    groupId: purchaseGroup?.id || null,
                    ledgerCategory: LedgerType.PURCHASE,
                    ledgerNature: LedgerNature.DEBIT,
                    branchId: branchId || null,
                    branchName: branch?.name || null,
                    debit: amounts.closingDebit,
                    credit: amounts.closingCredit,
                    periodDebit: amounts.periodDebit,
                    periodCredit: amounts.periodCredit,
                    openingDebit: amounts.openingDebit,
                    openingCredit: amounts.openingCredit,
                    closingDebit: amounts.closingDebit,
                    closingCredit: amounts.closingCredit,
                    closingSigned: amounts.closingSigned,
                    isPurchaseSubGroup: true
                };
            }
        );

        // Categorized outward notes are Sales Accounts movement even when
        // their voucher is a DEBIT_NOTE/CREDIT_NOTE rather than a SALE
        // voucher. Include them from the approved note record itself so the
        // imported category (for example Sales Accounts / GST SALES) is not
        // lost by the normal SALE-voucher ledger filter.
        const categorizedOutwardSaleNotes = await prisma.debitCreditNote.findMany({
            where: {
                ...(branchId ? { branchId } : {}),
                sourceType: DebitCreditNoteSourceType.SALE,
                status: DebitCreditNoteStatus.APPROVED,
                categoryPath: { not: null },
                noteDate: { lte: endDate }
            },
            select: {
                categoryPath: true,
                type: true,
                totalAmount: true,
                noteDate: true,
                voucher: {
                    select: {
                        entries: {
                            select: {
                                ledger: {
                                    select: { code: true, name: true, category: true }
                                }
                            }
                        }
                    }
                }
            }
        });
        const salesSubGroupMovements = new Map<string, {
            prior: { debit: number; credit: number };
            period: { debit: number; credit: number };
        }>();

        for (const note of categorizedOutwardSaleNotes) {
            const category = salesCategoryFromImportedPath(note.categoryPath);
            if (!category) continue;

            const alreadyOnTypedSales = note.voucher?.entries.some(entry =>
                entry.ledger.category === LedgerType.SALES &&
                String(entry.ledger.code || "").startsWith("SALES-TYPE-") &&
                String(entry.ledger.name || "")
                    .replace(/_/g, " ")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toUpperCase() === category
            );
            if (alreadyOnTypedSales) continue;

            const amount = Number(note.totalAmount || 0);
            if (!Number.isFinite(amount) || amount === 0) continue;

            const current = salesSubGroupMovements.get(category) || {
                prior: { debit: 0, credit: 0 },
                period: { debit: 0, credit: 0 }
            };
            const target = note.noteDate < startDate ? current.prior : current.period;

            // Sale debit note: Dr customer / Cr sales adjustment.
            // Sale credit note: Dr sales adjustment / Cr customer.
            target[note.type === DebitCreditNoteType.DEBIT_NOTE ? "credit" : "debit"] += amount;
            salesSubGroupMovements.set(category, current);
        }

        const salesSubGroupRows = [...salesSubGroupMovements.entries()].map(
            ([subGroup, movement]) => {
                const amounts = calculateTrialBalanceAmounts(
                    {
                        nature: LedgerNature.CREDIT,
                        openingBalance: 0,
                        openingDebit: 0,
                        openingCredit: 0
                    },
                    movement.prior,
                    movement.period,
                    false
                );

                return {
                    ledgerId: `sales-sub-group:${subGroup}:${branchId || "all"}`,
                    ledgerCode: `SALES-SUB-GROUP-${subGroup}`
                        .replace(/[^A-Z0-9_]+/gi, "_")
                        .toUpperCase(),
                    account: subGroup,
                    parentGroup: salesGroup?.name || "Sales",
                    groupCode: "SALES",
                    groupId: salesGroup?.id || null,
                    ledgerCategory: LedgerType.SALES,
                    ledgerNature: LedgerNature.CREDIT,
                    branchId: branchId || null,
                    branchName: branch?.name || null,
                    debit: amounts.closingDebit,
                    credit: amounts.closingCredit,
                    periodDebit: amounts.periodDebit,
                    periodCredit: amounts.periodCredit,
                    openingDebit: amounts.openingDebit,
                    openingCredit: amounts.openingCredit,
                    closingDebit: amounts.closingDebit,
                    closingCredit: amounts.closingCredit,
                    closingSigned: amounts.closingSigned,
                    isSalesSubGroup: true
                };
            }
        );

        // Purchase and sales accounts display only explicit imported Types.
        // The generic branch ledgers (for example
        // "Purchase - AG_ASHTAVINAYAKA_PETROCHEM_MH") are legacy control
        // ledgers, not accounting heads, and must not create a separate
        // "Purchase" or "Sales" row in the Trial Balance.
        const aggregateAccountRows = (category: LedgerType) => {
            const sourceRows = consolidatedRawLedgerRows.filter(
                row => row.ledgerCategory === category &&
                    !CUSTOM_TRIAL_BALANCE_GROUP_CODES.has(
                        String(row.groupCode || "").toUpperCase()
                    )
            );

            if (sourceRows.length === 0) return [];

            const groupCode = category === LedgerType.PURCHASE
                ? "PURCHASE_ACCOUNTS"
                : "SALES";
            const group = category === LedgerType.PURCHASE
                ? ledgerGroups.find(item => item.code === "PURCHASE_ACCOUNTS") ||
                    ledgerGroups.find(item => item.code === "PURCHASE")
                : ledgerGroups.find(item => item.code === groupCode);
            const grouped = new Map<string, any[]>();

            const genericHead = category === LedgerType.PURCHASE
                ? "PURCHASE"
                : "SALES";

            for (const row of sourceRows) {
                const code = String(row.ledgerCode || "").toUpperCase();
                const account = String(row.account || "").trim();
                const isTyped = category === LedgerType.PURCHASE
                    ? code.startsWith("PURCHASE-TYPE-") ||
                        /^(?:IGST|GST|CST|DISCOUNT|HIGH SEAS|IMPORT|VAT|INTEREST)\s+PURCHASE(?:\s+-|$)/i.test(account)
                    : code.startsWith("SALES-TYPE-") ||
                        /^(?:IGST|GST|CST|DISCOUNT|EXPORT|INTERSTATE|LOCAL)\s+SALES(?:\s+-|\s+@|$)/i.test(account);

                if (!isTyped) continue;

                const head = account.replace(/\s+-\s+[^-]+$/, "").trim();
                if (head.toUpperCase() === genericHead) continue;

                const rowsForHead = grouped.get(head) || [];
                rowsForHead.push(row);
                grouped.set(head, rowsForHead);
            }

            return [...grouped.entries()].map(([head, rowsForHead]) => {
                const sum = (key: string) => Number(
                    rowsForHead
                        .reduce((total, row) => total + Number(row[key] || 0), 0)
                        .toFixed(2)
                );
                return {
                    ...rowsForHead[0],
                    ledgerId: `aggregate:${category}:${head}:${branchId || "all"}`,
                    ledgerCode: `${groupCode}_TYPE_${head}_TOTAL`
                        .replace(/[^A-Z0-9_]+/gi, "_")
                        .toUpperCase(),
                    account: head,
                    parentGroup: group?.name || head,
                    groupCode,
                    groupId: group?.id || rowsForHead[0].groupId,
                    ledgerCategory: category,
                    ledgerNature: category === LedgerType.PURCHASE
                        ? LedgerNature.DEBIT
                        : LedgerNature.CREDIT,
                    branchId: branchId || null,
                    branchName: branch?.name || null,
                    periodDebit: sum("periodDebit"),
                    periodCredit: sum("periodCredit"),
                    openingDebit: sum("openingDebit"),
                    openingCredit: sum("openingCredit"),
                    debit: sum("closingDebit"),
                    credit: sum("closingCredit"),
                    closingDebit: sum("closingDebit"),
                    closingCredit: sum("closingCredit"),
                    closingSigned: sum("closingSigned")
                };
            });
        };

        // A category can receive movement from both normal Purchase entries
        // and an approved inward debit/credit note. Present one category row
        // in Trial Balance, with turnover kept on its original Dr/Cr side and
        // the closing columns netted in the normal accounting manner.
        const mergePurchaseAccountRows = (sourceRows: any[]) => {
            const grouped = new Map<string, any[]>();
            for (const row of sourceRows) {
                const key = String(row.account || "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toUpperCase();
                if (!key || PURCHASE_NOTE_ADJUSTMENT_HEADS.has(key)) continue;
                grouped.set(key, [...(grouped.get(key) || []), row]);
            }

            return [...grouped.entries()].map(([key, rowsForCategory]) => {
                const sum = (field: string) => Number(rowsForCategory
                    .reduce((total, row) => total + Number(row[field] || 0), 0)
                    .toFixed(2));
                const openingSigned = Number((sum("openingDebit") - sum("openingCredit")).toFixed(2));
                const closingSigned = sum("closingSigned");
                const first = rowsForCategory[0];
                const realLedgerIds = [...new Set(
                    rowsForCategory
                        .map(row => String(row.ledgerId || ""))
                        .filter(id => id && !id.startsWith("aggregate:") && !id.startsWith("purchase-sub-group:"))
                )];

                return {
                    ...first,
                    // Keep the real ledger id when the category maps to one
                    // ledger. This makes Purchase Accounts subheads clickable
                    // and lets the voucher drawer load their entries.
                    ledgerId: realLedgerIds.length === 1
                        ? realLedgerIds[0]
                        : `aggregate:purchase-account:${key}:${branchId || "all"}`,
                    ledgerCode: `PURCHASE_ACCOUNT_${key}`
                        .replace(/[^A-Z0-9_]+/gi, "_")
                        .toUpperCase(),
                    account: first.account,
                    periodDebit: sum("periodDebit"),
                    periodCredit: sum("periodCredit"),
                    openingDebit: openingSigned > 0 ? openingSigned : 0,
                    openingCredit: openingSigned < 0 ? Math.abs(openingSigned) : 0,
                    debit: closingSigned > 0 ? closingSigned : 0,
                    credit: closingSigned < 0 ? Math.abs(closingSigned) : 0,
                    closingDebit: closingSigned > 0 ? closingSigned : 0,
                    closingCredit: closingSigned < 0 ? Math.abs(closingSigned) : 0,
                    closingSigned
                };
            });
        };

        // DISCOUNT is stored as a JOURNAL ledger in some imports while the
        // remaining purchase heads use PURCHASE ledgers. Feed that journal
        // ledger into the same category merge so only one DISCOUNT row is
        // rendered.
        const purchaseJournalRows = normalizedLedgerRows.filter(row =>
            String(row.groupCode || "").toUpperCase() === "PURCHASE_ACCOUNTS" &&
            row.ledgerCategory === LedgerType.JOURNAL &&
            PURCHASE_TRIAL_BALANCE_HEADS.has(
                String(row.account || "").replace(/\s+/g, " ").trim().toUpperCase()
            )
        );

        const purchaseAccountRows = mergePurchaseAccountRows([
            ...aggregateAccountRows(LedgerType.PURCHASE),
            ...purchaseJournalRows,
            ...purchaseSubGroupRows
        ]).filter(row => PURCHASE_TRIAL_BALANCE_HEADS.has(
            String(row.account || "").replace(/\s+/g, " ").trim().toUpperCase()
        ));

        const mergeSalesAccountRows = (sourceRows: any[]) => {
            const salesRoot = ledgerGroups.find(group => group.code === "SALES_ACCOUNTS") ||
                ledgerGroups.find(group => group.code === "SALES");
            const grouped = new Map<string, any[]>();
            for (const row of sourceRows) {
                const key = String(row.account || "").replace(/\s+/g, " ").trim().toUpperCase();
                if (!key || SALES_NOTE_ADJUSTMENT_HEADS.has(key)) continue;
                grouped.set(key, [...(grouped.get(key) || []), row]);
            }

            return [...grouped.entries()].map(([key, rowsForCategory]) => {
                const sum = (field: string) => Number(rowsForCategory
                    .reduce((total, row) => total + Number(row[field] || 0), 0)
                    .toFixed(2));
                const openingSigned = sum("openingDebit") - sum("openingCredit");
                const closingSigned = sum("closingSigned");
                const first = rowsForCategory[0];

                return {
                    ...first,
                    ledgerId: `aggregate:sales-account:${key}:${branchId || "all"}`,
                    ledgerCode: `SALES_ACCOUNT_${key}`.replace(/[^A-Z0-9_]+/gi, "_").toUpperCase(),
                    parentGroup: salesRoot?.name || "Sales Accounts",
                    groupCode: salesRoot?.code || "SALES_ACCOUNTS",
                    groupId: salesRoot?.id || null,
                    periodDebit: sum("periodDebit"),
                    periodCredit: sum("periodCredit"),
                    openingDebit: openingSigned > 0 ? openingSigned : 0,
                    openingCredit: openingSigned < 0 ? Math.abs(openingSigned) : 0,
                    debit: closingSigned > 0 ? closingSigned : 0,
                    credit: closingSigned < 0 ? Math.abs(closingSigned) : 0,
                    closingDebit: closingSigned > 0 ? closingSigned : 0,
                    closingCredit: closingSigned < 0 ? Math.abs(closingSigned) : 0,
                    closingSigned
                };
            });
        };

        const salesAccountRows = mergeSalesAccountRows([
            ...aggregateAccountRows(LedgerType.SALES),
            ...typedSalesRows,
            ...salesSubGroupRows
        ]);

        const ledgerRows = [
            ...normalizedLedgerRows.filter(row =>
                row.ledgerCategory !== LedgerType.PURCHASE &&
                row.ledgerCategory !== LedgerType.SALES ||
                CUSTOM_TRIAL_BALANCE_GROUP_CODES.has(
                    String(row.groupCode || "").toUpperCase()
                )
            ).filter(row => !(
                String(row.groupCode || "").toUpperCase() === "PURCHASE_ACCOUNTS" &&
                row.ledgerCategory === LedgerType.JOURNAL &&
                PURCHASE_TRIAL_BALANCE_HEADS.has(
                    String(row.account || "").replace(/\s+/g, " ").trim().toUpperCase()
                )
            )).filter(row => {
                const key = String(row.account || "").replace(/\s+/g, " ").trim().toUpperCase();
                return !SALES_NOTE_ADJUSTMENT_HEADS.has(key) &&
                    !PURCHASE_NOTE_ADJUSTMENT_HEADS.has(key);
            }),
            ...purchaseAccountRows,
            ...salesAccountRows
        ];

        const debtorRows = ledgerRows.filter(row =>
            String(row.groupCode || "").toUpperCase() === "SUNDRY_DEBTORS"
        );
        const allowedDebtorRows = debtorRows.filter(row =>
            TALLY_SUNDRY_DEBTOR_ALLOWLIST.has(
                normalizeTallySundryDebtorName(row.account)
            )
        );
        // Only Tally-listed debtor ledgers belong in this report. Excluding
        // the others here also keeps their balances out of group totals.
        const rawRows = [
            ...ledgerRows.filter(row =>
                String(row.groupCode || "").toUpperCase() !== "SUNDRY_DEBTORS"
            ),
            ...allowedDebtorRows
        ];

        const cashDiagnostics = await this.getCashDiagnostics(
            ledgers,
            scopedJournalEntryFilter,
            startDate,
            endDate,
            rawRows
        );

        // Keep cash ledgers separate. Netting multiple cash balances before
        // splitting Dr/Cr understates both sides and also detaches the
        // synthetic row from the LedgerGroup hierarchy.
        let consolidatedRows = rawRows;

        const groupById = new Map(ledgerGroups.map(group => [group.id, group]));
        const groupByCode = new Map(ledgerGroups.map(group => [group.code, group]));
        const duplicateDisplayGroupById = buildDuplicateLedgerGroupDisplayMap(
            ledgerGroups,
            ledgers.map(ledger => ({ groupId: ledger.groupId, name: ledger.name }))
        );

        // Treat the legacy singular branch as the same report head as the
        // canonical Tally-style "Indirect Expenses" branch.
        const indirectExpensesGroup = ledgerGroups.find(group =>
            String(group.name).trim().replace(/\s+/g, " ").toLowerCase() === "indirect expenses" &&
            !group.parentId
        );
        const indirectExpenseGroup = ledgerGroups.find(group =>
            String(group.name).trim().replace(/\s+/g, " ").toLowerCase() === "indirect expense"
        );
        if (indirectExpensesGroup && indirectExpenseGroup) {
            duplicateDisplayGroupById.set(indirectExpenseGroup.id, indirectExpensesGroup.id);
        }

        // Merge the singular system group with the imported Tally group so
        // "Indirect Income" and "Indirect Incomes" are rendered as one head.
        const indirectIncomesGroup = ledgerGroups.find(group =>
            String(group.name).trim().replace(/\s+/g, " ").toLowerCase() === "indirect incomes" &&
            !group.parentId
        );
        const indirectIncomeGroup = ledgerGroups.find(group =>
            String(group.name).trim().replace(/\s+/g, " ").toLowerCase() === "indirect income"
        );
        if (indirectIncomesGroup && indirectIncomeGroup) {
            duplicateDisplayGroupById.set(indirectIncomeGroup.id, indirectIncomesGroup.id);
        }

        const displayGroupId = (id: string) => {
            let current = id;
            const seen = new Set<string>();
            while (duplicateDisplayGroupById.has(current) && !seen.has(current)) {
                seen.add(current);
                current = duplicateDisplayGroupById.get(current)!;
            }
            return current;
        };

        const normalizeTrialBalanceName = (value: unknown) =>
            String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

        // When duplicate groups have different contents, keep the group
        // containing real child accounts as the displayed heading. This
        // prevents an opening-only same-name ledger from becoming the
        // canonical group and hiding the populated creditor hierarchy.
        const duplicateSiblingGroups = new Map<string, LedgerGroupReportRow[]>();
        for (const group of ledgerGroups) {
            const parentId = group.parentId ? displayGroupId(group.parentId) : "ROOT";
            const key = `${parentId}|${normalizeTrialBalanceName(group.name)}`;
            const siblings = duplicateSiblingGroups.get(key) || [];
            siblings.push(group);
            duplicateSiblingGroups.set(key, siblings);
        }
        for (const siblings of duplicateSiblingGroups.values()) {
            if (siblings.length < 2) continue;
            const distinctLedgerCount = (group: LedgerGroupReportRow) => ledgers.filter(ledger =>
                ledger.groupId === group.id &&
                normalizeTrialBalanceName(ledger.name) !== normalizeTrialBalanceName(group.name)
            ).length;
            const populated = [...siblings].sort((a, b) => {
                return distinctLedgerCount(b) - distinctLedgerCount(a) || a.id.localeCompare(b.id);
            });
            if (distinctLedgerCount(populated[0]) === 0) continue;
            const winner = populated[0];
            for (const group of siblings) {
                if (group.id === winner.id) duplicateDisplayGroupById.delete(group.id);
                else duplicateDisplayGroupById.set(group.id, winner.id);
            }
        }

        // The Advance Salary ledger is the posting account from the source
        // ledger register. Give it a visible head in the Trial Balance even
        // when an import placed the ledger directly under Loans & Advances.
        // Its child rows remain the ledger's actual voucher-derived balances.
        const loansAndAdvancesGroup = ledgerGroups.find(group =>
            normalizeTrialBalanceName(group.name) === "loans & advances (asset)"
        );
        const advanceSalaryLedgerIds = new Set(
            ledgers
                .filter(ledger => normalizeTrialBalanceName(ledger.name) === "advance salary")
                .map(ledger => ledger.id)
        );
        let advanceSalaryGroup = loansAndAdvancesGroup
            ? ledgerGroups.find(group =>
                normalizeTrialBalanceName(group.name) === "advance salary" &&
                displayGroupId(group.parentId || "") === displayGroupId(loansAndAdvancesGroup.id)
            )
            : undefined;

        if (loansAndAdvancesGroup && advanceSalaryLedgerIds.size > 0 && !advanceSalaryGroup) {
            advanceSalaryGroup = {
                id: "REPORT_ADVANCE_SALARY",
                code: "REPORT_ADVANCE_SALARY",
                name: "Advance Salary",
                parentId: displayGroupId(loansAndAdvancesGroup.id)
            };
            ledgerGroups.push(advanceSalaryGroup);
            groupById.set(advanceSalaryGroup.id, advanceSalaryGroup);
        }

        if (advanceSalaryGroup) {
            // The repeated ledger name is expected here: Advance Salary is
            // the head and the ledger register is its only voucher-bearing
            // child. Keep this group from the generic redundant-name flatten.
            duplicateDisplayGroupById.delete(advanceSalaryGroup.id);
            consolidatedRows = consolidatedRows.map(row =>
                advanceSalaryLedgerIds.has(row.ledgerId)
                    ? {
                        ...row,
                        groupId: advanceSalaryGroup!.id,
                        groupCode: advanceSalaryGroup!.code,
                        parentGroup: advanceSalaryGroup!.name
                    }
                    : row
            );
        }

        // Imported Tally loan groups can contain a second copy of the same
        // group (for example Loans (Liability) > Secured Loans > Secured
        // Loans). Some of those copies also repeat their child groups under
        // the duplicate parent. Flatten those repeated headings in this
        // report while retaining every ledger row and its balance.
        const normalizeDisplayGroupName = (name: string) =>
            String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
        const groupDepth = (group: LedgerGroupReportRow) => {
            let depth = 0;
            let current: LedgerGroupReportRow | undefined = group;
            const seen = new Set<string>();
            while (current?.parentId && !seen.has(current.id)) {
                seen.add(current.id);
                depth += 1;
                current = groupById.get(current.parentId);
            }
            return depth;
        };
        const isUnderImportedLoansLiability = (group: LedgerGroupReportRow) => {
            let current: LedgerGroupReportRow | undefined = group;
            const seen = new Set<string>();
            while (current && !seen.has(current.id)) {
                if (
                    current.code.startsWith("JRNIMP-") &&
                    normalizeDisplayGroupName(current.name) === "loans (liability)"
                ) return true;
                seen.add(current.id);
                current = current.parentId ? groupById.get(current.parentId) : undefined;
            }
            return false;
        };

        const importedLoanGroups = ledgerGroups
            .filter(isUnderImportedLoansLiability)
            .sort((a, b) => groupDepth(a) - groupDepth(b) || a.id.localeCompare(b.id));
        const displayedLoanSiblings = new Map<string, string>();
        for (const group of importedLoanGroups) {
            const parent = group.parentId ? groupById.get(group.parentId) : undefined;
            if (!parent) continue;

            const canonicalParentId = displayGroupId(parent.id);
            const groupName = normalizeDisplayGroupName(group.name);
            if (groupName === normalizeDisplayGroupName(parent.name)) {
                duplicateDisplayGroupById.set(group.id, canonicalParentId);
                continue;
            }

            const siblingKey = `${canonicalParentId}|${groupName}`;
            const canonicalSiblingId = displayedLoanSiblings.get(siblingKey);
            if (canonicalSiblingId) {
                duplicateDisplayGroupById.set(group.id, canonicalSiblingId);
            } else {
                displayedLoanSiblings.set(siblingKey, displayGroupId(group.id));
            }
        }

        // Journal-register imports produced duplicate Bank Accounts headings.
        // Map those headings to the canonical Current Assets / Bank Accounts
        // group so Tally's single hierarchy is represented in the report.
        const currentAssetsGroupIds = new Set(
            ledgerGroups
                .filter(group => String(group.name).trim().toUpperCase() === "CURRENT ASSETS")
                .map(group => group.id)
        );
        const bankAccountsRootGroups = ledgerGroups.filter(group =>
            String(group.name).trim().toUpperCase() === "BANK ACCOUNTS" &&
            group.parentId !== null &&
            currentAssetsGroupIds.has(group.parentId)
        );
        const canonicalBankAccountsGroup = bankAccountsRootGroups.find(group => group.code === "BANK_ACCOUNTS") ||
            bankAccountsRootGroups[0];
        if (canonicalBankAccountsGroup) {
            // Earlier duplicate resolution may have chosen the imported
            // heading because it contains more direct ledgers. Break that
            // alias first so the following assignments cannot create a
            // two-node cycle between the imported and canonical headings.
            duplicateDisplayGroupById.delete(canonicalBankAccountsGroup.id);
            const rootIds = new Set(bankAccountsRootGroups.map(group => group.id));
            for (const group of bankAccountsRootGroups) {
                if (group.id !== canonicalBankAccountsGroup.id) {
                    duplicateDisplayGroupById.set(group.id, canonicalBankAccountsGroup.id);
                }
            }
            for (const group of ledgerGroups) {
                if (
                    String(group.name).trim().toUpperCase() === "BANK ACCOUNTS" &&
                    group.parentId !== null &&
                    rootIds.has(group.parentId)
                ) {
                    duplicateDisplayGroupById.set(group.id, canonicalBankAccountsGroup.id);
                }
            }
        }
        // Sundry Creditors remains a collapsed control head. Sundry Debtors
        // stays expanded so the Tally-listed agency ledgers are leaf rows.
        const collapsedGroupIds = new Set<string>();
        const collapsedRowsByGroup = new Map<string, Map<string, any[]>>();

        for (const group of ledgerGroups) {
            let current: LedgerGroupReportRow | undefined = group;

            while (current) {
                if (COLLAPSED_TRIAL_BALANCE_GROUP_CODES.has(current.code)) {
                    collapsedGroupIds.add(group.id);
                    break;
                }

                current = current.parentId
                    ? groupById.get(current.parentId)
                    : undefined;
            }
        }

        for (const row of consolidatedRows) {
            let current = row.groupId
                ? groupById.get(row.groupId)
                : undefined;

            while (current) {
                if (COLLAPSED_TRIAL_BALANCE_GROUP_CODES.has(current.code)) {
                    const rowsForGroup = collapsedRowsByGroup.get(current.id) || new Map<string, any[]>();
                    // A branch can contain duplicate legacy ledgers for the
                    // same agency. Merge them so opening balance, movement,
                    // and closing balance are shown in one agency row.
                    const agencyKey = row.agencyId || row.ledgerId;
                    const rowsForAgency = rowsForGroup.get(agencyKey) || [];
                    rowsForAgency.push(row);
                    rowsForGroup.set(agencyKey, rowsForAgency);
                    collapsedRowsByGroup.set(current.id, rowsForGroup);
                    break;
                }

                current = current.parentId
                    ? groupById.get(current.parentId)
                    : undefined;
            }
        }

        const collapsedSummaryRows = [...collapsedRowsByGroup.entries()]
            .flatMap(([groupId, rowsByAgency]) => [...rowsByAgency.values()].map(sourceRows => {
                const group = groupById.get(groupId);
                if (!group || sourceRows.length === 0) return null;

                const sum = (key: string) => Number(
                    sourceRows
                        .reduce((total, row) => total + Number(row[key] || 0), 0)
                        .toFixed(2)
                );

                // A number of older journal imports created a JOURNAL ledger
                // for the same party as the canonical CUSTOMER ledger. The
                // duplicate opening voucher is suppressed above; exclude
                // only those confirmed duplicate ledgers from the control
                // opening columns. Other JOURNAL ledgers in this group may
                // have legitimate opening balances and must remain included.
                const openingRows = sourceRows.filter(row =>
                    !duplicateLegacyOpeningLedgerIds.has(row.ledgerId)
                );
                const sumOpening = (key: string) => Number(
                    openingRows
                        .reduce((total, row) => total + Number(row[key] || 0), 0)
                        .toFixed(2)
                );

                return {
                    ...sourceRows[0],
                    ledgerId: `aggregate:ledger-group:${group.code}:${branchId || "all"}`,
                    ledgerCode: `LEDGER_GROUP_${group.code}_${sourceRows[0].agencyId || sourceRows[0].ledgerId}`,
                    account: sourceRows[0].agencyName || sourceRows[0].account,
                    parentGroup: group.name,
                    groupCode: group.code,
                    groupId: group.id,
                    periodDebit: sum("periodDebit"),
                    periodCredit: sum("periodCredit"),
                    openingDebit: sumOpening("openingDebit"),
                    openingCredit: sumOpening("openingCredit"),
                    debit: sum("closingDebit"),
                    credit: sum("closingCredit"),
                    closingDebit: sum("closingDebit"),
                    closingCredit: sum("closingCredit"),
                    closingSigned: sum("closingSigned"),
                    isCollapsedTrialBalanceGroup: true
                };
            }))
            .filter(Boolean) as any[];
        const collapsedSummaryGroupIds = new Set(
            collapsedSummaryRows.map(row => row.groupId)
        );

        const collapsedSourceLedgerIds = new Set(
            [...collapsedRowsByGroup.values()]
                .flatMap(rowsByAgency => [...rowsByAgency.values()].flat())
                .map(row => row.ledgerId)
        );

        const trialBalanceRows = [
            ...consolidatedRows.filter(row => !collapsedSourceLedgerIds.has(row.ledgerId)),
            ...collapsedSummaryRows
        ];

        // The report hierarchy follows the LedgerGroup tree.  This is the
        // same expandable structure shown by Tally: accounting head -> group
        // -> ledger, rather than a flat list of ledger balances.
        const rowsWithHierarchy = trialBalanceRows.map(row => {
            const sourceGroup = row.groupId
                ? groupById.get(row.groupId)
                : groupByCode.get(String(row.groupCode || ""));
            const displayId = sourceGroup ? displayGroupId(sourceGroup.id) : undefined;
            let group = displayId ? groupById.get(displayId) : sourceGroup;

            // If an account has a matching child group, show its balance in
            // that child group. This handles imported structures such as
            // Factory Building -> Factory Assets where the ledger was
            // attached to the parent group instead of the named child.
            if (group && row.ledgerCategory === LedgerType.JOURNAL) {
                const normalizedAccount = normalizedName(row.account);
                const matchingChild = ledgerGroups.find(candidate =>
                    candidate.parentId === group!.id &&
                    normalizedName(candidate.name) === normalizedAccount
                );
                if (matchingChild) group = matchingChild;
            }
            // Nested "Sundry Creditors > Sundry Creditors" is aliased away.
            // Re-resolve after the child-group match so those ledgers still
            // attach to the visible Current Liabilities heading.
            if (group) {
                const displayedId = displayGroupId(group.id);
                group = groupById.get(displayedId) || group;
            }
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
                if (branchId === TALLY_BANK_ACCOUNT_BRANCH_ID) {
                    let group = row.groupId ? groupById.get(row.groupId) : undefined;
                    while (group) {
                        if (group.code === "BANK_ACCOUNTS" ||
                            String(group.name).trim().toUpperCase() === "BANK ACCOUNTS") {
                            if (!TALLY_BANK_ACCOUNT_ALLOWLIST.has(
                                normalizeTallyBankAccountName(row.account)
                            )) return false;
                            break;
                        }
                        group = group.parentId ? groupById.get(group.parentId) : undefined;
                    }
                }

                const isImportedCurrentAssetsPlaceholder =
                    String(row.groupCode || "").toUpperCase() === "CURRENT_ASSETS" &&
                    normalizeTallySundryDebtorName(row.account) === "CURRENTASSETS";

                // This imported control ledger duplicates the Current Assets
                // group total. Hide it and exclude its balance from the tree.
                if (isImportedCurrentAssetsPlaceholder) {
                    return false;
                }

                if (query?.includeZero) return true;
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

        // The seeded Liabilities > Sundry Creditors tree is an operational
        // vendor copy. Tally's group summary lives under Current Liabilities.
        const hiddenTrialBalanceGroupIds = new Set<string>();
        const systemLiabilitiesRoot = ledgerGroups.find(group => group.code === "LIABILITIES");
        if (systemLiabilitiesRoot) {
            hiddenTrialBalanceGroupIds.add(systemLiabilitiesRoot.id);
            let hasHiddenChild = true;
            while (hasHiddenChild) {
                hasHiddenChild = false;
                for (const group of ledgerGroups) {
                    if (
                        group.parentId &&
                        hiddenTrialBalanceGroupIds.has(group.parentId) &&
                        !hiddenTrialBalanceGroupIds.has(group.id)
                    ) {
                        hiddenTrialBalanceGroupIds.add(group.id);
                        hasHiddenChild = true;
                    }
                }
            }
        }

        const treeNodes = new Map<string, any>();
        for (const group of ledgerGroups) {
            if (displayGroupId(group.id) !== group.id) continue;
            if (hiddenTrialBalanceGroupIds.has(group.id)) continue;
            if (!query?.includeZero && !visibleGroupIds.has(group.id)) continue;
            if (
                collapsedGroupIds.has(group.id) &&
                !collapsedSummaryGroupIds.has(group.id)
            ) continue;

            treeNodes.set(group.id, {
                id: `group:${group.id}`,
                groupId: group.id,
                code: group.code,
                name: group.name,
                rowType: "accountingHeader",
                parentId: group.parentId ? `group:${displayGroupId(group.parentId)}` : null,
                level: 0,
                periodDebit: 0,
                periodCredit: 0,
                openingDebit: 0,
                openingCredit: 0,
                closingDebit: 0,
                closingCredit: 0,
                closingSigned: 0,
                children: []
            });
        }

        for (const summary of collapsedSummaryRows) {
            const groupNode = treeNodes.get(summary.groupId);
            if (!groupNode) continue;

            groupNode.periodDebit = summary.periodDebit;
            groupNode.periodCredit = summary.periodCredit;
            groupNode.closingDebit = summary.closingDebit;
            groupNode.closingCredit = summary.closingCredit;
            groupNode.closingSigned = summary.closingSigned;
            groupNode.closingBalance = Math.abs(summary.closingSigned);
            groupNode.closingBalanceType = summary.closingSigned > 0
                ? "Dr"
                : summary.closingSigned < 0
                    ? "Cr"
                    : null;
            groupNode.hasChildren = false;
            groupNode.isCollapsedTrialBalanceGroup = true;
        }

        for (const row of rows) {
            const groupNode = row.groupId ? treeNodes.get(row.groupId) : undefined;
            if (!groupNode) continue;
            if (row.isCollapsedTrialBalanceGroup) continue;
            if (row.groupId && hiddenTrialBalanceGroupIds.has(row.groupId)) continue;
            const repeatedHeading = normalizedName(row.account) === normalizedName(groupNode.name)
                && [
                    "CURRENT LIABILITIES",
                    "SUNDRY CREDITORS",
                    "LIABILITIES",
                    "DUTIES & TAXES",
                    "GST",
                    "GST PAYABLE",
                    "INPUT GST",
                    "OUTPUT GST",
                    "TCS",
                    "TDS",
                    "RCM",
                    "CASH LEDGER"
                ].includes(normalizedName(groupNode.name));
            if (repeatedHeading) continue;
            groupNode.children.push({
                ...row,
                id: `ledger:${row.ledgerId || row.ledgerCode}`,
                // Tree consumers use `name`/`code`; the flat report row uses
                // `account`/`ledgerCode`. Keep both shapes populated so the
                // UI never falls back to displaying a ledger UUID.
                name: row.account,
                account: row.account,
                code: row.ledgerCode,
                ledgerId: row.ledgerId,
                parentId: groupNode.id,
                level: 0,
                hasChildren: false,
                children: []
            });
        }

        const rootNodes: any[] = [];
        for (const node of treeNodes.values()) {
            const parent = node.parentId ? treeNodes.get(node.parentId.replace("group:", "")) : undefined;
            if (parent) {
                if (normalizedName(node.name) === normalizedName(parent.name)) {
                    for (const child of node.children || []) {
                        child.parentId = parent.id;
                        parent.children.push(child);
                    }
                    continue;
                }
                parent.children.push(node);
            }
            else rootNodes.push(node);
        }

        // Tally presents Direct Expenses and Indirect Expenses as the two
        // expense heads. The generic Expenses container is only an internal
        // parent group and must not be rendered as a third trial-balance head.
        const expenseContainerIndex = rootNodes.findIndex(
            node => String(node.name || "").trim().toLowerCase() === "expenses"
        );
        if (expenseContainerIndex >= 0) {
            const [expenseContainer] = rootNodes.splice(expenseContainerIndex, 1);
            for (const child of expenseContainer.children || []) {
                child.parentId = null;
                rootNodes.push(child);
            }
        }

        // Tally presents Indirect Income as the report head.  Income is only
        // the generic internal parent for that branch and must not be shown
        // as a separate trial-balance head.
        const incomeContainerIndex = rootNodes.findIndex(
            node => String(node.name || "").trim().toLowerCase() === "income"
        );
        if (incomeContainerIndex >= 0) {
            const [incomeContainer] = rootNodes.splice(incomeContainerIndex, 1);
            for (const child of incomeContainer.children || []) {
                child.parentId = null;
                rootNodes.push(child);
            }
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
                node.openingDebit += Number(child.openingDebit || 0);
                node.openingCredit += Number(child.openingCredit || 0);
                node.closingDebit += Number(child.closingDebit || 0);
                node.closingCredit += Number(child.closingCredit || 0);
                node.closingSigned += Number(child.closingSigned || 0);
            }

            node.periodDebit = Number(node.periodDebit.toFixed(2));
            node.periodCredit = Number(node.periodCredit.toFixed(2));
            node.openingDebit = Number(Number(node.openingDebit || 0).toFixed(2));
            node.openingCredit = Number(Number(node.openingCredit || 0).toFixed(2));
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
         * 11. SUMMARY / GRAND TOTAL
         * ============================================================
         *
         * Grand Total must sum only the main trial-balance heads
         * (`accountGroups` / root nodes). Subgroups and ledgers are already
         * rolled into those heads by `finalizeNode`. Summing `rows` (every
         * leaf) or nested children as well double-counts and makes Opening
         * Dr ≠ Opening Cr and Closing Dr ≠ Closing Cr in the Excel export.
         *
         * In a properly balanced double-entry system:
         *
         * Opening Debit = Opening Credit
         * Closing Debit = Closing Credit
         */

        const summary =
            accountGroups.reduce(
                (total, head) => {
                    total.totalOpeningDebit += Number(head.openingDebit || 0);
                    total.totalOpeningCredit += Number(head.openingCredit || 0);
                    total.totalClosingDebit += Number(head.closingDebit || 0);
                    total.totalClosingCredit += Number(head.closingCredit || 0);
                    total.totalDebit += Number(head.periodDebit || 0);
                    total.totalCredit += Number(head.periodCredit || 0);
                    total.totalPeriodDebit += Number(head.periodDebit || 0);
                    total.totalPeriodCredit += Number(head.periodCredit || 0);
                    return total;
                },
                {
                    totalOpeningDebit: 0,
                    totalOpeningCredit: 0,
                    totalDebit: 0,
                    totalCredit: 0,
                    totalClosingDebit: 0,
                    totalClosingCredit: 0,
                    totalPeriodDebit: 0,
                    totalPeriodCredit: 0
                }
            );

        summary.totalOpeningDebit =
            Number(
                summary.totalOpeningDebit.toFixed(2)
            );

        summary.totalOpeningCredit =
            Number(
                summary.totalOpeningCredit.toFixed(2)
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

        const openingDifference =
            Number(
                (
                    summary.totalOpeningDebit -
                    summary.totalOpeningCredit
                ).toFixed(2)
            );

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
                    { key: "closingDebit", label: "Debit", section: "Closing" },
                    { key: "closingCredit", label: "Credit", section: "Closing" }
                ]
            },

            summary: {
                ...summary,

                openingDifference,

                periodDifference,

                closingDifference,

                isOpeningBalanced:
                    Math.abs(
                        openingDifference
                    ) < 0.01,

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
                        openingDifference
                    ) < 0.01 &&
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

            const voucherType = String(voucher.voucherType)
                .replace(/_/g, " ")
                .trim()
                .toUpperCase();

            // Day-book exports are the import contract: receipts expose only
            // debit and payments expose only credit. Stored vouchers remain
            // balanced double-entry records.
            switch (voucherType) {
                case "CASH RECEIPT":
                case "BANK RECEIPT":
                case "RECEIPT":
                    return { debit: amount, credit: 0 };

                case "CASH PAYMENT":
                case "BANK PAYMENT":
                case "PAYMENT":
                    return { debit: 0, credit: amount };

                case "PURCHASE":
                case "RCM_PURCHASE":
                case "CREDIT_NOTE":
                case "OPENING_BALANCE":
                    return {
                        debit: amount,
                        credit: 0
                    };

                case "SALE":
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

        const transactionEntries =
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
            });

        // Journal-register imports create approved journals/vouchers directly
        // and therefore have no Transaction row. Add their bank/cash ledger
        // movements to the same day-book stream so imported entries affect
        // the bank calculation exactly as transaction imports do.
        const journalEntries = vouchers
            .filter(voucher => !transactionSourceMap.has(voucher.sourceId))
            .flatMap(voucher => {
                const sourceJournal = journalSourceMap.get(voucher.sourceId);
                return voucher.entries
                    .filter(entry =>
                        [LedgerType.BANK, LedgerType.CASH].includes(entry.ledger.category)
                    )
                    .map(entry => ({
                        serialNo: 0,
                        voucherId: voucher.voucherNo,
                        transactionId: null,
                        transactionDate: voucher.voucherDate,
                        primaryAgencyName: null,
                        secondaryAgencyName: null,
                        paymentMode: getPaymentMode(undefined, sourceJournal),
                        paymentType: null,
                        transactionRef: null,
                        inRoutedVia: false,
                        debit: entry.entryType === EntryType.DEBIT ? Number(entry.amount) : 0,
                        credit: entry.entryType === EntryType.CREDIT ? Number(entry.amount) : 0,
                        runningBalance: 0,
                        remarks: voucher.narration || sourceJournal?.remarks || "",
                        bankAccount: null,
                        allocations: [],
                        particulars: getVoucherParty(voucher, undefined, sourceJournal),
                        voucherType: voucher.voucherType,
                        voucherNo: voucher.voucherNo,
                        debitAmount: entry.entryType === EntryType.DEBIT ? Number(entry.amount) : 0,
                        creditAmount: entry.entryType === EntryType.CREDIT ? Number(entry.amount) : 0,
                        date: voucher.voucherDate
                    }));
            });

        // Rebuild the running balance after both sources have been combined;
        // transactionEntries already contain a transaction-only running
        // balance from the legacy path.
        runningBalance = 0;
        const entries = [...transactionEntries, ...journalEntries]
            .sort((a, b) => {
                const dateDifference = new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime();
                return dateDifference || String(a.voucherNo).localeCompare(String(b.voucherNo));
            })
            .map((entry, index) => {
                runningBalance += entry.credit - entry.debit;
                return { ...entry, serialNo: index + 1, runningBalance };
            });

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


    private static isRecordedGstParty(agency?: { id?: string | null; name?: string | null } | null) {
        if (!agency?.id && !agency?.name) return false;
        const name = String(agency?.name || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
        if (!name) return false;
        return !/party\s+not\s+recorded/i.test(name);
    }

    private static normalizeGstLinePath(value: unknown) {
        return String(value || "")
            .replace(/\\/g, "/")
            .replace(/_/g, " ")
            .replace(/\s*\/\s*/g, " / ")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }

    private static compactGstLinePath(value: unknown) {
        return this.normalizeGstLinePath(value).replace(/[^A-Z0-9]/g, "");
    }

    private static classifyGstNoteLine(path: unknown): "taxable" | "igst" | "cgst" | "sgst" | "invoice" | null {
        const compact = this.compactGstLinePath(path);
        if (!compact) return null;
        if (
            compact.includes("INTERESTRECEIVABLEFROMSDEBTORS") ||
            compact.includes("SALESACCOUNTSIGSTSALES") ||
            compact.includes("SALESACCOUNTSGSTSALES") ||
            compact.endsWith("IGSTSALES") ||
            compact.endsWith("GSTSALES")
        ) return "taxable";
        if (compact.includes("OUTPUTIGST")) return "igst";
        if (compact.includes("OUTPUTCGST")) return "cgst";
        if (compact.includes("OUTPUTSGST")) return "sgst";
        if (compact.includes("CURRENTASSETSSUNDRYDEBTORS")) return "invoice";
        return null;
    }

    private static partyNameFromSundryDebtorPath(path: unknown) {
        const normalized = this.normalizeGstLinePath(path);
        const marker = "CURRENT ASSETS / SUNDRY DEBTORS";
        const index = normalized.indexOf(marker);
        if (index < 0) return "";
        return normalized
            .slice(index + marker.length)
            .replace(/^[\s/]+/, "")
            .replace(/\s+/g, " ")
            .trim();
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

        const startDate = query?.startDate ? parseDate(query.startDate, "startDate") : parseDate("2025-04-01", "startDate");
        const endDate = query?.endDate ? parseDate(query.endDate, "endDate") : parseDate("2026-03-31", "endDate");

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

        const recordedSales = sales.filter(sale => this.isRecordedGstParty(sale.agency));

        const money = (value: unknown) =>
            Math.round(Number(value || 0) * 100) / 100;

        const salesRows =
            recordedSales.map((sale) => {

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

                // Tally's GSTR-1 summary is based on voucher-level totals.
                // Prefer Sale header totals because imported SalesItem GST
                // values may be duplicated or calculated at the wrong level.
                // Fall back to item totals only for legacy rows whose header
                // totals are entirely unavailable.
                const hasHeaderAmounts = [
                    sale.subTotalAmount,
                    sale.totalCGSTAmount,
                    sale.totalSGSTAmount,
                    sale.totalIGSTAmount,
                    sale.totalGSTAmount
                ].some(value => Number(value || 0) !== 0);
                const taxableValue = hasHeaderAmounts ? Number(sale.subTotalAmount || 0) : itemTotals.taxable;
                const cgst = hasHeaderAmounts ? Number(sale.totalCGSTAmount || 0) : itemTotals.cgst;
                const sgst = hasHeaderAmounts ? Number(sale.totalSGSTAmount || 0) : itemTotals.sgst;
                const igst = hasHeaderAmounts ? Number(sale.totalIGSTAmount || 0) : itemTotals.igst;
                const gst = hasHeaderAmounts ? Number(sale.totalGSTAmount || 0) : itemTotals.gst;

                return {
                    branchName: sale.branch.name,

                    branchGst: sale.branch.gstin,

                    agency_id: sale.agencyId,

                    agency_name: String(sale.agency?.name || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim(),

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
                        money(cgst),

                    sgst_rate_amount:
                        money(sgst),

                    igst_rate_amount:
                        money(igst),

                    branch_state_code:
                        branchStateCode,

                    customer_state_code:
                        posStateCode,

                    gst_amount: money(gst),

                    invoice_total: money(Number(sale.grandTotal || 0) || itemTotals.total)
                };
            });

        const noteRecords = await prisma.debitCreditNote.findMany({
            where: {
                status: DebitCreditNoteStatus.APPROVED,
                // Tally's outward note imports can be linked to either a sale
                // or purchase context. The SDN/SCN number is the authoritative
                // outward GSTR-1 marker for these imported vouchers.
                OR: [
                    { noteNo: { startsWith: "SDN/" } },
                    { noteNo: { startsWith: "SCN/" } }
                ],
                ...(branchId ? { branchId } : {}),
                ...(startDate || endDate ? {
                    noteDate: {
                        ...(startDate ? { gte: startDate } : {}),
                        ...(endDate ? { lte: endDate } : {})
                    }
                } : {})
            },
            include: {
                agency: true,
                branch: true,
                particulars: true,
                voucher: {
                    select: {
                        totalDebit: true,
                        totalCredit: true,
                        entries: {
                            select: {
                                amount: true,
                                narration: true,
                                ledger: { select: { name: true } }
                            }
                        }
                    }
                }
            },
            orderBy: { noteDate: "asc" }
        });

        const notesByVoucherNo = new Map<string, typeof noteRecords>();
        for (const note of noteRecords) {
            const key = String(note.noteNo || "").trim().toUpperCase();
            if (!key) continue;
            const group = notesByVoucherNo.get(key) || [];
            group.push(note);
            notesByVoucherNo.set(key, group);
        }

        const gstNoteAgencyName = (
            note: (typeof noteRecords)[number],
            fallback = ""
        ) => String(note.agency?.name || fallback || "")
            .replace(/[\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const voucherTaxableAmount = (item: (typeof noteRecords)[number]) => {
            const debit = Math.abs(Number(item.voucher?.totalDebit || 0));
            const credit = Math.abs(Number(item.voucher?.totalCredit || 0));
            if (debit > 0 || credit > 0) return debit || credit;
            return (item.voucher?.entries || []).reduce((sum, entry) => {
                const kind = this.classifyGstNoteLine(entry.ledger?.name) || this.classifyGstNoteLine(entry.narration);
                return kind === "taxable" ? sum + Math.abs(Number(entry.amount || 0)) : sum;
            }, 0);
        };

        const noteRows = [...notesByVoucherNo.values()].flatMap((group) => {
            const lines: Array<{ path: string; amount: number }> = [];
            for (const item of group) {
                let usedVoucherTaxable = false;
                const posting = voucherTaxableAmount(item);
                if (item.particulars?.length) {
                    for (const particular of item.particulars) {
                        const path = particular.description || item.categoryPath || "";
                        const kind = this.classifyGstNoteLine(path);
                        if (kind === "taxable" && posting > 0) {
                            if (usedVoucherTaxable) continue;
                            usedVoucherTaxable = true;
                            lines.push({ path, amount: posting });
                            continue;
                        }
                        lines.push({
                            path,
                            amount: Number(particular.amount || 0)
                        });
                    }
                } else if (item.categoryPath) {
                    const kind = this.classifyGstNoteLine(item.categoryPath);
                    lines.push({
                        path: item.categoryPath,
                        amount: kind === "taxable" && posting > 0
                            ? posting
                            : Number(item.totalAmount || 0)
                    });
                }
            }

            let taxable = 0;
            let igst = 0;
            let cgst = 0;
            let sgst = 0;
            let invoice = 0;
            let sundryParty = "";
            for (const line of lines) {
                const kind = this.classifyGstNoteLine(line.path);
                const amount = Math.abs(Number(line.amount || 0));
                if (!kind || !amount) continue;
                if (kind === "taxable") taxable += amount;
                if (kind === "igst") igst += amount;
                if (kind === "cgst") cgst += amount;
                if (kind === "sgst") sgst += amount;
                if (kind === "invoice") {
                    invoice += amount;
                    sundryParty = sundryParty || this.partyNameFromSundryDebtorPath(line.path);
                }
            }

            const cgstAmount = money(cgst);
            const sgstAmount = money(sgst);
            const igstAmount = money(igst);
            const gstAmount = money(cgstAmount + sgstAmount + igstAmount);
            if (gstAmount === 0) return [];

            const note = group.find(item => this.isRecordedGstParty(item.agency)) || group[0];
            const agencyName = gstNoteAgencyName(note, sundryParty);
            if (!this.isRecordedGstParty({ id: note.agencyId, name: agencyName })) return [];

            const isCreditNote =
                group.some(item => item.type === DebitCreditNoteType.CREDIT_NOTE) ||
                /^SCN\//i.test(String(note.noteNo || "").trim());
            const signed = (value: number) => money(isCreditNote ? -Math.abs(value) : Math.abs(value));
            const invoiceTotal = Math.round(Number(invoice || taxable + gstAmount));

            return [{
            branchName: note.branch.name,
            branchGst: note.branch.gstin,
            agency_id: note.agencyId,
                agency_name: agencyName,
            classification: "B2B" as const,
            customer_gstin: note.agency?.gstin || null,
            invoice_number: note.noteNo,
            invoice_date: note.noteDate,
            place_of_supply_pos: note.agency?.state || note.agency?.stateCode,
                taxable_value: signed(taxable),
                cgst_rate_amount: signed(cgstAmount),
                sgst_rate_amount: signed(sgstAmount),
                igst_rate_amount: signed(igstAmount),
            branch_state_code: note.branch.stateCode,
            customer_state_code: note.agency?.stateCode || null,
                gst_amount: signed(gstAmount),
                invoice_total: signed(invoiceTotal)
            }];
        });

        // Keep the main B2B invoice rows limited to sales invoices. Debit and
        // credit notes belong only to creditDebitNoteSummary so adding GST
        // fields to notes cannot change the existing invoice voucher count.
        const rows = salesRows;

        const b2bSummaryMap = new Map<string, any>();
        // The Tally B2B section is based on imported TAX INVOICE vouchers.
        // Do not use GSTIN presence as the grouping filter: imported agencies
        // without master GSTIN/state data must still appear in the report.
        for (const row of rows) {
            if (!this.isRecordedGstParty({ id: row.agency_id, name: row.agency_name })) continue;
            const key = row.agency_id || row.agency_name;
            const current = b2bSummaryMap.get(key) || {
                agency_id: row.agency_id,
                customer_gstin: row.customer_gstin,
                agency_name: row.agency_name,
                voucher_count: 0,
                taxable_value: 0,
                igst_rate_amount: 0,
                cgst_rate_amount: 0,
                sgst_rate_amount: 0,
                cess_amount: 0,
                gst_amount: 0,
                invoice_total: 0,
                vouchers: [] as any[]
            };
            current.voucher_count += 1;
            current.taxable_value += row.taxable_value;
            current.igst_rate_amount += row.igst_rate_amount;
            current.cgst_rate_amount += row.cgst_rate_amount;
            current.sgst_rate_amount += row.sgst_rate_amount;
            current.gst_amount += row.gst_amount;
            current.invoice_total += row.invoice_total;
            current.vouchers.push(row);
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
        })).sort((a, b) => String(a.agency_name).localeCompare(String(b.agency_name), "en", { sensitivity: "base" }));

        const noteSummaryMap = new Map<string, any>();
        for (const row of noteRows) {
            if (!this.isRecordedGstParty({ id: row.agency_id, name: row.agency_name })) continue;
            const key = row.agency_id || row.agency_name;
            const current = noteSummaryMap.get(key) || {
                agency_id: row.agency_id,
                customer_gstin: row.customer_gstin,
                agency_name: row.agency_name,
                voucher_count: 0,
                taxable_value: 0,
                igst_rate_amount: 0,
                cgst_rate_amount: 0,
                sgst_rate_amount: 0,
                cess_amount: 0,
                gst_amount: 0,
                invoice_total: 0,
                vouchers: [] as any[]
            };
            current.voucher_count += 1;
            current.taxable_value += row.taxable_value;
            current.igst_rate_amount += row.igst_rate_amount;
            current.cgst_rate_amount += row.cgst_rate_amount;
            current.sgst_rate_amount += row.sgst_rate_amount;
            current.gst_amount += row.gst_amount;
            current.invoice_total += row.invoice_total;
            current.vouchers.push(row);
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
        })).sort((a, b) => String(a.agency_name).localeCompare(String(b.agency_name), "en", { sensitivity: "base" }));

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

        const totalsFor = (data: any[]) => data.reduce((sum, row) => ({
            voucher_count: sum.voucher_count + Number(row.voucher_count || 0),
            taxable_value: money(sum.taxable_value + Number(row.taxable_value || 0)),
            igst_rate_amount: money(sum.igst_rate_amount + Number(row.igst_rate_amount || 0)),
            cgst_rate_amount: money(sum.cgst_rate_amount + Number(row.cgst_rate_amount || 0)),
            sgst_rate_amount: money(sum.sgst_rate_amount + Number(row.sgst_rate_amount || 0)),
            cess_amount: money(sum.cess_amount + Number(row.cess_amount || 0)),
            gst_amount: money(sum.gst_amount + Number(row.gst_amount || 0)),
            invoice_total: money(sum.invoice_total + Number(row.invoice_total || 0))
        }), { voucher_count: 0, taxable_value: 0, igst_rate_amount: 0, cgst_rate_amount: 0, sgst_rate_amount: 0, cess_amount: 0, gst_amount: 0, invoice_total: 0 });

        const b2bTotals = totalsFor(b2bSummary);
        const noteTotals = totalsFor(creditDebitNoteSummary);
        const includedInReturn = b2bTotals.voucher_count + noteTotals.voucher_count;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formatPeriodPart = (date: Date) => `${date.getDate()}-${months[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
        const periodLabel = `${formatPeriodPart(startDate)} to ${formatPeriodPart(endDate)}`;

        const headerBranch = recordedSales[0]?.branch || noteRecords[0]?.branch || (branchId
            ? await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true, gstin: true } })
            : null);

        const sections = [
            {
                key: "b2b",
                title: "B2B Invoices - 4A, 4B, 4C, 6B, 6C",
                ...b2bTotals,
                parties: b2bSummary
            },
            {
                key: "cdn_registered",
                title: "Credit or Debit Notes (Registered) - 9B",
                ...noteTotals,
                parties: creditDebitNoteSummary
            }
        ];

        return {

            reportName:
                "GSTR-1 Outward Supplies Report",

            generatedAt:
                new Date(),

            period: {
                startDate,
                endDate,
                label: periodLabel
            },

            branchId,

            branch: headerBranch
                ? {
                    name: headerBranch.name,
                    branchName: headerBranch.name,
                    gstin: headerBranch.gstin,
                    branchGst: headerBranch.gstin
                }
                : null,

            summary,

            b2bSummary,

            creditDebitNoteSummary,

            sections,

            gstrStatus: {
                totalVouchers: includedInReturn,
                includedInReturn,
                readyForUpload: includedInReturn,
                modifiedAfterExport: 0,
                noActionRequired: includedInReturn,
                notRelevant: 0,
                uncertain: 0,
                markedForDeletion: 0,
                conflictsWithMasters: 0,
                filingStatus: "Not Filed",
                lastOnlineActivity: "No Activity Found"
            },

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

    private static findOutstandingGroupNode(nodes: any[], name: string): any | null {
        const want = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
        for (const node of nodes || []) {
            const have = String(node.name || node.account || "").replace(/\s+/g, " ").trim().toLowerCase();
            if (have === want) return node;
            const child = this.findOutstandingGroupNode(node.children || [], name);
            if (child) return child;
        }
        return null;
    }

    private static flattenOutstandingLedgers(node: any): any[] {
        const rows: any[] = [];
        for (const child of node?.children || []) {
            if (child.rowType === "accountingHeader" && Array.isArray(child.children) && child.children.length > 0) {
                rows.push(...this.flattenOutstandingLedgers(child));
                continue;
            }
            rows.push(child);
        }
        return rows;
    }

    private static istCalendarDate(value: Date) {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(value);
    }

    private static agingDaysAsOn(from: Date, asOn: Date) {
        const [fromYear, fromMonth, fromDay] = this.istCalendarDate(from).split("-").map(Number);
        const [onYear, onMonth, onDay] = this.istCalendarDate(asOn).split("-").map(Number);
        return Math.max(
            0,
            Math.round(
                (Date.UTC(onYear, onMonth - 1, onDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) /
                (24 * 60 * 60 * 1000)
            )
        );
    }

    private static fifoOutstandingAge(
        isDebtor: boolean,
        events: Array<{ date: Date; debit: number; credit: number }>,
        asOn: Date
    ) {
        const byDay = new Map<string, { date: Date; debit: number; credit: number }>();
        for (const event of events) {
            const key = this.istCalendarDate(event.date);
            const current = byDay.get(key) || { date: event.date, debit: 0, credit: 0 };
            current.debit += Number(event.debit || 0);
            current.credit += Number(event.credit || 0);
            byDay.set(key, current);
        }

        const layers: Array<{ date: Date; remaining: number }> = [];
        for (const day of [...byDay.values()].sort((a, b) =>
            this.istCalendarDate(a.date).localeCompare(this.istCalendarDate(b.date))
        )) {
            const add = Number((isDebtor ? day.debit : day.credit).toFixed(2));
            let settle = Number((isDebtor ? day.credit : day.debit).toFixed(2));
            if (add > 0.005) layers.push({ date: day.date, remaining: add });
            while (settle > 0.005 && layers.length) {
                const take = Math.min(layers[0].remaining, settle);
                layers[0].remaining = Number((layers[0].remaining - take).toFixed(2));
                settle = Number((settle - take).toFixed(2));
                if (layers[0].remaining <= 0.005) layers.shift();
            }
        }

        if (!layers.length) return null;
        return this.agingDaysAsOn(layers[0].date, asOn);
    }

    static async getOutstandingReport(
        actor: any,
        query?: {
            branchId?: string;
            agencyId?: string;
            type?: "RECEIVABLE" | "PAYABLE";
            export?: boolean;
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

        const isPayable = query?.type === "PAYABLE";
        const groupNames = isPayable
            ? ["Sundry Debtors", "Sundry Debtor"]
            : ["Sundry Creditors", "Sundry Creditor"];

        const trialBalance = await this.getTrialBalanceReport(actor, {
            branchId,
            startDate: query?.startDate || "2025-04-01",
            endDate: query?.endDate || "2026-03-31",
            includeZero: false
        });

        const group = groupNames
            .map(name => this.findOutstandingGroupNode(trialBalance.tree || [], name))
            .find(Boolean);

        let ledgerNodes = group ? this.flattenOutstandingLedgers(group) : [];
        const normalizeName = (value: unknown) =>
            String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

        if (query?.agencyId) {
            const agencyName = normalizeName(agency?.name);
            ledgerNodes = ledgerNodes.filter(node =>
                node.agencyId === query.agencyId ||
                normalizeName(node.account || node.name) === agencyName
            );
        }

        const nullableAmount = (value: number) => {
            const rounded = Number(Number(value || 0).toFixed(2));
            return rounded === 0 ? null : rounded;
        };

        const rows = ledgerNodes
            .map(node => {
                const openingDebit = Number(node.openingDebit || 0);
                const openingCredit = Number(node.openingCredit || 0);
                const closingDebit = Number(node.closingDebit || 0);
                const closingCredit = Number(node.closingCredit || 0);
                const openingBalance = isPayable
                    ? openingDebit - openingCredit
                    : openingCredit - openingDebit;
                const closingBalance = isPayable
                    ? closingDebit - closingCredit
                    : closingCredit - closingDebit;

                return {
                    agencyId: node.agencyId || null,
                    ledgerId: node.ledgerId || null,
                    account: String(node.account || node.name || "").trim(),
                    openingBalance: nullableAmount(openingBalance),
                    transactionDebit: nullableAmount(Number(node.periodDebit || 0)),
                    transactionCredit: nullableAmount(Number(node.periodCredit || 0)),
                    closingBalance: nullableAmount(closingBalance),
                    agingDays: null as number | null
                };
            })
            .filter(row => {
                const name = row.account.toLowerCase();
                return row.account && !groupNames.some(groupName => groupName.toLowerCase() === name);
            })
            .sort((a, b) => a.account.localeCompare(b.account, "en", { sensitivity: "base" }));

        const amount = (value: number | null) => Number(Number(value || 0).toFixed(2));
        const summary = {
            totalLedgers: rows.length,
            openingBalance: amount(rows.reduce((sum, row) => sum + amount(row.openingBalance), 0)),
            transactionDebit: amount(rows.reduce((sum, row) => sum + amount(row.transactionDebit), 0)),
            transactionCredit: amount(rows.reduce((sum, row) => sum + amount(row.transactionCredit), 0)),
            closingBalance: amount(rows.reduce((sum, row) => sum + amount(row.closingBalance), 0))
        };

        const periodStart = trialBalance.diagnostics?.period?.startDate
            ? new Date(trialBalance.diagnostics.period.startDate)
            : new Date(2025, 3, 1);
        const periodEnd = trialBalance.diagnostics?.period?.endDate
            ? new Date(trialBalance.diagnostics.period.endDate)
            : new Date(2026, 2, 31, 23, 59, 59, 999);
        const lastDateYmd = String(query?.endDate || "2026-03-31").slice(0, 10);
        const [asOnYear, asOnMonth, asOnDay] = lastDateYmd.split("-").map(Number);
        const asOnDate = new Date(Date.UTC(asOnYear, asOnMonth - 1, asOnDay, 18, 29, 59, 999));

        const formatPeriodPart = (date: Date) => {
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${date.getDate()}-${months[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
        };
        const periodLabel = `${formatPeriodPart(periodStart)} to ${formatPeriodPart(periodEnd)}`;

        const ledgerIds = [...new Set(rows.map(row => row.ledgerId).filter(Boolean))] as string[];
        const eventsByLedger = new Map<string, Array<{ date: Date; debit: number; credit: number }>>();
        for (let index = 0; index < ledgerIds.length; index += 400) {
            const chunk = ledgerIds.slice(index, index + 400);
            const [entries, journals] = await Promise.all([
                prisma.ledgerEntry.findMany({
                where: {
                        ledgerId: { in: chunk },
                        voucher: { voucherDate: { lte: asOnDate } }
                    },
                    select: {
                        ledgerId: true,
                        entryType: true,
                        amount: true,
                        voucher: { select: { voucherDate: true } }
                    }
                }),
                prisma.journal.findMany({
                    where: {
                        status: JournalStatus.APPROVED,
                        voucherId: null,
                        journalDate: { lte: asOnDate },
                        journalHead: { ledgerId: { in: chunk } }
                    },
                    select: {
                        amount: true,
                        direction: true,
                        journalDate: true,
                        journalHead: { select: { ledgerId: true, type: true } }
                    }
                })
            ]);

            for (const entry of entries) {
                const list = eventsByLedger.get(entry.ledgerId) || [];
                list.push({
                    date: entry.voucher.voucherDate,
                    debit: entry.entryType === EntryType.DEBIT ? Number(entry.amount || 0) : 0,
                    credit: entry.entryType === EntryType.CREDIT ? Number(entry.amount || 0) : 0
                });
                eventsByLedger.set(entry.ledgerId, list);
            }

            for (const journal of journals) {
                const ledgerId = journal.journalHead.ledgerId;
                const inward = (journal.direction || journal.journalHead.type) === JournalDirection.INWARD;
                const list = eventsByLedger.get(ledgerId) || [];
                list.push({
                    date: journal.journalDate,
                    debit: inward ? Number(journal.amount || 0) : 0,
                    credit: inward ? 0 : Number(journal.amount || 0)
                });
                eventsByLedger.set(ledgerId, list);
            }
        }

        const agingByLedgerId = new Map<string, number>();
        for (const row of rows) {
            if (row.closingBalance === null || !row.ledgerId) continue;
            const events = [...(eventsByLedger.get(row.ledgerId) || [])];
            if (!events.length && row.openingBalance) {
                const opening = amount(row.openingBalance);
                events.push({
                    date: periodStart,
                    debit: isPayable ? Math.max(opening, 0) : Math.max(-opening, 0),
                    credit: isPayable ? Math.max(-opening, 0) : Math.max(opening, 0)
                });
            }
            const age = this.fifoOutstandingAge(isPayable, events, asOnDate);
            if (age === null) continue;
            agingByLedgerId.set(row.ledgerId, age);
        }

        for (const row of rows) {
            row.agingDays = row.closingBalance === null || !row.ledgerId
                ? null
                : agingByLedgerId.get(row.ledgerId) ?? null;
        }

        const agingRows = rows
            .filter(row => row.closingBalance !== null && row.agingDays !== null)
            .map(row => ({
                agencyName: row.account,
                agingDays: row.agingDays as number,
                outstandingAmount: Math.abs(amount(row.closingBalance))
            }));

        const company = trialBalance.branch?.name || "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra";
        const groupLabel = isPayable ? "Sundry Debtor" : "Sundry Creditor";

        return {
            reportName: isPayable
                ? "Accounts Payable - Sundry Debtors"
                : "Accounts Receivable - Sundry Creditors",
            generatedAt: new Date(),
            type: isPayable ? "PAYABLE" : "RECEIVABLE",
            branchId: branchId || null,
            agency,
            agencyId: query?.agencyId,
            company,
            companyDetails: {
                addressLines: [
                    "SURVEY NO - 222, VILLAGE - HEDAVALI, Tl- SUDHAGAD",
                    "KHOPOLI - PALI ROAD, KHOPOLI, DIST - RAIGAD"
                ],
                identifier: "CIN: U11100MH2011PTC224243",
                email: "E-Mail : info@ashtvinayakapetrochem.com"
            },
            group: isPayable ? "Sundry Debtors" : "Sundry Creditors",
            branchHeading: `${company} (from ${formatPeriodPart(periodStart)})`,
            period: {
                startDate: periodStart,
                endDate: periodEnd,
                label: periodLabel
            },
            layout: {
                reportTitle: groupLabel,
                columns: [
                    { key: "account", label: "Particulars" },
                    { key: "openingBalance", label: "Opening Balance" },
                    { key: "transactionDebit", label: "Transaction Debit", section: "Transactions" },
                    { key: "transactionCredit", label: "Transaction Credit", section: "Transactions" },
                    { key: "closingBalance", label: "Closing Balance" },
                    { key: "agingDays", label: "Aging Days" }
                ]
            },
            summary,
            rows,
            agingRows,
            agencyDetails: query?.agencyId ? (rows[0] || null) : undefined,
            exportData: query?.export ? rows : undefined
        };
    }
}