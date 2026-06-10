import { prisma } from "../../../config/db";
import { ApiError } from "../../../core/middleware/errorHandler";
import { LedgerType, Prisma, EntryType } from "@prisma/client";

export class LedgerService {

    /** Validate Ledger */
    static async validateLedger(ledgerId: string) {
        if (!ledgerId) {
            throw new ApiError("Ledger ID is required", 400);
        }

        // Check if ledger exists
        const ledger = await prisma.ledger.findUnique({
            where: { id: ledgerId },
        });

        if (!ledger) {
            throw new ApiError("Ledger not found", 404);
        }

        if(!ledger.isActive) {
            throw new ApiError("Ledger is inactive", 400);
        }

        return ledger;
    }

    /** get ledger by ID */
    static async getLedgerById(
        ledgerId: string
    ) {
        const ledger = await prisma.ledger.findUnique({
            where: { id: ledgerId },
            include: {
                branch: true,
                agency: true,
            }
        });

        if (!ledger) {
            throw new ApiError("Ledger not found", 404);
        }

        return ledger;
    }

    static async getLedgerByCode(
        code: string
    ) {
        const ledger = await prisma.ledger.findUnique({
            where: { code },
            include: {
                branch: true,
                agency: true,
            }
        });

        if (!ledger) {
            throw new ApiError("Ledger not found", 404);
        }

        return ledger;
    }

    static async getLedgerByAgency(
        agencyId: string
    ) {
        const ledgers = await prisma.ledger.findMany({
            where: { agencyId },
            include: {
                branch: true,
                agency: true,
            }
        });

        if (!ledgers || ledgers.length === 0) {
            throw new ApiError("No ledgers found for this agency", 404);
        }

        return ledgers;
    }

    static async getLedgers(
        query?: {
            page?: number;
            limit?: number;

            ledgerId?: string;
            agencyId?: string;
            code?: string;

            branchId?: string;
            category?: LedgerType;

            search?: string;
        }
    ) {
        if(query?.ledgerId){
            return this.getLedgerById(query.ledgerId);
        }

        if(query?.agencyId){
            return this.getLedgerByAgency(query.agencyId);
        }

        if(query?.code){
            return this.getLedgerByCode(query.code);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 10;
        const skip = (page - 1) * limit;

        const where: Prisma.LedgerWhereInput = {
            ...(query?.branchId && { branchId: query.branchId }),
            ...(query?.category && { category: query.category }),
            ...(query?.search && {
                OR: [
                    { name: { contains: query.search, mode: "insensitive" } },
                    { code: { contains: query.search, mode: "insensitive" } },
                ]
            })
        };

        const [ledgers, total] = await Promise.all([
            prisma.ledger.findMany({
                where,
                include: {
                    branch: true,
                    agency: true,
                },
                orderBy: {
                    createdAt: "desc"
                },
                skip,
                take: limit,
            }),

            prisma.ledger.count({ where })
        ]);

        return {
            data: ledgers,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            }
        }
    }


    /** ==========  CREATE LEDGER ============== */
    static async createLedger(
        payload: {
            name: string;
            code: string;
            category: LedgerType;
            branchId?: string;
            agencyId?: string;
            openingBalance?: number;
        }
    ){
        if(!payload.name || !payload.code || !payload.category) {
            throw new ApiError("Invalid ledger data: name, code, category are required", 400);
        }

        const existingLedger = await prisma.ledger.findFirst({
            where: {
                OR: [
                    { code: payload.code },
                    ...(payload.agencyId ? [{ agencyId: payload.agencyId }] : []),
                ]
            }
        });

        if(existingLedger) {
            throw new ApiError("Ledger with same code or agency already exists", 400);
        }

        return prisma.ledger.create({
            data: {
                code: payload.code,
                name: payload.name,
                category: payload.category,
                branchId: payload.branchId,
                agencyId: payload.agencyId,
                openingBalance: payload.openingBalance || 0,
                currentBalance: payload.openingBalance || 0,
            }
        });
    }

    /** ============= Update Ledger =================== */
    static async updateLedger(
        ledgerId: string,
        payload: {
            name?: string;
            code?: string;
            isActive?: boolean;
        }
    ) {
        await this.validateLedger(ledgerId);

        return prisma.ledger.update({
            where: { id: ledgerId },
            data: {
                ...(payload.name && { name: payload.name }),
                ...(payload.code && { code: payload.code }),
                ...(payload.isActive !== undefined && { isActive: payload.isActive }),
            }
        })
    }

    /**
     * =====================================
     * UPDATE BALANCE
     * =====================================
     *
     * DEBIT  => Increase
     * CREDIT => Decrease
     *
     * Use only from Voucher Service
    */

    static async updateBalance(
        tx: Prisma.TransactionClient,
        ledgerId: string,
        amount: number,
        entryType: EntryType
    ) {
        const ledger = await this.validateLedger(ledgerId);

        let currentBalance = Number(ledger.currentBalance);

        const updatedBalance = 
            entryType === EntryType.DEBIT
                ? currentBalance + amount
                : currentBalance - amount;

        return tx.ledger.update({
            where: { id: ledgerId },
            data: {
                currentBalance: updatedBalance,
            }
        })
    }

    /**
     * =====================================
     * Agency Outstanding
     * =====================================
     */

    static async getAgencyOutstanding(
        agencyId: string,
    ) {
        const sales = await prisma.sale.findMany({
            where: {
                agencyId,
                status: "APPROVED"
            },
            include: {
                allocations: true,
            }
        });

        const purchases = await prisma.purchase.findMany({
            where: {
                agencyId,
                status: "APPROVED"
            },
            include: {
                allocations: true,
            }
        });

        const salesOutstandings = sales.reduce((sum, sale) => {
            const paid = sale.allocations.reduce((allocSum, alloc) => allocSum + Number(alloc.allocatedAmount), 0);
            return sum + (Number(sale.grandTotal) - paid);
        }, 0);

        const purchasesOutstandings = purchases.reduce((sum, purchase) => {
            const paid = purchase.allocations.reduce((allocSum, alloc) => allocSum + Number(alloc.allocatedAmount), 0);
            return sum + (Number(purchase.grandTotal) - paid);
        }, 0);

        return {
            agencyId,
            receivable: salesOutstandings,
            payable: purchasesOutstandings,
            netOutstanding: salesOutstandings - purchasesOutstandings,
        }
    }

    static async getLedgerBalance(ledgerId: string) {
        const ledger = await this.validateLedger(ledgerId);

        return {
            ledgerId: ledger.id,
            name: ledger.name,
            code: ledger.code,
            category: ledger.category,

            openingBalance: Number(ledger.openingBalance),
            currentBalance: Number(ledger.currentBalance),

            netMovement: Number(ledger.currentBalance) - Number(ledger.openingBalance),

            isActive: ledger.isActive,
        }
    }
}