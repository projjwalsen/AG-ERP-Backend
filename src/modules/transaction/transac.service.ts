import { TransactionDirection, TransactionStatus, PaymentType, OutstandingType, SettlementType, Prisma, SalesStatus, PurchaseStatus, Transaction } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";
import { randomUUID } from "crypto";
import { RBACService } from "../rbac/rbac.service";
import { LedgerService } from "../accounting/ledger/ledger.service";

type TransactionPayload = {
    branchId: string;
    bankAccountId?: string;
    direction: TransactionDirection;
    settlementType: SettlementType;
    suspense: boolean;
    agencyId?: string;
    thirdPartyAgencyId?: string;
    saleId?: string;
    purchaseId?: string;
    amount: number;
    paymentThrough?: PaymentType;
    transactionRefNo?: string;
    referenceNo?: string;
    remarks?: string;
}

type FIFOAllocation = {
    invoiceId: string;
    invoiceNo: string;
    sourceType: "SALE" | "PURCHASE";

    total: number;

    outstanding: number;

    allocatedAmount: number;

    remainingOutstanding: number;

    fullySettled: boolean;

    partiallySettled: boolean;
}

type InvoicePreview = {
    invoiceId: string;
    invoiceNo: string;

    invoiceType: "SALE" | "PURCHASE";

    invoiceDate: Date;

    fifoOrder: number;

    totalAmount: number;

    outstandingAmount: number;

    payingAmount: number;

    remainingOutstanding: number;

    settlementStatus:
        | "FULLY_SETTLED"
        | "PARTIALLY_SETTLED";

    invoice: any;
};

