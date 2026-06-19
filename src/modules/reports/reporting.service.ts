import { LedgerType, OutstandingType, Prisma, SalesStatus, TransactionDirection } from "@prisma/client";
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

                    ...(startDate || endDate
                        ? {
                            createdAt: {
                                ...(startDate && { gte: startDate }),
                                ...(endDate && { lte: endDate })
                            }
                        }
                    : {})
                },
                include: {
                    agency: true,
                    thirdPartyAgency: true,
                    allocations: {
                        include: {
                            sale: true,
                            purchase: true
                        }
                    }
                },
                orderBy: {
                    createdAt: "asc"
                }
            });

        const entries = 
            transactions.map((txn, index) => ({
                serialNo: index + 1,

                voucherId: txn.transactionNo,

                transactionId: txn.id,

                transactionDate: txn.createdAt,

                primaryAgencyName: txn.agency?.name || null,

                paymentMode: txn.paymentMode,

                paymentType: txn.paymentType,

                transactionRef: txn.transactionRefNo ||
                        txn.referenceNo ||
                        null,

                inRoutedVia: !!txn.thirdPartyAgencyId,

                secondaryAgencyName: txn.thirdPartyAgency?.name || null,

                cashInFlowReceipt: txn.direction === TransactionDirection.INWARD
                        ? Number(txn.amount)
                        : 0,

                remarks: txn.remarks,

                allocations:
                    txn.allocations.map((a) => ({
                    sourceType:
                        a.sourceType,

                    invoiceNo:
                        a.sale?.invoiceNo ||
                        a.purchase?.invoiceNo,

                    allocatedAmount:
                        Number(a.allocatedAmount)
                }))
            })
        );

        const totalReceipts = entries.reduce((sum, row) => sum + row.cashInFlowReceipt, 0);
        const totalPayments = entries.reduce((sum, row) => sum + row.cashInFlowReceipt, 0);

        return {
            branch,
            dateRange: {
                startDate, endDate
            },
            summary: {
                totalTransactions: entries.length,
                totalReceipts: totalReceipts,
                totalPayments: totalPayments,
                netCashFlow: totalReceipts - totalPayments
            },
            entries
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
            type?: "RECEIVABLE" | "PAYABLE";
        }
    ) {

        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const branchId =
            actor.branchAccessType === "ALL"
                ? query?.branchId
                : actor.branchId;

        const ledgerWhere: Prisma.LedgerWhereInput = {

            ...(branchId && {
                branchId
            }),

            ...(query?.type === "RECEIVABLE" && {
                category: LedgerType.CUSTOMER
            }),

            ...(query?.type === "PAYABLE" && {
                category: LedgerType.VENDOR
            }),

            agencyId: {
                not: null
            },

            isActive: true
        };

        const ledgers =
            await prisma.ledger.findMany({

                where: ledgerWhere,

                include: {
                    agency: true,
                    branch: true,
                    group: true
                },

                orderBy: {
                    name: "asc"
                }
            });

        const rows =
            await Promise.all(

                ledgers.map(async ledger => {

                    const balance =
                        await LedgerService.calculateLedgerBalance(
                            ledger.id
                        );

                    return {

                        agency_id:
                            ledger.agency?.id,

                        agency_name:
                            ledger.agency?.name,

                        agency_type:
                            ledger.agency?.type,

                        branch: ledger.branch
                            ? {
                                id: ledger.branch.id,
                                code: ledger.branch.code,
                                name: ledger.branch.name
                            }
                            : null,

                        ledger: {
                            id: ledger.id,
                            code: ledger.code,
                            name: ledger.name
                        },

                        openingBalance:
                                ledger.openingBalance,

                        debit:
                            balance.totalDebit,

                        credit:
                            balance.totalCredit,

                        total_outstanding:
                            Math.abs(
                                balance.closingBalance
                            ),

                        balanceType:
                            resolveBalanceType(
                                balance.closingBalance,
                                ledger.nature
                            ),

                        gstin:
                            ledger.agency?.gstin,

                        createdAt:
                            ledger.createdAt,

                        updatedAt:
                            ledger.updatedAt
                    };
                })
            );

        const filteredRows =
            rows.filter(
                row => row.total_outstanding > 0
            );

        return {

            reportName:
                query?.type === "PAYABLE"
                    ? "Accounts Payable Report"
                    : query?.type === "RECEIVABLE"
                        ? "Accounts Receivable Report"
                        : "Outstanding Report",

            generatedAt:
                new Date(),

            summary: {

                totalAgencies:
                    filteredRows.length,

                totalOutstanding:
                    filteredRows.reduce(
                        (sum, row) =>
                            sum + row.total_outstanding,
                        0
                    )
            },

            rows:
                filteredRows
        };
    }
}