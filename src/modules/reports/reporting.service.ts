import { LedgerType, OutstandingType, Prisma, PurchaseStatus, SalesStatus, TransactionDirection } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { parseDate, resolveBalanceType } from "../../core/utils/loc.utils";
import { LedgerService } from "../accounting/ledger/ledger.service";

export class ReportingService {

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
                                        ...(startDate && endDate
                                            ? {
                                                invoiceDate: {
                                                    gte: startDate,
                                                    lte: endDate
                                                }
                                            }
                                            : startDate
                                            ? {
                                                invoiceDate: {
                                                    gte: startDate
                                                }
                                            }
                                            : {
                                                invoiceDate: {
                                                    lte: endDate
                                                }
                                            })
                                    }
                                },
                                {
                                    purchase: {
                                        ...(startDate && endDate
                                            ? {
                                                invoiceDate: {
                                                    gte: startDate,
                                                    lte: endDate
                                                }
                                            }
                                            : startDate
                                            ? {
                                                invoiceDate: {
                                                    gte: startDate
                                                }
                                            }
                                            : {
                                                invoiceDate: {
                                                    lte: endDate
                                                }
                                            })
                                    }
                                }
                            ]
                        }
                        : {})
                },
                include: {
                    agency: true,
                    thirdPartyAgency: true,
                    bankAccount: true,

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

                    console.log("transaction ", txn);

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
            entries: paginatedEntries
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

                bucket_0_30_days: {
                    amount: number;
                    invoices: any[];
                };
                bucket_31_60_days: {
                    amount: number;
                    invoices: any[];
                };
                bucket_61_90_days: {
                    amount: number;
                    invoices: any[];
                };
                bucket_91_plus_days: {
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
                    allocations: true
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

                const outstanding = Number(sale.grandTotal) - allocated;

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
                        ageDays <= 30
                            ? "0-30 Days"
                            : ageDays <= 60
                                ? "31-60 Days"
                                : ageDays <= 90
                                    ? "61-90 Days"
                                    : "Above 90 Days",

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
                        bucket_0_30_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_31_60_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_61_90_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_91_plus_days: {
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

                if(ageDays <= 30){

                    bucket =
                        agency.bucket_0_30_days;

                }
                else if(ageDays <= 60){

                    bucket =
                        agency.bucket_31_60_days;

                }
                else if(ageDays <= 90){

                    bucket =
                        agency.bucket_61_90_days;

                }
                else{

                    bucket =
                        agency.bucket_91_plus_days;

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
                        ageDays <= 30
                            ? "0-30 Days"
                            : ageDays <= 60
                                ? "31-60 Days"
                                : ageDays <= 90
                                    ? "61-90 Days"
                                    : "Above 90 Days",

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
                        bucket_0_30_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_31_60_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_61_90_days: {
                            amount: 0,
                            invoices: []
                        },
                        bucket_91_plus_days: {
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

                if (ageDays <= 30) {

                    bucket =
                        agency.bucket_0_30_days;

                }
                else if (ageDays <= 60) {

                    bucket =
                        agency.bucket_31_60_days;

                }
                else if (ageDays <= 90) {

                    bucket =
                        agency.bucket_61_90_days;

                }
                else {

                    bucket =
                        agency.bucket_91_plus_days;

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
                        row.bucket_0_30_days.invoices.length +
                        row.bucket_31_60_days.invoices.length +
                        row.bucket_61_90_days.invoices.length +
                        row.bucket_91_plus_days.invoices.length,
                    0
                ),

            totalOutstanding:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        row.totalOutstanding,
                    0
                ),

            bucket_0_30_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_0_30_days?.amount ?? 0),
                    0
                ),

            bucket_31_60_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_31_60_days?.amount ?? 0),
                    0
                ),

            bucket_61_90_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_61_90_days?.amount ?? 0),
                    0
                ),

            bucket_91_plus_days:
                rows.reduce(
                    (sum, row) =>
                        sum +
                        (row.bucket_91_plus_days?.amount ?? 0),
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
