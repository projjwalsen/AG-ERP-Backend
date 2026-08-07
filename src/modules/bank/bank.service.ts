import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";

type CreateBankAccountPayload = {
    branchId: string;
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    bankBranchName: string;
}

type UpdateBankAccountPayload =
    Partial<CreateBankAccountPayload>;

export class BankService {

    static async createBankAccount(
        actor: any,
        payload: CreateBankAccountPayload
    ) {

        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (
            !payload.branchId ||
            !payload.accountNumber ||
            !payload.ifscCode ||
            !payload.bankName ||
            !payload.bankBranchName
        ) {
            throw new ApiError(
                "Branch, Account Number, IFSC Code, Bank Name and Bank Branch Name are required",
                400
            );
        }

        const branch = await prisma.branch.findUnique({
            where: {
                id: payload.branchId
            }
        });

        if (!branch) {
            throw new ApiError(
                "Branch not found",
                404
            );
        }

        const existing = await prisma.bankAccount.findFirst({
            where: {
                branchId: payload.branchId,
                accountNumber: payload.accountNumber.trim()
            }
        });

        if (existing) {
            throw new ApiError(
                "Bank account already exists for this branch",
                409
            );
        }

        return prisma.bankAccount.create({
            data: {
                branchId: payload.branchId,
                accountNumber: payload.accountNumber.trim(),
                ifscCode: payload.ifscCode.trim().toUpperCase(),
                bankName: payload.bankName.trim(),
                bankBranchName: payload.bankBranchName.trim(),
                isActive: true
            },
            select: {
                id: true,
                accountNumber: true,
                ifscCode: true,
                bankName: true,
                bankBranchName: true,
                isActive: true,
                createdAt: true,
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                }
            }
        });
    }

    static async getAllBankAccounts(
        actor: any,
        query?: {
            branchId?: string;
            search?: string;
        }
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const where: any = {};

        if (query?.branchId) {
            where.branchId = query.branchId;
        }

        if (query?.search) {
            where.OR = [
                {
                    bankName: {
                        contains: query.search,
                        mode: "insensitive"
                    }
                },
                {
                    accountNumber: {
                        contains: query.search
                    }
                },
                {
                    ifscCode: {
                        contains: query.search,
                        mode: "insensitive"
                    }
                },
                {
                    bankBranchName: {
                        contains: query.search,
                        mode: "insensitive"
                    }
                }
            ];
        }

        const [bankAccounts, total] = await Promise.all([
            prisma.bankAccount.findMany({
                where,
                include: {

                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true
                        }
                    }

                },

                orderBy: {
                    createdAt: "desc"
                },
            }),

            prisma.bankAccount.count({
                where
            })

        ]);

        return {
            data: bankAccounts,
            meta: {
                total
            }

        };
    }

    static async getBankAccountById(
        actor: any,
        bankAccountId: string
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const bankAccount =
            await prisma.bankAccount.findUnique({
                where: {
                    id: bankAccountId
                },
                include: {
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            gstin: true
                        }
                    }
                }
            });

        if (!bankAccount) {
            throw new ApiError(
                "Bank Account not found",
                404
            );
        }

        if (
            actor.branchAccessType !== "ALL" &&
            bankAccount.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "Forbidden",
                403
            );
        }

        return bankAccount;
    }

    static async updateBankAccount(
        actor: any,
        bankAccountId: string,
        payload: UpdateBankAccountPayload
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const bankAccount =
            await prisma.bankAccount.findUnique({
                where: {
                    id: bankAccountId
                }
            });

        if (!bankAccount) {
            throw new ApiError(
                "Bank Account not found",
                404
            );
        }

        if (
            actor.branchAccessType !== "ALL" &&
            bankAccount.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "Forbidden",
                403
            );
        }

        if (
            payload.branchId &&
            payload.branchId !== bankAccount.branchId
        ) {

            const branch =
                await prisma.branch.findUnique({
                    where: {
                        id: payload.branchId
                    }
                });

            if (!branch) {
                throw new ApiError(
                    "Branch not found",
                    404
                );
            }

        }

        if (
            payload.accountNumber &&
            payload.accountNumber.trim() !==
            bankAccount.accountNumber
        ) {

            const existing =
                await prisma.bankAccount.findFirst({
                    where: {
                        branchId:
                            payload.branchId ??
                            bankAccount.branchId,
                        accountNumber:
                            payload.accountNumber.trim(),
                        NOT: {
                            id: bankAccountId
                        }
                    }
                });

            if (existing) {
                throw new ApiError(
                    "Bank Account already exists for this branch",
                    409
                );
            }

        }

        return prisma.bankAccount.update({
            where: {
                id: bankAccountId
            },
            data: {
                branchId:
                    payload.branchId,
                accountNumber:
                    payload.accountNumber?.trim(),
                ifscCode:
                    payload.ifscCode
                        ?.trim()
                        .toUpperCase(),
                bankName:
                    payload.bankName?.trim(),
                bankBranchName:
                    payload.bankBranchName?.trim()
            },

            include: {
                branch: true
            }
        });
    }

    static async toggleBankAccountStatus(
        actor: any,
        bankAccountId: string,
        payload: {
            isActive: boolean;
        }
    ) {

        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (
            typeof payload.isActive !== "boolean"
        ) {
            throw new ApiError(
                "isActive must be boolean",
                400
            );
        }

        const bankAccount =
            await prisma.bankAccount.findUnique({
                where: {
                    id: bankAccountId
                }
            });

        if (!bankAccount) {
            throw new ApiError(
                "Bank Account not found",
                404
            );
        }

        if (
            actor.branchAccessType !== "ALL" &&
            bankAccount.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "Forbidden",
                403
            );
        }

        return prisma.bankAccount.update({
            where: {
                id: bankAccountId
            },
            data: {
                isActive: payload.isActive
            },
            include: {
                branch: true
            }
        });
    }

    static async getBranchBankAccounts(
        actor: any,
        branchId: string
    ) {

        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (
            actor.branchAccessType !== "ALL" &&
            actor.branchId !== branchId
        ) {
            throw new ApiError(
                "Forbidden",
                403
            );
        }

        const branch =
            await prisma.branch.findUnique({
                where: {
                    id: branchId
                }
            });

        if (!branch) {
            throw new ApiError(
                "Branch not found",
                404
            );
        }

        return prisma.bankAccount.findMany({
            where: {
                branchId,
                isActive: true
            },

            select: {
                id: true,
                bankName: true,
                bankBranchName: true,
                accountNumber: true,
                ifscCode: true
            },

            orderBy: [
                {
                    bankName: "asc"
                },
                {
                    accountNumber: "asc"
                }
            ]
        });

    }


}