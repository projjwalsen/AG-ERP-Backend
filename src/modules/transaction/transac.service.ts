import { TransactionDirection, TransactionPaymentType, PaymentMode, TransactionStatus, PaymentType } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { randomUUID } from "crypto"
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
    transactionRefNo?: string; // NEFT/RTGS/UPI/BANK_DEPOSIT
    referenceNo?: string; // CHEQUE / DD
    remarks?: string;
}

export class TransactionService {

    private static async generateTransactionNo(
        branchId: string,
    ) {
        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { code: true }
        });

        if(!branch) {
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
        if(!setting){
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

        if (
            paymentMode === PaymentMode.ONLINE &&
            !onlineTypes.includes(paymentThrough)
        ) {
            throw new ApiError(
                "Invalid payment type for ONLINE mode",
                400
            );
        }

        if (
            paymentMode === PaymentMode.OFFLINE &&
            ![
                "CASH", "CHEQUE", "DD"
            ].includes(paymentThrough)
        ) {
            throw new ApiError(
                "Invalid payment type for OFFLINE mode",
                400
            );
        }

        // ONLINE -> requires transactionRefNo
        if (
            onlineTypes.includes(paymentThrough) &&
            !transactionRefNo?.trim()
        ) {
            throw new ApiError(
                `${paymentThrough} mode requires Transaction Reference Number`,
                400
            );
        }

        // ONLINE -> should not contain referenceNo
        if(
            onlineTypes.includes(paymentThrough) &&
            referenceNo?.trim()
        ) {
            throw new ApiError(
                `${paymentThrough} mode should not contain Reference Number`,
                400
            );
        }

        // OFFLINE -> requires referenceNo
        if (
            offlineRefTypes.includes(paymentThrough) &&
            !referenceNo?.trim()
        ) {
            throw new ApiError(
                `${paymentThrough} requires Reference Number`,
                400
            );
        }

        // OFFLINE -> should not contain transactionRefNo
        if (
            offlineRefTypes.includes(paymentThrough) &&
            transactionRefNo?.trim()
        ) {
            throw new ApiError(
                `${paymentThrough} should not contain Transaction Reference Number`,
                400
            );
        }
        // CASH -> should not contain transactionRefNo or referenceNo
        if (
            paymentThrough === PaymentType.CASH &&
            referenceNo
        ) {
            throw new ApiError(
                "Cash transaction should not contain reference number",
                400
            );
        }

        if(
            paymentThrough === PaymentType.CASH &&
            transactionRefNo
        ) {
            throw new ApiError(
                "Cash transaction should not contain transaction reference number",
                400
            );
        }
    }

    static async createTransaction(
        actor: any,
        payload: TransactionPayload
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        if(!payload.direction || (payload.direction !== TransactionDirection.INWARD && payload.direction !== TransactionDirection.OUTWARD)){
            throw new ApiError("Transaction direction is required", 400);
        }

        if(!payload.branchId){
            throw new ApiError("Branch ID is required", 400);
        }

        if (
            actor.branchAccessType !== "ALL" &&
            payload.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "Cannot create transaction for another branch",
                403
            );
        }

        if(!payload.suspense && !payload.agencyId){
            throw new ApiError("Agency ID is required for non-suspense transactions", 400);
        }

        if(
            payload.paymentType === "THIRD_PARTY" &&
            !payload.thirdPartyAgencyId
        ) {
            throw new ApiError("Third party agency ID is required for third party transactions", 400);
        }

        if(payload.amount <= 0){
            throw new ApiError("Amount must be greater than zero", 400);
        }

        if (!payload.paymentThrough) {
            throw new ApiError("Payment type is required", 400);
        }
        
        const transactionNo = await this.generateTransactionNo(payload.branchId);

        // THIRD - PARTY TRANSACTIONS
        if(!payload.suspense && payload.agencyId) {
            const settings = await this.getSettings();

            if(!settings.allowNegativeTransaction) {
                
                if(payload.paymentType === TransactionPaymentType.NORMAL) {
                    // For NORMAL transactions, check primary agency's outstanding
                    const outstanding = await this.getAgencyOutstanding(
                        actor,
                        payload.agencyId,
                        payload.branchId,
                    );

                    if(payload.direction === TransactionDirection.INWARD &&
                        payload.amount > outstanding.salesOutstanding
                    ) {
                        throw new ApiError(`Payment exceeds sales outstanding: ${outstanding.salesOutstanding}. Allow negativeTransaction in settings`, 400);
                    }
            
                    if(payload.direction === TransactionDirection.OUTWARD &&
                        payload.amount > outstanding.purchaseOutstanding
                    ) {
                        throw new ApiError(`Payment exceeds purchase outstanding: ${outstanding.purchaseOutstanding}. Allow negativeTransaction in settings`, 400);
                    }
                } else if(payload.paymentType === TransactionPaymentType.THIRD_PARTY && payload.thirdPartyAgencyId) {
                    // For THIRD_PARTY transactions, check both agencies
                    const primaryOutstanding = await this.getAgencyOutstanding(
                        actor,
                        payload.agencyId,
                        payload.branchId,
                    );

                    const thirdPartyOutstanding = await this.getAgencyOutstanding(
                        actor,
                        payload.thirdPartyAgencyId,
                        payload.branchId,
                    );

                    if(payload.direction === TransactionDirection.INWARD) {
                        // INWARD: Primary receives (salesOutstanding), Third-party pays (purchaseOutstanding)
                        if(payload.amount > primaryOutstanding.salesOutstanding) {
                            throw new ApiError(`Payment exceeds primary agency sales outstanding: ${primaryOutstanding.salesOutstanding}. Allow negativeTransaction in settings`, 400);
                        }
                        if(payload.amount > thirdPartyOutstanding.purchaseOutstanding) {
                            throw new ApiError(`Payment exceeds third-party agency purchase outstanding: ${thirdPartyOutstanding.purchaseOutstanding}. Allow negativeTransaction in settings`, 400);
                        }
                    } else if(payload.direction === TransactionDirection.OUTWARD) {
                        // OUTWARD: Primary pays (purchaseOutstanding), Third-party benefit (salesOutstanding)
                        if(payload.amount > primaryOutstanding.purchaseOutstanding) {
                            throw new ApiError(`Payment exceeds primary agency purchase outstanding: ${primaryOutstanding.purchaseOutstanding}. Allow negativeTransaction in settings`, 400);
                        }
                        if(payload.amount > thirdPartyOutstanding.salesOutstanding) {
                            throw new ApiError(`Payment exceeds third-party agency sales outstanding: ${thirdPartyOutstanding.salesOutstanding}. Allow negativeTransaction in settings`, 400);
                        }
                    }
                }
            }

        }
        
        const paymentMode = 
            payload.paymentType === TransactionPaymentType.THIRD_PARTY
            ? PaymentMode.OFFLINE
            : payload.paymentMode;
        
        const paymentThrough = 
            payload.paymentType === TransactionPaymentType.THIRD_PARTY
            ? PaymentType.CASH
            : payload.paymentThrough;

        this.validatePaymentDetails(
            paymentMode,
            paymentThrough,
            payload.transactionRefNo,
            payload.referenceNo
        );

        const isOnlinePayment =
            paymentThrough === PaymentType.NEFT ||
            paymentThrough === PaymentType.RTGS ||
            paymentThrough === PaymentType.UPI ||
            paymentThrough === PaymentType.BANK_DEPOSIT;

        const isOfflineRefPayment =
            paymentThrough === PaymentType.CHEQUE ||
            paymentThrough === PaymentType.DD;
        
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

    static async getAgencyOutstanding(
        actor: any,
        agencyId?: string,
        branchId?: string,
        excludeTransactionId?: string,
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        if(!agencyId){
            throw new ApiError("Agency ID is required", 400);
        }

        const [sales, purchases, pendingTransactions] = await Promise.all([
            prisma.sale.findMany({
                where: {
                    agencyId,
                    ...(branchId && { branchId }),
                    status: "APPROVED",
                },
                include: {
                    allocations: {
                        select: {
                            allocatedAmount: true,
                        }
                    }
                }
            }),

            prisma.purchase.findMany({
                where: {
                    agencyId,
                    ...(branchId && { branchId }),
                    status: "APPROVED",
                },
                include: {
                    allocations: {
                        select: {
                            allocatedAmount: true,
                        }
                    }
                }
            }),

            prisma.transaction.findMany({
                where: {
                    OR: [
                        {
                            agencyId,
                            ...(branchId && { branchId }),
                        },
                        {
                            thirdPartyAgencyId: agencyId,
                            ...(branchId && { branchId }),
                        }
                    ],
                    ...(excludeTransactionId && {
                        id: { not: excludeTransactionId }
                    }),
                    status: TransactionStatus.PENDING,
                    suspenseAccount: false,
                },
                select: {
                    agencyId: true,
                    thirdPartyAgencyId: true,
                    direction: true,
                    paymentType: true,
                    amount: true,
                }
            })
        ]);

        /**
         * SALES Outstanding = Customer still owes us money
         */
        const approvedSalesOutstanding = sales.reduce((sum, sale) => {
            const allocated = sale.allocations.reduce(
                (a, alloc) => a + Number(alloc.allocatedAmount),
                0
            );
            return sum + (Number(sale.grandTotal) - allocated);
        }, 0);

        /**
         * PURCHASE Outstanding = We still owe vendor money
         */
        const approvedPurchaseOutstanding = purchases.reduce((sum, purchase) => {
            const allocated = purchase.allocations.reduce(
                (a, alloc) => a + Number(alloc.allocatedAmount),
                0
            );
            return sum + (Number(purchase.grandTotal) - allocated);
        }, 0);

        const pendingSalesAdjustment = pendingTransactions.reduce(
            (sum, transaction) => {
                let appliesToSales = false;

                if (transaction.paymentType === TransactionPaymentType.NORMAL) {
                    // NORMAL INWARD: reduces salesOutstanding
                    appliesToSales = transaction.direction === TransactionDirection.INWARD;
                } else if (transaction.paymentType === TransactionPaymentType.THIRD_PARTY) {
                    // THIRD_PARTY: depends on which role we're playing
                    if (transaction.agencyId === agencyId) {
                        // We're the primary
                        // INWARD: reduces salesOutstanding
                        // OUTWARD: reduces purchaseOutstanding (not sales)
                        appliesToSales = transaction.direction === TransactionDirection.INWARD;
                    } else if (transaction.thirdPartyAgencyId === agencyId) {
                        // We're the third-party
                        // OUTWARD: reduces salesOutstanding (payment on behalf of customers)
                        // INWARD: reduces purchaseOutstanding (not sales)
                        appliesToSales = transaction.direction === TransactionDirection.OUTWARD;
                    }
                }

                return appliesToSales
                    ? sum + Number(transaction.amount)
                    : sum;
            },
            0
        );

        const pendingPurchaseAdjustment = pendingTransactions.reduce(
            (sum, transaction) => {
                let appliesToPurchase = false;

                if (transaction.paymentType === TransactionPaymentType.NORMAL) {
                    // NORMAL OUTWARD: reduces purchaseOutstanding
                    appliesToPurchase = transaction.direction === TransactionDirection.OUTWARD;
                } else if (transaction.paymentType === TransactionPaymentType.THIRD_PARTY) {
                    // THIRD_PARTY: depends on which role we're playing
                    if (transaction.agencyId === agencyId) {
                        // We're the primary
                        // OUTWARD: reduces purchaseOutstanding
                        // INWARD: reduces salesOutstanding (not purchase)
                        appliesToPurchase = transaction.direction === TransactionDirection.OUTWARD;
                    } else if (transaction.thirdPartyAgencyId === agencyId) {
                        // We're the third-party
                        // INWARD: reduces purchaseOutstanding (payment due to vendors)
                        // OUTWARD: reduces salesOutstanding (not purchase)
                        appliesToPurchase = transaction.direction === TransactionDirection.INWARD;
                    }
                }

                return appliesToPurchase
                    ? sum + Number(transaction.amount)
                    : sum;
            },
            0
        );

        const salesOutstanding =
            approvedSalesOutstanding - pendingSalesAdjustment;

        const purchaseOutstanding =
            approvedPurchaseOutstanding - pendingPurchaseAdjustment;

        return {
            salesOutstanding,
            purchaseOutstanding
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
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }
        
        const page = query?.page || 1;
        const limit = query?.limit || 10;
        const skip = (page - 1) * limit;

        const where: any = {};

        // Branch-level security
        if (actor.branchAccessType !== "ALL") {
            where.branchId = actor.branchId;
        } else if (query?.branchId) {
            where.branchId = query.branchId;
        }

        if(query?.agencyId){
            where.agencyId = query.agencyId;
        }

        if(query?.direction){
            if(
                query.direction !== TransactionDirection.INWARD && 
                query.direction !== TransactionDirection.OUTWARD
            ){
                throw new ApiError("Invalid Transaction direction ", 400);
            }
            where.direction = query.direction;
        }

        if(query?.paymentType){
            if(
                query.paymentType !== TransactionPaymentType.NORMAL &&
                query.paymentType !== TransactionPaymentType.THIRD_PARTY
            ){
                throw new ApiError("Invalid Transaction payment type ", 400);
            }
            where.paymentType = query.paymentType;
        }

        if (query?.status) {
            if (
                query.status !== TransactionStatus.PENDING &&
                query.status !== TransactionStatus.APPROVED &&
                query.status !== TransactionStatus.REJECTED
            ) {
                throw new ApiError("Invalid transaction status", 400);
            }

            where.status = query.status;
        }

        if(query?.suspenseAccount !== undefined){
            if(typeof query.suspenseAccount !== "boolean"){
                throw new ApiError("Suspense account filter must be a boolean", 400);
            }
            where.suspenseAccount = query.suspenseAccount;
        }

        if (query?.search) {
            where.OR = [
                { 
                    transactionNo: { 
                        contains: query.search, 
                        mode: "insensitive" 
                    } 
                },
                { 
                    transactionRefNo: { 
                        contains: query.search, 
                        mode: "insensitive" 
                    } 
                },
            ];
        }


        const [transactions, total] = await Promise.all([
            prisma.transaction.findMany({
                where,
                include: {
                    branch: true,
                    agency: true,
                    thirdPartyAgency: true,
                    createdBy: true
                },
                orderBy: {
                    createdAt: "desc",
                },
                skip,
                take: limit,
            }),
            prisma.transaction.count({ where })
        ])

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
        }

    }

    static async getTransactionById(
        actor: any,
        transactionId: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        if(!transactionId){
            throw new ApiError("Transaction ID is required", 400);
        }

        
        const transaction = await prisma.transaction.findUnique({
            where: { 
                id: transactionId 
            },
            include: {
                branch: true,
                agency: true,
                thirdPartyAgency: true,
                createdBy: true
            }
        });
        
        if(!transaction){
            throw new ApiError("Transaction not found", 404);
        }
        
        if (
            actor.branchAccessType !== "ALL" &&
            transaction.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "You don't have access to this transaction",
                403
            );
        }

        return transaction;
    }

    static async approveTransaction(
        actor: any,
        transactionId: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        if(!transactionId){
            throw new ApiError("Transaction ID is required", 400);
        }

        const canApprove = await RBACService.hasPermission(
            actor.id,
            "TRANSACTION:APPROVE"
        );

        if(!canApprove){
            throw new ApiError("Forbidden: insufficient permissions to approve transaction", 403);
        }

        return prisma.$transaction(async (tx) => {
            const transaction = await tx.transaction.findUnique({
                where: { id: transactionId },
            });

            if (!transaction) {
                throw new ApiError("Transaction not found", 404);
            }

            if(
                transaction.status !== "PENDING"
            ) {
                throw new ApiError("Only pending transactions can be approved", 400);
            }

            /** Optimistic locking */
            const lock = await tx.transaction.updateMany({
                where: {
                    id: transactionId,
                    status: TransactionStatus.PENDING
                },
                data: {
                    status: TransactionStatus.APPROVED,
                    createdById: actor.id,
                    updatedAt: new Date()
                }
            });

            if(lock.count === 0){
                throw new ApiError("Transaction was already processed by another user, please refresh and try again", 409);
            }

            /** Suspensse transaction --> no allocation */
            if(
                transaction.suspenseAccount ||
                !transaction.agencyId
            ) {
                return tx.transaction.findUnique({
                    where: { id: transactionId },
                });
            }

            const outstanding = await this.getAgencyOutstanding(
                actor,
                transaction.agencyId,
                transaction.branchId,
                transactionId,
            );

            const settings = await this.getSettings();

            if(!settings.allowNegativeTransaction) {
                if(transaction.paymentType === TransactionPaymentType.NORMAL) {
                    // For NORMAL transactions, check primary agency's outstanding
                    if (
                        transaction.direction === TransactionDirection.INWARD &&
                        Number(transaction.amount) > outstanding.salesOutstanding
                    ) {
                        throw new ApiError(
                            `Outstanding changed. Available sales outstanding: ${outstanding.salesOutstanding}. Allow negativeTransaction in settings`,
                            409
                        );
                    }
        
                    if (
                        transaction.direction === TransactionDirection.OUTWARD &&
                        Number(transaction.amount) > outstanding.purchaseOutstanding
                    ) {
                        throw new ApiError(
                            `Outstanding changed. Available purchase outstanding: ${outstanding.purchaseOutstanding}. Allow negativeTransaction in settings`,
                            409
                        );
                    }
                } else if(transaction.paymentType === TransactionPaymentType.THIRD_PARTY && transaction.thirdPartyAgencyId) {
                    // For THIRD_PARTY, check both agencies
                    const thirdPartyOutstanding = await this.getAgencyOutstanding(
                        actor,
                        transaction.thirdPartyAgencyId,
                        transaction.branchId,
                        transactionId,
                    );

                    if(transaction.direction === TransactionDirection.INWARD) {
                        // INWARD: Primary receives (salesOutstanding), Third-party pays (purchaseOutstanding)
                        if (
                            Number(transaction.amount) > outstanding.salesOutstanding
                        ) {
                            throw new ApiError(
                                `Outstanding changed. Available primary sales outstanding: ${outstanding.salesOutstanding}. Allow negativeTransaction in settings`,
                                409
                            );
                        }
                        if (
                            Number(transaction.amount) > thirdPartyOutstanding.purchaseOutstanding
                        ) {
                            throw new ApiError(
                                `Outstanding changed. Available third-party purchase outstanding: ${thirdPartyOutstanding.purchaseOutstanding}. Allow negativeTransaction in settings`,
                                409
                            );
                        }
                    } else if(transaction.direction === TransactionDirection.OUTWARD) {
                        // OUTWARD: Primary pays (purchaseOutstanding), Third-party benefit (salesOutstanding)
                        if (
                            Number(transaction.amount) > outstanding.purchaseOutstanding
                        ) {
                            throw new ApiError(
                                `Outstanding changed. Available primary purchase outstanding: ${outstanding.purchaseOutstanding}. Allow negativeTransaction in settings`,
                                409
                            );
                        }
                        if (
                            Number(transaction.amount) > thirdPartyOutstanding.salesOutstanding
                        ) {
                            throw new ApiError(
                                `Outstanding changed. Available third-party sales outstanding: ${thirdPartyOutstanding.salesOutstanding}. Allow negativeTransaction in settings`,
                                409
                            );
                        }
                    }
                }
            }

            let remainingAmount = Number(transaction.amount);

            /**
             * Allocation logic depends on transaction type
             */
            if(transaction.paymentType === TransactionPaymentType.NORMAL) {
                // NORMAL: allocate to primary agency's sales (INWARD) or purchases (OUTWARD)
                if(transaction.direction === TransactionDirection.INWARD) {
                    // INWARD: allocate to primary's SALES
                    const sales = await tx.sale.findMany({
                        where: {
                            agencyId: transaction.agencyId,
                            branchId: transaction.branchId,
                            status: "APPROVED",
                        },
                        include: {
                            allocations: true
                        },
                        orderBy: {
                            createdAt: "asc"
                        }
                    });

                    for(const sale of sales){
                        if(remainingAmount <= 0) break;

                        const allocated = sale.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                        const outstanding = Number(sale.grandTotal) - allocated;
                        if(outstanding <= 0) continue;

                        const allocationAmount = Math.min(outstanding, remainingAmount);

                        await tx.transactionAllocation.create({
                            data: {
                                transactionId: transaction.id,
                                saleId: sale.id,
                                allocatedAmount: allocationAmount,
                                sourceType: "SALE"
                            }
                        });

                        remainingAmount -= allocationAmount;
                    }
                } else {
                    // OUTWARD: allocate to primary's PURCHASES
                    const purchases = await tx.purchase.findMany({
                        where: {
                            agencyId: transaction.agencyId,
                            branchId: transaction.branchId,
                            status: "APPROVED",
                        },
                        include: {
                            allocations: true
                        },
                        orderBy: {
                            createdAt: "asc"
                        }
                    });

                    for(const purchase of purchases){
                        if(remainingAmount <= 0) break;

                        const allocated = purchase.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                        const outstanding = Number(purchase.grandTotal) - allocated;
                        if(outstanding <= 0) continue;

                        const allocationAmount = Math.min(outstanding, remainingAmount);

                        await tx.transactionAllocation.create({
                            data: {
                                transactionId: transaction.id,
                                purchaseId: purchase.id,
                                allocatedAmount: allocationAmount,
                                sourceType: "PURCHASE"
                            }
                        });

                        remainingAmount -= allocationAmount;
                    }
                }
            } else if(transaction.paymentType === TransactionPaymentType.THIRD_PARTY && transaction.thirdPartyAgencyId) {
                // THIRD_PARTY: primary and third-party allocate differently based on direction
                if(transaction.direction === TransactionDirection.OUTWARD) {
                    // OUTWARD: Primary pays vendors (PURCHASES), Third-party benefits sales (SALES)
                    let primaryRemainingAmount = remainingAmount;
                    let thirdPartyRemainingAmount = remainingAmount;

                    // Allocate PRIMARY to PURCHASES (they pay vendors)
                    const primaryPurchases = await tx.purchase.findMany({
                        where: {
                            agencyId: transaction.agencyId,
                            branchId: transaction.branchId,
                            status: "APPROVED",
                        },
                        include: {
                            allocations: true
                        },
                        orderBy: {
                            createdAt: "asc"
                        }
                    });

                    for(const purchase of primaryPurchases){
                        if(primaryRemainingAmount <= 0) break;

                        const allocated = purchase.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                        const outstanding = Number(purchase.grandTotal) - allocated;
                        if(outstanding <= 0) continue;

                        const allocationAmount = Math.min(outstanding, primaryRemainingAmount);

                        await tx.transactionAllocation.create({
                            data: {
                                transactionId: transaction.id,
                                purchaseId: purchase.id,
                                allocatedAmount: allocationAmount,
                                sourceType: "PURCHASE"
                            }
                        });

                        primaryRemainingAmount -= allocationAmount;
                    }

                    // Allocate THIRD-PARTY to SALES (payment benefits their sales)
                    const thirdPartySales = await tx.sale.findMany({
                        where: {
                            agencyId: transaction.thirdPartyAgencyId,
                            branchId: transaction.branchId,
                            status: "APPROVED",
                        },
                        include: {
                            allocations: true
                        },
                        orderBy: {
                            createdAt: "asc"
                        }
                    });

                    for(const sale of thirdPartySales){
                        if(thirdPartyRemainingAmount <= 0) break;

                        const allocated = sale.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                        const outstanding = Number(sale.grandTotal) - allocated;
                        if(outstanding <= 0) continue;

                        const allocationAmount = Math.min(outstanding, thirdPartyRemainingAmount);

                        await tx.transactionAllocation.create({
                            data: {
                                transactionId: transaction.id,
                                saleId: sale.id,
                                allocatedAmount: allocationAmount,
                                sourceType: "SALE"
                            }
                        });

                        thirdPartyRemainingAmount -= allocationAmount;
                    }
                } else {
                    // INWARD: Primary receives customer payments (SALES), Third-party pays vendors (PURCHASES)
                    let primaryRemainingAmount = remainingAmount;
                    let thirdPartyRemainingAmount = remainingAmount;

                    // Allocate PRIMARY to SALES (they receive payment)
                    const primarySales = await tx.sale.findMany({
                        where: {
                            agencyId: transaction.agencyId,
                            branchId: transaction.branchId,
                            status: "APPROVED",
                        },
                        include: {
                            allocations: true
                        },
                        orderBy: {
                            createdAt: "asc"
                        }
                    });

                    for(const sale of primarySales){
                        if(primaryRemainingAmount <= 0) break;

                        const allocated = sale.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                        const outstanding = Number(sale.grandTotal) - allocated;
                        if(outstanding <= 0) continue;

                        const allocationAmount = Math.min(outstanding, primaryRemainingAmount);

                        await tx.transactionAllocation.create({
                            data: {
                                transactionId: transaction.id,
                                saleId: sale.id,
                                allocatedAmount: allocationAmount,
                                sourceType: "SALE"
                            }
                        });

                        primaryRemainingAmount -= allocationAmount;
                    }

                    // Allocate THIRD-PARTY to PURCHASES (payment reduces what they owe vendors)
                    const thirdPartyPurchases = await tx.purchase.findMany({
                        where: {
                            agencyId: transaction.thirdPartyAgencyId,
                            branchId: transaction.branchId,
                            status: "APPROVED",
                        },
                        include: {
                            allocations: true
                        },
                        orderBy: {
                            createdAt: "asc"
                        }
                    });

                    for(const purchase of thirdPartyPurchases){
                        if(thirdPartyRemainingAmount <= 0) break;

                        const allocated = purchase.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                        const outstanding = Number(purchase.grandTotal) - allocated;
                        if(outstanding <= 0) continue;

                        const allocationAmount = Math.min(outstanding, thirdPartyRemainingAmount);

                        await tx.transactionAllocation.create({
                            data: {
                                transactionId: transaction.id,
                                purchaseId: purchase.id,
                                allocatedAmount: allocationAmount,
                                sourceType: "PURCHASE"
                            }
                        });

                        thirdPartyRemainingAmount -= allocationAmount;
                    }
                }
            }

            return tx.transaction.findUnique({
                where: { id: transactionId },
                include: {
                    allocations: true,
                    branch: true,
                    agency: true,
                    thirdPartyAgency: true,
                    createdBy: true,
                }
            });
        });
    }


    static async rejectTransaction(
        actor: any,
        transactionId: string,
        remarks?: string
    ) {
        if(!actor?.id){
            throw new ApiError("Unauthorized", 401);
        }

        if(!transactionId){
            throw new ApiError("Transaction ID is required", 400);
        }

        const canReject = await RBACService.hasPermission(
            actor.id,
            "TRANSACTION:APPROVE"
        );

        if(!canReject){
            throw new ApiError("Forbidden: insufficient permissions to reject transaction", 403);
        }

        return prisma.$transaction(async (tx) => {

            const transaction = await tx.transaction.findUnique({
                where: { id: transactionId },
            });

            if (!transaction) {
                throw new ApiError("Transaction not found", 404);
            }

            if(
                transaction.status !== TransactionStatus.PENDING
            ) {
                throw new ApiError("Only pending transactions can be rejected", 400);
            }

            /** Optimistic locking */
            const lock = await tx.transaction.updateMany({
                where: {
                    id: transactionId,
                    status: TransactionStatus.PENDING
                },
                data: {
                    status: TransactionStatus.REJECTED,
                    createdById: actor.id,
                    updatedAt: new Date(),
                    remarks: remarks?.trim() ? remarks.trim() : transaction.remarks
                }
            });

            if (lock.count === 0) {
                throw new ApiError("Transaction already processed by another user. Please refresh", 409);
            }

            return tx.transaction.findUnique({
                where: { id: transactionId },
                include: {
                    allocations: true,
                    branch: true,
                    agency: true,
                    thirdPartyAgency: true,
                    createdBy: true,
                }
            });
        });
    }


    static async updateTransaction(
        actor: any,
        transactionId: string,
        payload: Partial<TransactionPayload>
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (!transactionId) {
            throw new ApiError("Transaction ID is required", 400);
        }

        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
        });

        if (!transaction) {
            throw new ApiError("Transaction not found", 404);
        }

        // Branch access check first
        if (
            actor.branchAccessType !== "ALL" &&
            transaction.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "You don't have access to this transaction",
                403
            );
        }

        if (transaction.status !== TransactionStatus.PENDING) {
            throw new ApiError(
                "Only pending transactions can be updated",
                400
            );
        }

        // Final values after update
        const finalBranchId =
            payload.branchId ?? transaction.branchId;

        const finalDirection =
            payload.direction ?? transaction.direction;

        const finalSuspense =
            payload.suspense ?? transaction.suspenseAccount;

        const finalAgencyId =
            payload.agencyId ?? transaction.agencyId;

        const finalPaymentType =
            payload.paymentType ?? transaction.paymentType;

        const finalThirdPartyAgencyId =
            payload.thirdPartyAgencyId ??
            transaction.thirdPartyAgencyId;

        const finalAmount =
            payload.amount ?? Number(transaction.amount);

        let finalPaymentMode =
            payload.paymentMode ?? transaction.paymentMode;

        let finalPaymentThrough =
            payload.paymentThrough ?? transaction.paymentThrough;

        const finalTransactionRefNo =
            payload.transactionRefNo ??
            transaction.transactionRefNo;

        const finalReferenceNo =
            payload.referenceNo ??
            transaction.referenceNo;

        // Branch restricted users cannot move transactions to another branch
        if (
            actor.branchAccessType !== "ALL" &&
            finalBranchId !== actor.branchId
        ) {
            throw new ApiError(
                "Cannot move transaction to another branch",
                403
            );
        }

        if (finalAmount <= 0) {
            throw new ApiError(
                "Amount must be greater than zero",
                400
            );
        }

        if (!finalSuspense && !finalAgencyId) {
            throw new ApiError(
                "Agency ID is required for non-suspense transactions",
                400
            );
        }

        if (
            finalPaymentType ===
                TransactionPaymentType.THIRD_PARTY &&
            !finalThirdPartyAgencyId
        ) {
            throw new ApiError(
                "Third party agency ID is required",
                400
            );
        }

        if(
            finalPaymentType === TransactionPaymentType.THIRD_PARTY
        ) {
            finalPaymentMode = PaymentMode.OFFLINE;
            finalPaymentThrough = PaymentType.CASH;
        }

        this.validatePaymentDetails(
            finalPaymentMode,
            finalPaymentThrough,
            finalTransactionRefNo,
            finalReferenceNo
        );

        // Outstanding validation
        if (!finalSuspense && finalAgencyId) {
            const outstanding =
                await this.getAgencyOutstanding(
                    actor,
                    finalAgencyId,
                    finalBranchId,
                    transactionId,
                );

            const settings = await this.getSettings();

            if(!settings.allowNegativeTransaction) {
                if(finalPaymentType === TransactionPaymentType.NORMAL) {
                    // For NORMAL transactions, check against standard outstanding
                    const effectiveOutstanding =
                        finalDirection === TransactionDirection.INWARD
                            ? outstanding.salesOutstanding
                            : outstanding.purchaseOutstanding;

                    if (finalAmount > effectiveOutstanding) {
                        throw new ApiError(
                            `Amount exceeds available outstanding. Allow negativeTransaction in settings`,
                            400
                        );
                    }
                } else if(finalPaymentType === TransactionPaymentType.THIRD_PARTY && finalThirdPartyAgencyId) {
                    // For THIRD_PARTY, check both agencies
                    const thirdPartyOutstanding = await this.getAgencyOutstanding(
                        actor,
                        finalThirdPartyAgencyId,
                        finalBranchId,
                        transactionId,
                    );

                    if(finalDirection === TransactionDirection.INWARD) {
                        // INWARD: Primary receives (salesOutstanding), Third-party pays (purchaseOutstanding)
                        if (finalAmount > outstanding.salesOutstanding) {
                            throw new ApiError(
                                `Amount exceeds primary agency sales outstanding. Allow negativeTransaction in settings`,
                                400
                            );
                        }
                        if (finalAmount > thirdPartyOutstanding.purchaseOutstanding) {
                            throw new ApiError(
                                `Amount exceeds third-party agency purchase outstanding. Allow negativeTransaction in settings`,
                                400
                            );
                        }
                    } else if(finalDirection === TransactionDirection.OUTWARD) {
                        // OUTWARD: Primary pays (purchaseOutstanding), Third-party benefit (salesOutstanding)
                        if (finalAmount > outstanding.purchaseOutstanding) {
                            throw new ApiError(
                                `Amount exceeds primary agency purchase outstanding. Allow negativeTransaction in settings`,
                                400
                            );
                        }
                        if (finalAmount > thirdPartyOutstanding.salesOutstanding) {
                            throw new ApiError(
                                `Amount exceeds third-party agency sales outstanding. Allow negativeTransaction in settings`,
                                400
                            );
                        }
                    }
                }
            }

        }

        // Optimistic locking
        const updated = await prisma.transaction.updateMany({
            where: {
                id: transactionId,
                status: TransactionStatus.PENDING,
            },
            data: {
                branchId: finalBranchId,
                direction: finalDirection,
                suspenseAccount: finalSuspense,
                agencyId: finalAgencyId,
                paymentType: finalPaymentType,
                thirdPartyAgencyId:
                    finalThirdPartyAgencyId,
                amount: finalAmount,
                paymentMode: finalPaymentMode,
                paymentThrough: finalPaymentThrough,
                transactionRefNo:
                    finalPaymentThrough === PaymentType.NEFT ||
                    finalPaymentThrough === PaymentType.RTGS ||
                    finalPaymentThrough === PaymentType.UPI ||
                    finalPaymentThrough === PaymentType.BANK_DEPOSIT
                    ? finalTransactionRefNo
                    : null,
                referenceNo: 
                    finalPaymentThrough === PaymentType.CHEQUE ||
                    finalPaymentThrough === PaymentType.DD
                    ? finalReferenceNo
                    : null,
                remarks:
                    payload.remarks ??
                    transaction.remarks,
            },
        });

        if (updated.count === 0) {
            throw new ApiError(
                "Transaction was modified by another user",
                409
            );
        }

        return prisma.transaction.findUnique({
            where: { id: transactionId },
            include: {
                branch: true,
                agency: true,
                thirdPartyAgency: true,
                createdBy: true,
            },
        });
    }

}
