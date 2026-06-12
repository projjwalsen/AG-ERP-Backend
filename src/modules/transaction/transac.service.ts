import { TransactionDirection, TransactionPaymentType, PaymentMode, TransactionStatus, PaymentType, OutstandingType } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { randomUUID } from "crypto";
import { RBACService } from "../rbac/rbac.service";

type TransactionPayload = {
    branchId: string;
    direction: TransactionDirection;
    suspense: boolean;
    agencyId?: string;
    paymentType: TransactionPaymentType;
    thirdPartyAgencyId?: string;
    amount: number;
    paymentMode: PaymentMode;
    paymentThrough?: PaymentType;
    transactionRefNo?: string;
    referenceNo?: string;
    remarks?: string;
}

export class TransactionService {

    private static async generateTransactionNo(branchId: string) {
        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { code: true }
        });

        if (!branch) {
            throw new ApiError("Invalid BranchId in generateTransactionNo", 404);
        }

        const unique = randomUUID()
            .replace(/-/g, "")
            .substring(0, 8)
            .toUpperCase();

        return `TRX-${branch.code}-${unique}`;
    }

    private static async getSettings() {
        let setting = await prisma.setting.findFirst();
        if (!setting) {
            setting = await prisma.setting.create({
                data: {}
            });
        }
        return setting;
    }

    private static validatePaymentDetails(
        paymentMode: PaymentMode,
        paymentThrough: PaymentType,
        transactionRefNo?: string,
        referenceNo?: string
    ) {
        const onlineTypes: PaymentType[] = [
            PaymentType.NEFT,
            PaymentType.RTGS,
            PaymentType.UPI,
            PaymentType.BANK_DEPOSIT
        ];

        const offlineRefTypes: PaymentType[] = [
            PaymentType.CHEQUE,
            PaymentType.DD
        ];

        if (paymentMode === PaymentMode.ONLINE && !onlineTypes.includes(paymentThrough)) {
            throw new ApiError("Invalid payment type for ONLINE mode", 400);
        }

        if (paymentMode === PaymentMode.OFFLINE && !["CASH", "CHEQUE", "DD"].includes(paymentThrough)) {
            throw new ApiError("Invalid payment type for OFFLINE mode", 400);
        }

        if (onlineTypes.includes(paymentThrough) && !transactionRefNo?.trim()) {
            throw new ApiError(`${paymentThrough} mode requires Transaction Reference Number`, 400);
        }

        if (onlineTypes.includes(paymentThrough) && referenceNo?.trim()) {
            throw new ApiError(`${paymentThrough} mode should not contain Reference Number`, 400);
        }

        if (offlineRefTypes.includes(paymentThrough) && !referenceNo?.trim()) {
            throw new ApiError(`${paymentThrough} requires Reference Number`, 400);
        }

        if (offlineRefTypes.includes(paymentThrough) && transactionRefNo?.trim()) {
            throw new ApiError(`${paymentThrough} should not contain Transaction Reference Number`, 400);
        }

        if (paymentThrough === PaymentType.CASH && referenceNo) {
            throw new ApiError("Cash transaction should not contain reference number", 400);
        }

        if (paymentThrough === PaymentType.CASH && transactionRefNo) {
            throw new ApiError("Cash transaction should not contain transaction reference number", 400);
        }
    }

    static async createTransaction(actor: any, payload: TransactionPayload) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (!payload.direction || (payload.direction !== TransactionDirection.INWARD && payload.direction !== TransactionDirection.OUTWARD)) {
            throw new ApiError("Transaction direction is required", 400);
        }

        if (!payload.branchId) {
            throw new ApiError("Branch ID is required", 400);
        }

        if (actor.branchAccessType !== "ALL" && payload.branchId !== actor.branchId) {
            throw new ApiError("Cannot create transaction for another branch", 403);
        }

        if (!payload.suspense && !payload.agencyId) {
            throw new ApiError("Agency ID is required for non-suspense transactions", 400);
        }

        if (payload.paymentType === "THIRD_PARTY" && !payload.thirdPartyAgencyId) {
            throw new ApiError("Third party agency ID is required for third party transactions", 400);
        }

        if (payload.amount <= 0) {
            throw new ApiError("Amount must be greater than zero", 400);
        }

        if (!payload.paymentThrough) {
            throw new ApiError("Payment type is required", 400);
        }
        
        const transactionNo = await this.generateTransactionNo(payload.branchId);

        if (!payload.suspense && payload.agencyId) {
            const settings = await this.getSettings();

            if (!settings.allowNegativeTransaction) {
                if (payload.paymentType === TransactionPaymentType.NORMAL) {
                    const outstanding = await this.getAgencyOutstanding(actor, payload.agencyId, payload.branchId);

                    // FIXED: Inward clears what they owe us (amountDue)
                    if (payload.direction === TransactionDirection.INWARD && payload.amount > outstanding.amountDue) {
                        throw new ApiError(`Payment exceeds sales outstanding: ${outstanding.amountDue}. Allow negativeTransaction in settings`, 400);
                    }
            
                    // FIXED: Outward clears what we owe them (amountReceivable)
                    if (payload.direction === TransactionDirection.OUTWARD && payload.amount > outstanding.amountReceivable) {
                        throw new ApiError(`Payment exceeds purchase outstanding: ${outstanding.amountReceivable}. Allow negativeTransaction in settings`, 400);
                    }
                } else if (payload.paymentType === TransactionPaymentType.THIRD_PARTY && payload.thirdPartyAgencyId) {
                    const primaryOutstanding = await this.getAgencyOutstanding(actor, payload.agencyId, payload.branchId);
                    const thirdPartyOutstanding = await this.getAgencyOutstanding(actor, payload.thirdPartyAgencyId, payload.branchId);

                    if (payload.direction === TransactionDirection.INWARD) {
                        if (payload.amount > primaryOutstanding.amountDue) {
                            throw new ApiError(`Payment exceeds primary agency sales outstanding: ${primaryOutstanding.amountDue}. Allow negativeTransaction in settings`, 400);
                        }
                        if (payload.amount > thirdPartyOutstanding.amountReceivable) {
                            throw new ApiError(`Payment exceeds third-party agency purchase outstanding: ${thirdPartyOutstanding.amountReceivable}. Allow negativeTransaction in settings`, 400);
                        }
                    } else if (payload.direction === TransactionDirection.OUTWARD) {
                        if (payload.amount > primaryOutstanding.amountReceivable) {
                            throw new ApiError(`Payment exceeds primary agency purchase outstanding: ${primaryOutstanding.amountReceivable}. Allow negativeTransaction in settings`, 400);
                        }
                        if (payload.amount > thirdPartyOutstanding.amountDue) {
                            throw new ApiError(`Payment exceeds third-party agency sales outstanding: ${thirdPartyOutstanding.amountDue}. Allow negativeTransaction in settings`, 400);
                        }
                    }
                }
            }
        }
        
        const paymentMode = payload.paymentType === TransactionPaymentType.THIRD_PARTY ? PaymentMode.OFFLINE : payload.paymentMode;
        const paymentThrough = payload.paymentType === TransactionPaymentType.THIRD_PARTY ? PaymentType.CASH : payload.paymentThrough;

        this.validatePaymentDetails(paymentMode, paymentThrough, payload.transactionRefNo, payload.referenceNo);

        const isOnlinePayment = paymentThrough === PaymentType.NEFT || paymentThrough === PaymentType.RTGS || paymentThrough === PaymentType.UPI || paymentThrough === PaymentType.BANK_DEPOSIT;
        const isOfflineRefPayment = paymentThrough === PaymentType.CHEQUE || paymentThrough === PaymentType.DD;
        
        const transaction = await prisma.transaction.create({
            data: {
                transactionNo,
                status: "PENDING",
                branchId: payload.branchId,
                direction: payload.direction,
                suspenseAccount: payload.suspense,
                agencyId: payload.agencyId || null,
                paymentType: payload.paymentType,
                thirdPartyAgencyId: payload.thirdPartyAgencyId,
                amount: payload.amount,
                paymentMode,
                paymentThrough,
                transactionRefNo: isOnlinePayment ? payload.transactionRefNo : null,
                referenceNo: isOfflineRefPayment ? payload.referenceNo : null,
                remarks: payload.remarks,
                createdById: actor.id,
            }
        });

        return transaction;
    }

    static async getAgencyOutstanding(actor: any, agencyId?: string, branchId?: string, tx?: any) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (!agencyId) {
            throw new ApiError("Agency ID is required", 400);
        }

        const client = tx || prisma;
        const outstanding = await client.agencyOutstanding.findMany({
            where: {
                agencyId,
                branchId: branchId || actor.branchId
            }
        });

        let debitSum = 0;
        let creditSum = 0;

        for (const entry of outstanding) {
            if (entry.type === OutstandingType.DEBIT) {
                debitSum += Number(entry.amount);
            } else if (entry.type === OutstandingType.CREDIT) {
                creditSum += Number(entry.amount);
            }
        }

        const netDue = debitSum - creditSum;
        const netReceivable = creditSum - debitSum;

        return {
            amountDue: netDue > 0 ? netDue : 0,
            amountReceivable: netReceivable > 0 ? netReceivable : 0
        };
    }

    static async updatePersistentOutstanding(
        tx: any,
        agencyId: string,
        branchId: string,
        deltaAmount: number,
        type: OutstandingType,
        operation: 'ADD' | 'DECREMENT'
    ) {
        const existing = await tx.agencyOutstanding.findFirst({
            where: { agencyId, branchId, type }
        });

        if (existing) {
            const currentAmount = Number(existing.amount);
            const nextAmount = operation === 'ADD' ? currentAmount + deltaAmount : currentAmount - deltaAmount;

            await tx.agencyOutstanding.update({
                where: { id: existing.id },
                data: { amount: nextAmount }
            });
        } else {
            await tx.agencyOutstanding.create({
                data: {
                    agencyId,
                    branchId,
                    type,
                    amount: operation === 'ADD' ? deltaAmount : -deltaAmount
                }
            });
        }
    }

    static async getAllTransactions(
        actor: any,
        query?: {
            page?: number;
            limit?: number;
            branchId?: string;
            agencyId?: string;
            status?: TransactionStatus;
            direction?: TransactionDirection;
            paymentType?: TransactionPaymentType;
            search?: string;
            suspenseAccount?: boolean;
        }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }
        
        const page = query?.page || 1;
        const limit = query?.limit || 10;
        const skip = (page - 1) * limit;
        const where: any = {};

        if (actor.branchAccessType !== "ALL") {
            where.branchId = actor.branchId;
        } else if (query?.branchId) {
            where.branchId = query.branchId;
        }

        if (query?.agencyId) {
            where.agencyId = query.agencyId;
        }

        if (query?.direction) {
            if (query.direction !== TransactionDirection.INWARD && query.direction !== TransactionDirection.OUTWARD) {
                throw new ApiError("Invalid Transaction direction ", 400);
            }
            where.direction = query.direction;
        }

        if (query?.paymentType) {
            if (query.paymentType !== TransactionPaymentType.NORMAL && query.paymentType !== TransactionPaymentType.THIRD_PARTY) {
                throw new ApiError("Invalid Transaction payment type ", 400);
            }
            where.paymentType = query.paymentType;
        }

        if (query?.status) {
            if (query.status !== TransactionStatus.PENDING && query.status !== TransactionStatus.APPROVED && query.status !== TransactionStatus.REJECTED) {
                throw new ApiError("Invalid transaction status", 400);
            }
            where.status = query.status;
        }

        if (query?.suspenseAccount !== undefined) {
            if (typeof query.suspenseAccount !== "boolean") {
                throw new ApiError("Suspense account filter must be a boolean", 400);
            }
            where.suspenseAccount = query.suspenseAccount;
        }

        if (query?.search) {
            where.OR = [
                { transactionNo: { contains: query.search, mode: "insensitive" } },
                { transactionRefNo: { contains: query.search, mode: "insensitive" } },
            ];
        }

        const [transactions, total] = await Promise.all([
            prisma.transaction.findMany({
                where,
                include: { branch: true, agency: true, thirdPartyAgency: true, createdBy: true },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            }),
            prisma.transaction.count({ where })
        ]);

        return {
            data: transactions,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1,
            }
        };
    }

    static async getTransactionById(actor: any, transactionId: string) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (!transactionId) {
            throw new ApiError("Transaction ID is required", 400);
        }

        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
            include: { branch: true, agency: true, thirdPartyAgency: true, createdBy: true }
        });
        
        if (!transaction) {
            throw new ApiError("Transaction not found", 404);
        }
        
        if (actor.branchAccessType !== "ALL" && transaction.branchId !== actor.branchId) {
            throw new ApiError("You don't have access to this transaction", 403);
        }

        return transaction;
    }

    static async approveTransaction(actor: any, transactionId: string) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (!transactionId) {
            throw new ApiError("Transaction ID is required", 400);
        }

        const canApprove = await RBACService.hasPermission(actor.id, "TRANSACTION:APPROVE");
        if (!canApprove) {
            throw new ApiError("Forbidden: insufficient permissions to approve transaction", 403);
        }

        return prisma.$transaction(async (tx) => {
            const transaction = await tx.transaction.findUnique({
                where: { id: transactionId },
            });

            if (!transaction) {
                throw new ApiError("Transaction not found", 404);
            }

            if (transaction.status !== "PENDING") {
                throw new ApiError("Only pending transactions can be approved", 400);
            }

            /** Optimistic locking */
            const lock = await tx.transaction.updateMany({
                where: { id: transactionId, status: TransactionStatus.PENDING },
                data: {
                    status: TransactionStatus.APPROVED,
                    updatedAt: new Date()
                }
            });

            if (lock.count === 0) {
                throw new ApiError("Transaction was already processed by another user, please refresh and try again", 409);
            }

            /** Suspensse transaction --> no allocation */
            if (transaction.suspenseAccount || !transaction.agencyId) {
                return tx.transaction.findUnique({
                    where: { id: transactionId },
                });
            }

            const outstanding = await this.getAgencyOutstanding(actor, transaction.agencyId, transaction.branchId, tx);
            const settings = await this.getSettings();

            if (!settings.allowNegativeTransaction) {
                if (transaction.paymentType === TransactionPaymentType.NORMAL) {
                    // FIXED: Inward payments validate against amountDue, Outward against amountReceivable
                    if (
                        transaction.direction === TransactionDirection.INWARD &&
                        Number(transaction.amount) > outstanding.amountDue
                    ) {
                        throw new ApiError(`Outstanding changed. Available sales outstanding: ${outstanding.amountDue}. Allow negativeTransaction in settings`, 409);
                    }
        
                    if (
                        transaction.direction === TransactionDirection.OUTWARD &&
                        Number(transaction.amount) > outstanding.amountReceivable
                    ) {
                        throw new ApiError(`Outstanding changed. Available purchase outstanding: ${outstanding.amountReceivable}. Allow negativeTransaction in settings`, 409);
                    }
                } else if (transaction.paymentType === TransactionPaymentType.THIRD_PARTY && transaction.thirdPartyAgencyId) {
                    const thirdPartyOutstanding = await this.getAgencyOutstanding(actor, transaction.thirdPartyAgencyId, transaction.branchId, tx);

                    if (transaction.direction === TransactionDirection.INWARD) {
                        if (Number(transaction.amount) > outstanding.amountDue) {
                            throw new ApiError(`Outstanding changed. Available primary sales outstanding: ${outstanding.amountDue}. Allow negativeTransaction in settings`, 409);
                        }
                        if (Number(transaction.amount) > thirdPartyOutstanding.amountReceivable) {
                            throw new ApiError(`Outstanding changed. Available third-party purchase outstanding: ${thirdPartyOutstanding.amountReceivable}. Allow negativeTransaction in settings`, 409);
                        }
                    } else if (transaction.direction === TransactionDirection.OUTWARD) {
                        if (Number(transaction.amount) > outstanding.amountReceivable) {
                            throw new ApiError(`Outstanding changed. Available primary purchase outstanding: ${outstanding.amountReceivable}. Allow negativeTransaction in settings`, 409);
                        }
                        if (Number(transaction.amount) > thirdPartyOutstanding.amountDue) {
                            throw new ApiError(`Outstanding changed. Available third-party sales outstanding: ${thirdPartyOutstanding.amountDue}. Allow negativeTransaction in settings`, 409);
                        }
                    }
                }
            }

            const amt = Number(transaction.amount);

            // =================================================================
            // ACCOUNTING PERSISTENT TRACKING (FIXED AND VERIFIED DIRECTION SIGNS)
            // =================================================================
            if (transaction.paymentType === TransactionPaymentType.NORMAL) {
                if (transaction.direction === TransactionDirection.INWARD) {
                    // Normal Inward: Customer pays us -> Log a CREDIT entry to clear their active DEBIT row
                    await this.updatePersistentOutstanding(tx, transaction.agencyId, transaction.branchId, amt, "CREDIT", 'ADD');
                } else {
                    // Normal Outward: We pay a vendor -> Log a DEBIT entry to clear our active CREDIT row
                    await this.updatePersistentOutstanding(tx, transaction.agencyId, transaction.branchId, amt, "DEBIT", 'ADD');
                }
            } 
            // =================================================================
            // THIRD PARTY LEDGER PERSISTENCE CONFIGURATION
            // =================================================================
            else if (transaction.paymentType === TransactionPaymentType.THIRD_PARTY && transaction.thirdPartyAgencyId) {
                if (transaction.direction === TransactionDirection.INWARD) {
                    // Primary Customer (Amit) gets cleared via incoming payment -> ADD CREDIT
                    await this.updatePersistentOutstanding(tx, transaction.agencyId, transaction.branchId, amt, "CREDIT", 'ADD');
                    // Third-Party Agency (Bappa) pays on their behalf -> Gaining credit balance with us -> ADD CREDIT
                    await this.updatePersistentOutstanding(tx, transaction.thirdPartyAgencyId, transaction.branchId, amt, "CREDIT", 'ADD');
                } 
                else if (transaction.direction === TransactionDirection.OUTWARD) {
                    // Primary Vendor gets clear -> ADD DEBIT
                    await this.updatePersistentOutstanding(tx, transaction.agencyId, transaction.branchId, amt, "DEBIT", 'ADD');
                    // Third-Party Agency reclaims/consumes balance credit -> ADD DEBIT
                    await this.updatePersistentOutstanding(tx, transaction.thirdPartyAgencyId, transaction.branchId, amt, "DEBIT", 'ADD');
                }
            }

            let remainingAmount = amt;

            if (transaction.paymentType === TransactionPaymentType.NORMAL) {
                if (transaction.direction === TransactionDirection.INWARD) {
                    const sales = await tx.sale.findMany({
                        where: { agencyId: transaction.agencyId, branchId: transaction.branchId, status: "APPROVED" },
                        include: { allocations: true },
                        orderBy: { createdAt: "asc" }
                    });

                    for (const sale of sales) {
                        if (remainingAmount <= 0) break;
                        const allocated = sale.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
                        const outstandingAmt = Number(sale.grandTotal) - allocated;
                        if (outstandingAmt <= 0) continue;

                        const allocationAmount = Math.min(outstandingAmt, remainingAmount);
                        await tx.transactionAllocation.create({
                            data: { transactionId: transaction.id, saleId: sale.id, allocatedAmount: allocationAmount, sourceType: "SALE" }
                        });
                        remainingAmount -= allocationAmount;
                    }
                } else {
                    const purchases = await tx.purchase.findMany({
                        where: { agencyId: transaction.agencyId, branchId: transaction.branchId, status: "APPROVED" },
                        include: { allocations: true },
                        orderBy: { createdAt: "asc" }
                    });

                    for (const purchase of purchases) {
                        if (remainingAmount <= 0) break;
                        const allocated = purchase.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
                        const outstandingAmt = Number(purchase.grandTotal) - allocated;
                        if (outstandingAmt <= 0) continue;

                        const allocationAmount = Math.min(outstandingAmt, remainingAmount);
                        await tx.transactionAllocation.create({
                            data: { transactionId: transaction.id, purchaseId: purchase.id, allocatedAmount: allocationAmount, sourceType: "PURCHASE" }
                        });
                        remainingAmount -= allocationAmount;
                    }
                }
            } else if (transaction.paymentType === TransactionPaymentType.THIRD_PARTY && transaction.thirdPartyAgencyId) {
                if (transaction.direction === TransactionDirection.OUTWARD) {
                    let primaryRemainingAmount = remainingAmount;
                    let thirdPartyRemainingAmount = remainingAmount;

                    const primaryPurchases = await tx.purchase.findMany({
                        where: { agencyId: transaction.agencyId, branchId: transaction.branchId, status: "APPROVED" },
                        include: { allocations: true }, orderBy: { createdAt: "asc" }
                    });

                    for (const purchase of primaryPurchases) {
                        if (primaryRemainingAmount <= 0) break;
                        const allocated = purchase.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
                        const outstandingAmt = Number(purchase.grandTotal) - allocated;
                        if (outstandingAmt <= 0) continue;

                        const allocationAmount = Math.min(outstandingAmt, primaryRemainingAmount);
                        await tx.transactionAllocation.create({
                            data: { transactionId: transaction.id, purchaseId: purchase.id, allocatedAmount: allocationAmount, sourceType: "PURCHASE" }
                        });
                        primaryRemainingAmount -= allocationAmount;
                    }

                    const thirdPartySales = await tx.sale.findMany({
                        where: { agencyId: transaction.thirdPartyAgencyId, branchId: transaction.branchId, status: "APPROVED" },
                        include: { allocations: true }, orderBy: { createdAt: "asc" }
                    });

                    for (const sale of thirdPartySales) {
                        if (thirdPartyRemainingAmount <= 0) break;
                        const allocated = sale.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
                        const outstandingAmt = Number(sale.grandTotal) - allocated;
                        if (outstandingAmt <= 0) continue;

                        const allocationAmount = Math.min(outstandingAmt, thirdPartyRemainingAmount);
                        await tx.transactionAllocation.create({
                            data: { transactionId: transaction.id, saleId: sale.id, allocatedAmount: allocationAmount, sourceType: "SALE" }
                        });
                        thirdPartyRemainingAmount -= allocationAmount;
                    }
                } else {
                    let primaryRemainingAmount = remainingAmount;
                    let thirdPartyRemainingAmount = remainingAmount;

                    const primarySales = await tx.sale.findMany({
                        where: { agencyId: transaction.agencyId, branchId: transaction.branchId, status: "APPROVED" },
                        include: { allocations: true }, orderBy: { createdAt: "asc" }
                    });

                    for (const sale of primarySales) {
                        if (primaryRemainingAmount <= 0) break;
                        const allocated = sale.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
                        const outstandingAmt = Number(sale.grandTotal) - allocated;
                        if (outstandingAmt <= 0) continue;

                        const allocationAmount = Math.min(outstandingAmt, primaryRemainingAmount);
                        await tx.transactionAllocation.create({
                            data: { transactionId: transaction.id, saleId: sale.id, allocatedAmount: allocationAmount, sourceType: "SALE" }
                        });
                        primaryRemainingAmount -= allocationAmount;
                    }

                    const thirdPartyPurchases = await tx.purchase.findMany({
                        where: { agencyId: transaction.thirdPartyAgencyId, branchId: transaction.branchId, status: "APPROVED" },
                        include: { allocations: true }, orderBy: { createdAt: "asc" }
                    });

                    for (const purchase of thirdPartyPurchases) {
                        if (thirdPartyRemainingAmount <= 0) break;
                        const allocated = purchase.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
                        const outstandingAmt = Number(purchase.grandTotal) - allocated;
                        if (outstandingAmt <= 0) continue;

                        const allocationAmount = Math.min(outstandingAmt, thirdPartyRemainingAmount);
                        await tx.transactionAllocation.create({
                            data: { transactionId: transaction.id, purchaseId: purchase.id, allocatedAmount: allocationAmount, sourceType: "PURCHASE" }
                        });
                        thirdPartyRemainingAmount -= allocationAmount;
                    }
                }
            }

            return tx.transaction.findUnique({
                where: { id: transactionId },
                include: { allocations: true, branch: true, agency: true, thirdPartyAgency: true, createdBy: true }
            });
        });
    }

    static async rejectTransaction(actor: any, transactionId: string, remarks?: string) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        if (!transactionId) throw new ApiError("Transaction ID is required", 400);

        const canReject = await RBACService.hasPermission(actor.id, "TRANSACTION:APPROVE");
        if (!canReject) throw new ApiError("Forbidden: insufficient permissions to reject transaction", 403);

        return prisma.$transaction(async (tx) => {
            const transaction = await tx.transaction.findUnique({ where: { id: transactionId } });
            if (!transaction || transaction.status !== TransactionStatus.PENDING) {
                throw new ApiError("Only pending transactions can be rejected", 400);
            }

            const lock = await tx.transaction.updateMany({
                where: { id: transactionId, status: TransactionStatus.PENDING },
                data: {
                    status: TransactionStatus.REJECTED,
                    updatedAt: new Date(),
                    remarks: remarks?.trim() ? remarks.trim() : transaction.remarks
                }
            });

            if (lock.count === 0) throw new ApiError("Transaction already processed by another user. Please refresh", 409);

            return tx.transaction.findUnique({
                where: { id: transactionId },
                include: { allocations: true, branch: true, agency: true, thirdPartyAgency: true, createdBy: true }
            });
        });
    }

    static async updateTransaction(actor: any, transactionId: string, payload: Partial<TransactionPayload>) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        if (!transactionId) throw new ApiError("Transaction ID is required", 400);

        const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
        if (!transaction) throw new ApiError("Transaction not found", 404);
        if (transaction.status !== TransactionStatus.PENDING) throw new ApiError("Only pending transactions can be updated", 400);

        const finalBranchId = payload.branchId ?? transaction.branchId;
        const finalDirection = payload.direction ?? transaction.direction;
        const finalSuspense = payload.suspense ?? transaction.suspenseAccount;
        const finalAgencyId = payload.agencyId ?? transaction.agencyId;
        const finalPaymentType = payload.paymentType ?? transaction.paymentType;
        const finalThirdPartyAgencyId = payload.thirdPartyAgencyId ?? transaction.thirdPartyAgencyId;
        const finalAmount = payload.amount ?? Number(transaction.amount);
        let finalPaymentMode = payload.paymentMode ?? transaction.paymentMode;
        let finalPaymentThrough = payload.paymentThrough ?? transaction.paymentThrough;
        const finalTransactionRefNo = payload.transactionRefNo ?? transaction.transactionRefNo;
        const finalReferenceNo = payload.referenceNo ?? transaction.referenceNo;

        if (actor.branchAccessType !== "ALL" && finalBranchId !== actor.branchId) {
            throw new ApiError("Cannot move transaction to another branch", 403);
        }

        if (finalAmount <= 0) throw new ApiError("Amount must be greater than zero", 400);
        if (!finalSuspense && !finalAgencyId) throw new ApiError("Agency ID is required for non-suspense transactions", 400);

        if (finalPaymentType === TransactionPaymentType.THIRD_PARTY && !finalThirdPartyAgencyId) {
            throw new ApiError("Third party agency ID is required", 400);
        }

        if (finalPaymentType === TransactionPaymentType.THIRD_PARTY) {
            finalPaymentMode = PaymentMode.OFFLINE;
            finalPaymentThrough = PaymentType.CASH;
        }

        this.validatePaymentDetails(finalPaymentMode, finalPaymentThrough, finalTransactionRefNo, finalReferenceNo);

        if (!finalSuspense && finalAgencyId) {
            const outstanding = await this.getAgencyOutstanding(actor, finalAgencyId, finalBranchId);
            const settings = await this.getSettings();

            if (!settings.allowNegativeTransaction) {
                if (finalPaymentType === TransactionPaymentType.NORMAL) {
                    // FIXED: Inward validates against amountDue, Outward against amountReceivable
                    const effectiveOutstanding = finalDirection === TransactionDirection.INWARD ? outstanding.amountDue : outstanding.amountReceivable;

                    if (finalAmount > effectiveOutstanding) {
                        throw new ApiError(`Amount exceeds available outstanding. Allow negativeTransaction in settings`, 400);
                    }
                } else if (finalPaymentType === TransactionPaymentType.THIRD_PARTY && finalThirdPartyAgencyId) {
                    const thirdPartyOutstanding = await this.getAgencyOutstanding(actor, finalThirdPartyAgencyId, finalBranchId);

                    if (finalDirection === TransactionDirection.INWARD) {
                        if (finalAmount > outstanding.amountDue) throw new ApiError(`Amount exceeds primary agency sales outstanding. Allow negativeTransaction in settings`, 400);
                        if (finalAmount > thirdPartyOutstanding.amountReceivable) throw new ApiError(`Amount exceeds third-party agency purchase outstanding. Allow negativeTransaction in settings`, 400);
                    } else if (finalDirection === TransactionDirection.OUTWARD) {
                        if (finalAmount > outstanding.amountReceivable) throw new ApiError(`Amount exceeds primary agency purchase outstanding. Allow negativeTransaction in settings`, 400);
                        if (finalAmount > thirdPartyOutstanding.amountDue) throw new ApiError(`Amount exceeds third-party agency sales outstanding. Allow negativeTransaction in settings`, 400);
                    }
                }
            }
        }

        const updated = await prisma.transaction.updateMany({
            where: { id: transactionId, status: TransactionStatus.PENDING },
            data: {
                branchId: finalBranchId,
                direction: finalDirection,
                suspenseAccount: finalSuspense,
                agencyId: finalAgencyId,
                paymentType: finalPaymentType,
                thirdPartyAgencyId: finalThirdPartyAgencyId,
                amount: finalAmount,
                paymentMode: finalPaymentMode,
                paymentThrough: finalPaymentThrough,
                transactionRefNo: finalPaymentThrough === PaymentType.NEFT || finalPaymentThrough === PaymentType.RTGS || finalPaymentThrough === PaymentType.UPI || finalPaymentThrough === PaymentType.BANK_DEPOSIT ? finalTransactionRefNo : null,
                referenceNo: finalPaymentThrough === PaymentType.CHEQUE || finalPaymentThrough === PaymentType.DD ? finalReferenceNo : null,
                remarks: payload.remarks ?? transaction.remarks,
            },
        });

        if (updated.count === 0) throw new ApiError("Transaction was modified by another user", 409);

        return prisma.transaction.findUnique({
            where: { id: transactionId },
            include: { branch: true, agency: true, thirdPartyAgency: true, createdBy: true },
        });
    }
}