type AgencyFIFOPreview = {
    agency: {
        id: string;
        name: string;
    };

    requestedAmount: number;

    allocatedAmount: number;

    unallocatedAmount: number;

    canProceed: boolean;

    invoices: InvoicePreview[];
};

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

    private static async getInvoiceOutstanding(
        tx: Prisma.TransactionClient,
        payload: Pick<
            TransactionPayload,
            "direction" | "saleId" | "purchaseId"
        >
    ) {
        if(payload.direction === TransactionDirection.INWARD) {
            const sale = await tx.sale.findUnique({
                where: {
                    id: payload.saleId
                },
                include: {
                    allocations: true
                }
            });

            if(!sale) {
                throw new ApiError("Invalid Sale ID", 400);
            }

            const allocated = sale.allocations.reduce(
                (sum, a) => 
                    sum + Number(a.allocatedAmount),
                0
            );

            return {
                type: "SALE",
                id: sale.id,
                agencyId: sale.agencyId,
                branchId: sale.branchId,
                status: sale.status,
                grandTotal: Number(sale.grandTotal),
                allocated,
                outstandings: Number(sale.grandTotal) - allocated
            }
        }

        const purchase = await tx.purchase.findUnique({
            where: {
                id: payload.purchaseId
            },
            include: {
                allocations: true
            }
        });

        if(!purchase) {
            throw new ApiError("Purchase Invoice not found", 400);
        }

        const allocated = purchase.allocations.reduce(
            (sum, a) => sum + Number(a.allocatedAmount),
            0
        );

        return {
            type: "PURCHASE",
            id: purchase.id,
            agencyId: purchase.agencyId,
            branchId: purchase.branchId,
            status: purchase.status,
            grandTotal: Number(purchase.grandTotal),
            allocated,
            outstandings: Number(purchase.grandTotal) - allocated
        };
    }

    private static async validateInvoiceSettlement(
        tx: Prisma.TransactionClient,
        payload: TransactionPayload
    ) {
        if(payload.thirdPartyAgencyId) {
            throw new ApiError("Third Party not allowed -- Invoice to Invoice Settlement", 400);
        }

        if(
            !payload.saleId &&
            !payload.purchaseId
        ) {
            throw new ApiError("Either SaleId or PurchaseId is required for Invoice Settlement", 400);
        }

        if(payload.saleId && payload.purchaseId) {
            throw new ApiError("Only one of SaleId or PurchaseId is allowed for Invoice Settlement", 400);
        }

        if(payload.direction ===
            TransactionDirection.INWARD &&
            !payload.saleId
        ) {
            throw new ApiError(
                "Sale Invoice is required !", 
                400
            );
        }

        if(payload.direction ===
            TransactionDirection.OUTWARD &&
            !payload.purchaseId
        ) {
            throw new ApiError(
                "Purchase Invoice is required !",
                400
            );
        }

        const invoice = await this.getInvoiceOutstanding(
            tx,
            payload
        );

        if(
            invoice.branchId !==
            payload.branchId
        ) {
            throw new ApiError(
                "Invoice belong to another branch",
                400
            )
        }

        if (
            invoice.agencyId !==
            payload.agencyId
        ) {
            throw new ApiError(
                "Invoice belong to another agency",
                400
            );
        }

        if(
            invoice.outstandings <= 0
        ) {
            throw new ApiError(
                "Invoice is already fully settled",
                400
            )
        }

        if (
            invoice.outstandings !==
            payload.amount
        ) {
            throw new ApiError(
                `Outstanding amount is ${invoice.outstandings}. Invoice settlement must be full.`,
                400
            )
        }

        if(
            payload.direction ===
            TransactionDirection.INWARD &&
            invoice.status !== SalesStatus.APPROVED
        ) {
            throw new ApiError(
                "Sale Invoice is not approved yet",
                400
            )
        }

        if (
            payload.direction ===
            TransactionDirection.OUTWARD &&
            invoice.status !== PurchaseStatus.APPROVED
        ) {
            throw new ApiError(
                "Purchase Invoice is not approved yet",
                400
            );
        }
    }

    private static async validateLumpsumSettlement(
        tx: Prisma.TransactionClient,
        actor: any,
        payload: TransactionPayload
    ) {
        if(!payload.agencyId) {
            throw new ApiError(
                "Primary Agency is required",
                400
            );
        }

        if(!payload.thirdPartyAgencyId) {
            throw new ApiError(
                "Third Party Agency is required",
                400
            );
        }

        if(
            payload.saleId ||
            payload.purchaseId
        ) {
            throw new ApiError(
                "Invoice selection is not allowed in Lumpsum Settlement",
                400
            );
        }

        if(
            payload.agencyId ===
            payload.thirdPartyAgencyId
        ) {
            throw new ApiError(
                "Primary and Third Party Agencies cannot be the same",
                400
            );
        }

        if (
            payload.amount <= 0
        ) {
            throw new ApiError(
                "Amount should be greater than zero",
                400
            );
        }

        const settings = await this.getSettings();

        if(settings.allowNegativeTransaction) {
            return;
        }

        const primaryOutstanding = await this.getAgencyOutstanding(
            actor,
            payload.agencyId,
            payload.branchId,
            tx
        );

        const thirdPartyOutstanding = await this.getAgencyOutstanding(
            actor,
            payload.thirdPartyAgencyId,
            payload.branchId,
            tx
        );

        if(payload.direction ===
            TransactionDirection.INWARD
        ) {
            /**
             * Inward clears what they owe us (amountDue)
             */
            if(
                payload.amount >
                primaryOutstanding.amountDue
            ) {
                throw new ApiError(
                    `Primary agency outstanding is only ${primaryOutstanding.amountDue}`,
                    400
                )
            }

            /**
             * Third Party
             */
            if(
                payload.amount >
                thirdPartyOutstanding.amountReceivable
            ) {
                throw new ApiError(
                    `Third Party agency outstanding is only ${thirdPartyOutstanding.amountReceivable}`,
                    400
                )
            }
        } else {
            /**
             * Primary Vendor
             */

            if (
                payload.amount >
                primaryOutstanding.amountReceivable
            ) {

                throw new ApiError(
                    `Primary Agency outstanding is only ${primaryOutstanding.amountReceivable}`,
                    400
                );

            }

            /**
             * Third Party Customer
             */

            if (
                payload.amount >
                thirdPartyOutstanding.amountDue
            ) {

                throw new ApiError(
                    `Third Party outstanding is only ${thirdPartyOutstanding.amountDue}`,
                    400
                );

            }
        }
    }

    private static async allocateInvoice(
        tx: Prisma.TransactionClient,
        transaction: Transaction
    ) {
        const invoice = await this.getInvoiceOutstanding(
            tx,
            {
                direction: transaction.direction,
                saleId: transaction.saleId,
                purchaseId: transaction.purchaseId
            }
        );

        if (invoice.outstandings !== Number(transaction.amount)) {
            throw new ApiError(
                "Invoice outstanding has changed. Please refresh.",
                409
            );
        }

        await tx.transactionAllocation.create({
            data: {
                transactionId: transaction.id,
                sourceType:
                    transaction.direction ===
                    TransactionDirection.INWARD
                    ? "SALE"
                    : "PURCHASE",

                saleId:
                    transaction.direction ===
                    TransactionDirection.INWARD
                    ? transaction.saleId
                    : undefined,

                purchaseId:
                    transaction.direction ===
                    TransactionDirection.OUTWARD
                    ? transaction.purchaseId
                    : undefined,

                allocatedAmount: transaction.amount
            }
        })
    }

    private static async settleInvToInvPayment(
        tx: Prisma.TransactionClient,
        transaction: Transaction
    ) {
        const amount = Number(transaction.amount);

        await this.updatePersistentOutstanding(
            tx,
            transaction.agencyId!,
            transaction.branchId,
            amount,
            transaction.direction === TransactionDirection.INWARD
                ? OutstandingType.CREDIT
                : OutstandingType.DEBIT,
            "ADD"
        );

        await this.allocateInvoice(
            tx,
            transaction
        )


    }


    private static async allocateFIFO(
        tx: Prisma.TransactionClient,
        params: {
            transactionId: string;
            agencyId: string;
            branchId: string;
            direction: TransactionDirection;
            amount: number;
        }
    ) {

        let remaining = params.amount;

        if (params.direction === TransactionDirection.INWARD) {

            const sales = await tx.sale.findMany({
                where: {
                    agencyId: params.agencyId,
                    branchId: params.branchId,
                    status: SalesStatus.APPROVED
                },
                include: {
                    allocations: true
                },
                orderBy: {
                    createdAt: "asc"
                }
            });

            for (const sale of sales) {

                if (remaining <= 0)
                    break;

                const allocated =
                    sale.allocations.reduce(
                        (sum, a) =>
                            sum + Number(a.allocatedAmount),
                        0
                    );

                const outstanding =
                    Number(sale.grandTotal) -
                    allocated;

                if (outstanding <= 0)
                    continue;

                const allocation =
                    Math.min(
                        outstanding,
                        remaining
                    );

                await tx.transactionAllocation.create({
                    data: {
                        transactionId: params.transactionId,
                        saleId: sale.id,
                        sourceType: "SALE",
                        allocatedAmount: allocation
                    }
                });

                remaining -= allocation;
            }

        } else {

            const purchases = await tx.purchase.findMany({
                where: {
                    agencyId: params.agencyId,
                    branchId: params.branchId,
                    status: PurchaseStatus.APPROVED
                },
                include: {
                    allocations: true
                },
                orderBy: {
                    createdAt: "asc"
                }
            });

            for (const purchase of purchases) {

                if (remaining <= 0)
                    break;

                const allocated =
                    purchase.allocations.reduce(
                        (sum, a) =>
                            sum + Number(a.allocatedAmount),
                        0
                    );

                const outstanding =
                    Number(purchase.grandTotal) -
                    allocated;

                if (outstanding <= 0)
                    continue;

                const allocation =
                    Math.min(
                        outstanding,
                        remaining
                    );

                await tx.transactionAllocation.create({
                    data: {
                        transactionId: params.transactionId,
                        purchaseId: purchase.id,
                        sourceType: "PURCHASE",
                        allocatedAmount: allocation
                    }
                });

                remaining -= allocation;
            }
        }

        if (remaining > 0) {
            throw new ApiError(
                "Outstanding changed while allocating invoices.",
                409
            );
        }
    }

    private static async settleLumpsumPayment(
        tx: Prisma.TransactionClient,
        transaction: Transaction
    ) {
        const amount = Number(transaction.amount);

        if(!transaction.thirdPartyAgencyId) {
            throw new ApiError(
                "Third Party Agency is required for Lumpsum Settlement",
                400
            );
        }

        if(transaction.direction === TransactionDirection.INWARD) {
            /**
             * Primary Customer
             */
            await this.updatePersistentOutstanding(
                tx,
                transaction.agencyId!,
                transaction.branchId,
                amount,
                OutstandingType.CREDIT,
                "ADD"
            );

            /**
             * Third Party Vendor
             */
            await this.updatePersistentOutstanding(
                tx,
                transaction.thirdPartyAgencyId,
                transaction.branchId,
                amount,
                OutstandingType.DEBIT,
                "ADD"
            );

            /**
             * allocate FIFO for primary agency sales invoices
             */
            await this.allocateFIFO(
                tx,
                {
                    transactionId: transaction.id,
                    agencyId: transaction.agencyId!,
                    branchId: transaction.branchId,
                    direction: TransactionDirection.INWARD,
                    amount
                }
            );

            /**
             * allocate FIFO for third party agency purchase invoices
             */
            await this.allocateFIFO(
                tx,
                {
                    transactionId: transaction.id,
                    agencyId: transaction.thirdPartyAgencyId,
                    branchId: transaction.branchId,
                    direction: TransactionDirection.OUTWARD,
                    amount
                }
            );
        } else {
            /**
             * Primary Vendor
             */
            await this.updatePersistentOutstanding(
                tx,
                transaction.agencyId!,
                transaction.branchId,
                amount,
                OutstandingType.DEBIT,
                "ADD"
            );

            /**
             * Third Party Customer
             */
            await this.updatePersistentOutstanding(
                tx,
                transaction.thirdPartyAgencyId,
                transaction.branchId,
                amount,
                OutstandingType.CREDIT,
                "ADD"
            );

            /**
             * Allocate Vendor Purchase
             */
            await this.allocateFIFO(
                tx,
                {
                    transactionId: transaction.id,
                    agencyId: transaction.agencyId!,
                    branchId: transaction.branchId,
                    direction: TransactionDirection.OUTWARD,
                    amount
                }
            );

            /**
             * Allocate Customer Sales
             */
            await this.allocateFIFO(
                tx,
                {
                    transactionId: transaction.id,
                    agencyId: transaction.thirdPartyAgencyId,
                    branchId: transaction.branchId,
                    direction: TransactionDirection.INWARD,
                    amount
                }
            );
        }
    };

    private static async calculateFIFOAllocation(
        tx: Prisma.TransactionClient,
        params: {
            primaryAgencyId: string;
            thirdPartyAgencyId: string;
            branchId: string;
            direction: TransactionDirection;
            amount: number;
        }
    ) {

        const buildInvoices = async (
            agencyId: string,
            direction: TransactionDirection
        ): Promise<AgencyFIFOPreview> => {

            let remaining = params.amount;

            const invoices: InvoicePreview[] = [];

            const agency = await tx.agency.findUnique({
                where: {
                    id: agencyId
                },
                select: {
                    id: true,
                    name: true,
                }
            });

            if (!agency) {
                throw new ApiError(
                    "Agency not found",
                    404
                );
            }

            if (direction === TransactionDirection.INWARD) {

                const sales = await tx.sale.findMany({
                    where: {
                        agencyId,
                        branchId: params.branchId,
                        status: SalesStatus.APPROVED
                    },
                    include: {
                        allocations: true,
                        items: {
                            include: {
                                product: true,
                                batch: true
                            }
                        }
                    },
                    orderBy: [
                        {
                            createdAt: "asc"
                        }
                    ]
                });

                let fifo = 1;

                for (const sale of sales) {

                    if (remaining <= 0)
                        break;

                    const alreadyAllocated =
                        sale.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                    const outstanding =
                        Number(sale.grandTotal) -
                        alreadyAllocated;

                    if (outstanding <= 0)
                        continue;

                    const paying =
                        Math.min(outstanding, remaining);

                    invoices.push({

                        invoiceId: sale.id,

                        invoiceNo: sale.invoiceNo,

                        invoiceType: "SALE",

                        invoiceDate: sale.invoiceDate,

                        fifoOrder: fifo++,

                        totalAmount: Number(sale.grandTotal),

                        outstandingAmount: outstanding,

                        payingAmount: paying,

                        remainingOutstanding:
                            outstanding - paying,

                        settlementStatus:
                            paying === outstanding
                                ? "FULLY_SETTLED"
                                : "PARTIALLY_SETTLED",

                        invoice: sale

                    });

                    remaining -= paying;
                }

            } else {

                const purchases = await tx.purchase.findMany({
                    where: {
                        agencyId,
                        branchId: params.branchId,
                        status: PurchaseStatus.APPROVED
                    },
                    include: {
                        allocations: true,
                        items: {
                            include: {
                                product: true,
                                batch: true
                            }
                        }
                    },
                    orderBy: [
                        {
                            createdAt: "asc"
                        }
                    ]
                });

                let fifo = 1;

                for (const purchase of purchases) {

                    if (remaining <= 0)
                        break;

                    const alreadyAllocated =
                        purchase.allocations.reduce(
                            (sum, a) => sum + Number(a.allocatedAmount),
                            0
                        );

                    const outstanding =
                        Number(purchase.grandTotal) -
                        alreadyAllocated;

                    if (outstanding <= 0)
                        continue;

                    const paying =
                        Math.min(outstanding, remaining);

                    invoices.push({

                        invoiceId: purchase.id,

                        invoiceNo: purchase.invoiceNo,

                        invoiceType: "PURCHASE",

                        invoiceDate: purchase.createdAt,

                        fifoOrder: fifo++,

                        totalAmount: Number(purchase.grandTotal),

                        outstandingAmount: outstanding,

                        payingAmount: paying,

                        remainingOutstanding:
                            outstanding - paying,

                        settlementStatus:
                            paying === outstanding
                                ? "FULLY_SETTLED"
                                : "PARTIALLY_SETTLED",

                        invoice: purchase

                    });

                    remaining -= paying;
                }

            }

            return {

                agency,

                requestedAmount:
                    params.amount,

                allocatedAmount:
                    params.amount -
                    remaining,

                unallocatedAmount:
                    remaining,

                canProceed:
                    remaining === 0,

                invoices

            };
        };

        let primaryAgency: AgencyFIFOPreview;
        let thirdPartyAgency: AgencyFIFOPreview;

        if (params.direction === TransactionDirection.INWARD) {
            primaryAgency = await buildInvoices(
                params.primaryAgencyId,
                TransactionDirection.INWARD
            );

            thirdPartyAgency = await buildInvoices(
                params.thirdPartyAgencyId,
                TransactionDirection.OUTWARD
            );

        } else {
            primaryAgency = await buildInvoices(
                params.primaryAgencyId,
                TransactionDirection.OUTWARD
            );

            thirdPartyAgency = await buildInvoices(
                params.thirdPartyAgencyId,
                TransactionDirection.INWARD
            );
        }

        const canProceed =
            primaryAgency.canProceed &&
            thirdPartyAgency.canProceed;

        return {

            settlementType: SettlementType.LUMPSUM,

            direction: params.direction,

            requestedAmount: params.amount,

            canProceed,

            reason:
                !primaryAgency.canProceed
                    ? `Primary agency has ₹${primaryAgency.unallocatedAmount} insufficient outstanding`
                    : !thirdPartyAgency.canProceed
                    ? `Third party agency has ₹${thirdPartyAgency.unallocatedAmount} insufficient outstanding`
                    : null,

            primaryAgency,

            thirdPartyAgency

        };
    }

    private static validatePaymentDetails(
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

        if (onlineTypes.includes(paymentThrough)) {

            if (!transactionRefNo?.trim()) {
                throw new ApiError(
                    `${paymentThrough} requires Transaction Reference Number`,
                    400
                );
            }

            if (referenceNo) {
                throw new ApiError(
                    `${paymentThrough} should not contain Reference Number`,
                    400
                );
            }
        }

        if (offlineRefTypes.includes(paymentThrough)) {

            if (!referenceNo?.trim()) {
                throw new ApiError(
                    `${paymentThrough} requires Reference Number`,
                    400
                );
            }

            if (transactionRefNo) {
                throw new ApiError(
                    `${paymentThrough} should not contain Transaction Reference Number`,
                    400
                );
            }
        }

        if (paymentThrough === PaymentType.CASH) {

            if (referenceNo || transactionRefNo) {

                throw new ApiError(
                    "Cash payment should not contain any reference",
                    400
                );
            }

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

        let bankAccount = null;

if (payload.paymentThrough === PaymentType.BANK_DEPOSIT) {

    if (!payload.bankAccountId) {

        throw new ApiError(
            "Bank Account is required",
            400
        );

    }

    bankAccount =
        await prisma.bankAccount.findFirst({

            where: {

                id: payload.bankAccountId,

                branchId: payload.branchId,

                isActive: true

            }

        });

    if (!bankAccount) {

        throw new ApiError(

            "Invalid Bank Account for selected branch",

            400

        );

    }

}

        if (actor.branchAccessType !== "ALL" && payload.branchId !== actor.branchId) {
            throw new ApiError("Cannot create transaction for another branch", 403);
        }

        if (!payload.suspense && !payload.agencyId) {
            throw new ApiError("Agency ID is required for non-suspense transactions", 400);
        }
        
        if (payload.amount <= 0) {
            throw new ApiError("Transaction amount must be greater than zero", 400);
        }

        if(!payload.paymentThrough) {
            throw new ApiError("Payment Through is required", 400);
        }

        const transactionNo = await this.generateTransactionNo(payload.branchId);

        /** Settlement Validation */
        if(!payload.suspense) {
            await prisma.$transaction(async (tx) => {
                switch (payload.settlementType) {
                    case SettlementType.INVOICE_TO_INVOICE:
                        await this.validateInvoiceSettlement(
                            tx,
                            payload
                        );
                        break;

                    case SettlementType.LUMPSUM:
                        await this.validateLumpsumSettlement(
                            tx,
                            actor,
                            payload
                        );
                        break;
                    default:
                        throw new ApiError("Invalid Settlement Type", 400);
                }
            })
        }

        /**
         * Payment Instrument Validation
        */
        this.validatePaymentDetails(
            payload.paymentThrough,
            payload.transactionRefNo,
            payload.referenceNo
        );

        /**
         * Create Pending Transaction
        */
        return prisma.transaction.create({
            data: {
                transactionNo,

                status: TransactionStatus.PENDING,

                settlementType: payload.settlementType,

                branchId: payload.branchId,

                bankAccountId: payload.bankAccountId,

                direction: payload.direction,

                suspenseAccount: payload.suspense,

                agencyId: payload.agencyId,

                thirdPartyAgencyId: payload.thirdPartyAgencyId,

                saleId: payload.saleId,

                purchaseId: payload.purchaseId,

                amount: payload.amount,

                paymentThrough: payload.paymentThrough,

                transactionRefNo: payload.transactionRefNo,

                referenceNo: payload.referenceNo,

                remarks: payload.remarks,

                createdById: actor.id
            }
        })
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

    /**
     * State synchronization processor engine
     * Updates agency position balancing dynamically while strictly protecting the single-row constraint
     */
    static async updatePersistentOutstanding(
        tx: any,
        agencyId: string,
        branchId: string,
        deltaAmount: number,
        type: OutstandingType, // The type of operation coming in (CREDIT or DEBIT)
        operation: 'ADD' | 'DECREMENT'
    ) {
        // FIXED: Look for ANY row matching the unique constraint, completely ignoring type for the lookup
        const existing = await tx.agencyOutstanding.findFirst({
            where: { agencyId, branchId }
        });

        // Determine value adjustment value direction multiplier
        let adjustment = operation === 'ADD' ? deltaAmount : -deltaAmount;

        if (existing) {
            let currentAmount = Number(existing.amount);
            let currentType = existing.type;

            // Compute net positional shift based on whether the incoming type matches the current row state
            if (currentType === type) {
                currentAmount += adjustment;
            } else {
                currentAmount -= adjustment;
            }

            // If a balance crosses below zero, flip the accounting classification type flag
            if (currentAmount < 0) {
                currentAmount = Math.abs(currentAmount);
                currentType = currentType === OutstandingType.DEBIT ? OutstandingType.CREDIT : OutstandingType.DEBIT;
            }

            await tx.agencyOutstanding.update({
                where: { id: existing.id },
                data: { 
                    amount: currentAmount,
                    type: currentType
                }
            });
        } else {
            // Safe baseline fallback if absolutely no record exists yet for this profile relationship combo
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
            settlementType?: SettlementType;
            search?: string;
            export?: boolean;
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

        if(query?.settlementType){
            where.settlementType = query.settlementType;
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
                ...(query?.export ? {} : { skip, take: limit })
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
                await LedgerService.postTransactionApproval(tx, transaction.id);

                return tx.transaction.findUnique({
                    where: { id: transactionId },
                });
            }

            /** Settlement Type */
            switch (transaction.settlementType) {
                case SettlementType.INVOICE_TO_INVOICE:
                    await this.settleInvToInvPayment(
                        tx, 
                        transaction
                    );
                    break;

                case SettlementType.LUMPSUM:
                    await this.settleLumpsumPayment(
                        tx,
                        transaction
                    );
                    break;

                default:
                    throw new ApiError(
                        "Invalid settlement type", 
                        400
                    );
            }

            await LedgerService.postTransactionApproval(tx, transaction.id);

            return tx.transaction.findUnique({
                where: { 
                    id: transactionId 
                },
                include: { 
                    allocations: true, 
                    branch: true, 
                    agency: true, 
                    thirdPartyAgency: true, 
                    createdBy: true 
                }
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

    static async updateTransaction(
        actor: any,
        transactionId: string,
        payload: Partial<TransactionPayload>
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(!transactionId) {
            throw new ApiError("Transaction ID is required", 400);
        }

        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId }
        });

        if(!transaction) {
            throw new ApiError("Transaction not found", 404);
        }

        if(transaction.status !== TransactionStatus.PENDING) {
            throw new ApiError("Only pending transactions can be updated", 400);
        }

        const finalPayload: TransactionPayload = {
            branchId:
                payload.branchId ?? transaction.branchId,

            bankAccountId:
                payload.bankAccountId ??
                transaction.bankAccountId,

            direction:
                payload.direction ?? transaction.direction,
            
            settlementType:
                payload.settlementType ?? transaction.settlementType,

            suspense:
                payload.suspense ?? transaction.suspenseAccount,

            agencyId:
                payload.agencyId ?? transaction.agencyId ?? undefined,

            thirdPartyAgencyId:
                payload.thirdPartyAgencyId ?? transaction.thirdPartyAgencyId ?? undefined,

            saleId:
                payload.saleId ?? transaction.saleId ?? undefined,

            purchaseId:
                payload.purchaseId ?? transaction.purchaseId ?? undefined,

            amount:
                payload.amount ?? Number(transaction.amount),

            paymentThrough:
                payload.paymentThrough ?? transaction.paymentThrough ?? undefined,

            transactionRefNo:
                payload.transactionRefNo ?? transaction.transactionRefNo ?? undefined,

            referenceNo:
                payload.referenceNo ?? transaction.referenceNo ?? undefined,

            remarks:
                payload.remarks ?? transaction.remarks ?? undefined
        };

        if(
            actor.branchAccessType !== "ALL" &&
            finalPayload.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "Cannot update transaction for another branch",
                403
            )
        }

        if(
            finalPayload.amount <= 0
        ) {
            throw new ApiError(
                "Transaction amount must be greater than zero",
                400
            )
        }

        if(
            !finalPayload.suspense &&
            !finalPayload.agencyId
        ) {
            throw new ApiError(
                "Agency ID is required",
                400
            )
        }

        if(!finalPayload.paymentThrough) {
            throw new ApiError(
                "Payment Through is required",
                400
            )
        }

        /**
         * Validate payment instrument
         */
        this.validatePaymentDetails(
            finalPayload.paymentThrough,
            finalPayload.transactionRefNo,
            finalPayload.referenceNo
        );

        /**
         * Settlement validation
         */
        if (!finalPayload.suspense) {

            await prisma.$transaction(async (tx) => {

                switch (finalPayload.settlementType) {

                    case SettlementType.INVOICE_TO_INVOICE:

                        await this.validateInvoiceSettlement(
                            tx,
                            finalPayload
                        );

                        break;

                    case SettlementType.LUMPSUM:

                        await this.validateLumpsumSettlement(
                            tx,
                            actor,
                            finalPayload
                        );

                        break;

                    default:

                        throw new ApiError(
                            "Invalid Settlement Type",
                            400
                        );

                }

            });

        }

        const updated = await prisma.transaction.updateMany({

            where: {
                id: transactionId,
                status: TransactionStatus.PENDING
            },

            data: {

                branchId:
                    finalPayload.branchId,

                bankAccountId:
                    finalPayload.bankAccountId,

                direction:
                    finalPayload.direction,

                settlementType:
                    finalPayload.settlementType,

                suspenseAccount:
                    finalPayload.suspense,

                agencyId:
                    finalPayload.agencyId,

                thirdPartyAgencyId:
                    finalPayload.thirdPartyAgencyId,

                saleId:
                    finalPayload.saleId,

                purchaseId:
                    finalPayload.purchaseId,

                amount:
                    finalPayload.amount,

                paymentThrough:
                    finalPayload.paymentThrough,

                transactionRefNo:
                    finalPayload.transactionRefNo,

                referenceNo:
                    finalPayload.referenceNo,

                remarks:
                    finalPayload.remarks
            }

        });

        if (updated.count === 0) {
            throw new ApiError(
                "Transaction already modified",
                409
            );
        }

        return prisma.transaction.findUnique({

            where: {
                id: transactionId
            },

            include: {

                branch: true,
                bankAccount: true,
                agency: true,

                thirdPartyAgency: true,

                createdBy: true

            }

        });

    }

    static async previewFIFOAllocation(
        actor: any,
        payload: {
            primaryAgencyId: string;
            thirdPartyAgencyId: string;
            branchId: string;
            direction: TransactionDirection;
            amount: number;
        }
    ) {

        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        return prisma.$transaction(async (tx) => {

            return this.calculateFIFOAllocation(
                tx,
                payload
            );

        });

    }

    static async getOutstandingInvoices(
        actor: any,
        query: {
            branchId?: string;
            agencyId?: string;
            direction: TransactionDirection;
            search?: string
        }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (!query.agencyId) {
            throw new ApiError("Agency ID is required", 400);
        }

        const branchId =
            actor.branchAccessType === "ALL"
                ? query.branchId
                : actor.branchId;

        if(!branchId) {
            throw new ApiError(
                "Branch ID is required",
                400
            );
        }

        if (query.direction === TransactionDirection.INWARD ) {
            const sales = await prisma.sale.findMany({
                where: {
                    agencyId: query.agencyId,
                    branchId: branchId,
                    status: SalesStatus.APPROVED,
                    ...(query.search ? {
                        invoiceNo: {
                            contains: query.search,
                            mode: "insensitive"
                        }
                    } : {})
                },
                include: {
                    allocations: true,
                },
                orderBy: {
                    createdAt: "desc"
                }
            });

            return sales.map((sale) => {
                const allocated = 
                    sale.allocations.reduce(
                        (sum, a) => sum + Number(a.allocatedAmount),
                        0
                    );

                const outstanding =
                    Number(sale.grandTotal) - allocated;

                return {
                    ...sale,
                    allocatedAmount: allocated,
                    outstandingAmount: outstanding,
                    fullySettled: outstanding === 0,
                    partiallySettled: 
                        outstanding > 0 && 
                        allocated > 0,
                };
            })
            .filter(sale => sale.outstandingAmount > 0);
        }

        const purchases = await prisma.purchase.findMany({
            where: {
                agencyId: query.agencyId,

                branchId: branchId,

                status: PurchaseStatus.APPROVED,

                ...(query.search ? {
                    invoiceNo: {
                        contains: query.search,
                        mode: "insensitive"
                    }
                } : {})
            },
            include: {
                allocations: true,
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        return purchases.map((purchase) => {
            const allocated = 
                purchase.allocations.reduce(
                    (sum, a) => sum + Number(a.allocatedAmount),
                    0
                );


            const outstanding =
                Number(purchase.grandTotal) - allocated;

            return {

                ...purchase,
                allocatedAmount: allocated,
                outstandingAmount: outstanding,
                fullySettled: outstanding === 0,
                partiallySettled:
                    outstanding > 0 &&
                    allocated > 0

            };
        })
        .filter(purchase => purchase.outstandingAmount > 0);
    }
}
