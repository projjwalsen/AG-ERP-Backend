import { TransactionDirection } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { parseDate } from "../../core/utils/loc.utils";

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


    static async getAgingReport(
        actor: any,
        type: "AR" | "AP",
        query?: {
            branchId?: string;
        }
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        
    }
}