import { DebitCreditNoteStatus, DebitCreditNoteType, EntryType, LedgerNature, LedgerType, OutstandingType, Prisma, PurchaseStatus, SalesStatus, TransactionDirection } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { parseDate, resolveBalanceType } from "../../core/utils/loc.utils";
import { LedgerService } from "../accounting/ledger/ledger.service";

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

    static async getTrialBalanceReport(
        actor: any,
        query?: {
            branchId?: string;
            startDate?: string;
            endDate?: string;
            includeZero?: boolean;
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

        /**
         * ============================================================
         * 2. REPORT PERIOD
         * ============================================================
         */

        const startDate =
            query?.startDate
                ? parseDate(
                    query.startDate,
                    "startDate"
                )
                : undefined;

        const endDate =
            query?.endDate
                ? parseDate(
                    query.endDate,
                    "endDate"
                )
                : new Date();

        if (startDate) {
            startDate.setHours(
                0,
                0,
                0,
                0
            );
        }

        endDate.setHours(
            23,
            59,
            59,
            999
        );

        if (
            startDate &&
            startDate > endDate
        ) {
            throw new ApiError(
                "startDate cannot be after endDate",
                400
            );
        }

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
            branchId
                ? {
                    OR: [
                        {
                            branchId
                        },
                        {
                            voucher: {
                                branchId
                            }
                        }
                    ]
                }
                : undefined;

        /**
         * ============================================================
         * 4. PERIOD MOVEMENT
         * ============================================================
         *
         * Debit/Credit columns represent transactions inside:
         *
         * startDate -> endDate
         *
         * If startDate is not provided:
         * all transactions up to endDate are treated as the period.
         */

        const periodWhere:
            Prisma.LedgerEntryWhereInput = {

            AND: [
                ...(branchEntryFilter
                    ? [branchEntryFilter]
                    : []),

                {
                    voucher: {
                        voucherDate: {
                            ...(startDate
                                ? {
                                    gte: startDate
                                }
                                : {}),

                            lte: endDate
                        }
                    }
                }
            ]
        };

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

        const priorWhere:
            Prisma.LedgerEntryWhereInput =
            startDate
                ? {
                    AND: [
                        ...(branchEntryFilter
                            ? [branchEntryFilter]
                            : []),

                        {
                            voucher: {
                                voucherDate: {
                                    lt: startDate
                                }
                            }
                        }
                    ]
                }
                : {
                    id: "__never__"
                };

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

        const [
            ledgers,
            periodGroups,
            priorGroups
        ] = await Promise.all([

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

            prisma.ledgerEntry.groupBy({
                by: [
                    "ledgerId",
                    "entryType"
                ],

                where:
                    periodWhere,

                _sum: {
                    amount: true
                }
            }),

            prisma.ledgerEntry.groupBy({
                by: [
                    "ledgerId",
                    "entryType"
                ],

                where:
                    priorWhere,

                _sum: {
                    amount: true
                }
            })
        ]);

        const periodMap =
            this.sumEntryGroups(
                periodGroups
            );

        const priorMap =
            this.sumEntryGroups(
                priorGroups
            );

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
                    !branchId ||
                    ledger.branchId === branchId;

                const ledgerOpeningSigned =
                    !shouldUseLedgerOpening
                        ? 0
                        : ledger.nature ===
                            LedgerNature.CREDIT

                            ? -Number(
                                ledger.openingBalance ||
                                0
                            )

                            : Number(
                                ledger.openingBalance ||
                                0
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

                const debit =
                    Number(
                        period.debit.toFixed(2)
                    );

                const credit =
                    Number(
                        period.credit.toFixed(2)
                    );

                const closingSigned =
                    Number(
                        (
                            ledgerOpeningSigned +
                            prior.debit -
                            prior.credit +
                            debit -
                            credit
                        ).toFixed(2)
                    );

                const closingDebit =
                    closingSigned > 0
                        ? closingSigned
                        : 0;

                const closingCredit =
                    closingSigned < 0
                        ? Math.abs(
                            closingSigned
                        )
                        : 0;

                return {
                    ledgerId:
                        ledger.id,

                    ledgerCode:
                        ledger.code,

                    account:
                        ledger.name,

                    parentGroup:
                        ledger.group.name,

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
                     * Period movement
                     */
                    debit,

                    credit,

                    /**
                     * Numeric closing balance
                     */
                    closingDebit:
                        Number(
                            closingDebit.toFixed(2)
                        ),

                    closingCredit:
                        Number(
                            closingCredit.toFixed(2)
                        ),

                    /**
                     * Signed value is useful internally.
                     */
                    closingSigned
                };
            });

        /**
         * ============================================================
         * 9. REMOVE ZERO ACCOUNTS
         * ============================================================
         */

        const filteredRows =
            rawRows.filter(row => {

                if (query?.includeZero) {
                    return true;
                }

                return (
                    row.debit !== 0 ||
                    row.credit !== 0 ||
                    row.closingDebit !== 0 ||
                    row.closingCredit !== 0
                );
            });

        /**
         * ============================================================
         * 10. SR. NO.
         * ============================================================
         */

        const rows =
            filteredRows.map(
                (row, index) => ({
                    srNo:
                        index + 1,

                    ...row
                })
            );

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

                    total.totalDebit +=
                        row.debit;

                    total.totalCredit +=
                        row.credit;

                    total.totalClosingDebit +=
                        row.closingDebit;

                    total.totalClosingCredit +=
                        row.closingCredit;

                    return total;
                },
                {
                    totalDebit: 0,
                    totalCredit: 0,
                    totalClosingDebit: 0,
                    totalClosingCredit: 0
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

        summary.totalClosingDebit =
            Number(
                summary.totalClosingDebit.toFixed(2)
            );

        summary.totalClosingCredit =
            Number(
                summary.totalClosingCredit.toFixed(2)
            );

        const periodDifference =
            Number(
                (
                    summary.totalDebit -
                    summary.totalCredit
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
                    startDate || null,

                endDate
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
                        periodDifference
                    ) < 0.01 &&
                    Math.abs(
                        closingDifference
                    ) < 0.01
            },

            rows
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
            voucherDate: periodDateFilter,

            ...(query?.bankAccountId
                ? {
                    sourceId: {
                        in: transactions.map(txn => txn.id)
                    }
                }
                : {})
        };

        const vouchers =
            await prisma.voucher.findMany({
                where: voucherWhere,
                include: {
                    entries: {
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
                    }
                },
                orderBy: [
                    {
                        voucherDate: "asc"
                    },
                    {
                        voucherNo: "asc"
                    }
                ]
            });

        const sourceIds =
            Array.from(
                new Set(
                    vouchers
                        .map(voucher => voucher.sourceId)
                        .filter(Boolean)
                )
            );

        const [
            sourceTransactions,
            sourceJournals
        ] =
            sourceIds.length
                ? await Promise.all([
                    prisma.transaction.findMany({
                        where: {
                            id: {
                                in: sourceIds
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
                                in: sourceIds
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
                ])
                : [
                    [],
                    []
                ];

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

        const rows =
            sales.map((sale) => {

                const customerGSTIN =
                    sale.agency?.gstin || null;

                const classification =
                    customerGSTIN
                        ? "B2B"
                        : "B2C";

                const branchStateCode =
                    sale.branch.stateCode;

                const posStateCode =
                    sale.agency?.stateCode;

                const isIntraState =
                    branchStateCode === posStateCode;

                return {
                    branchName: sale.branch.name,

                    branchGst: sale.branch.gstin,

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

                    taxable_value:
                        Number(
                            sale.subTotalAmount
                        ),

                    cgst_rate_amount:
                        isIntraState
                            ? Number(
                                sale.totalCGSTAmount
                            )
                            : 0,

                    sgst_rate_amount:
                        isIntraState
                            ? Number(
                                sale.totalSGSTAmount
                            )
                            : 0,

                    igst_rate_amount:
                        !isIntraState
                            ? Number(
                                sale.totalIGSTAmount
                            )
                            : 0,

                    branch_state_code:
                        branchStateCode,

                    customer_state_code:
                        posStateCode,

                    invoice_total:
                        Number(
                            sale.grandTotal
                        )
                };
            });

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
