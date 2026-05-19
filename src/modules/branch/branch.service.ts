import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { normalizeCode } from "../rbac/rbac.service";

type CreateBranchPayload = {
    name: string;
    code: string;
    gstin?: string;
    stateCode?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    pinCode?: string;
}

type updateBranchPayload = Partial<CreateBranchPayload>;

export class BranchService {

    static async createBranch(actor: any, payload: CreateBranchPayload) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(!payload.name || !payload.code) {
            throw new ApiError("Branch Name and Branch Code are required", 400);
        }

        if(payload.gstin && !payload.stateCode) {
            throw new ApiError("State Code is required when GSTIN is provided", 400);
        }

        const code = normalizeCode(payload.code);
        const gstin = payload.gstin?.trim().toUpperCase();

        const existingCode = await prisma.branch.findUnique({
            where: { code }
        });

        if(existingCode) {
            throw new ApiError("Branch with this code already exists", 409);
        }

        if(gstin){
            const existingGstin = await prisma.branch.findUnique({
                where: { gstin }
            });

            if(existingGstin) {
                throw new ApiError("Branch with this GSTIN already exists", 409);
            }
        }

        const branch = await prisma.branch.create({
            data: {
                name: payload.name.trim(),
                code,
                gstin,
                stateCode: payload.stateCode,
                addressLine1: payload.addressLine1,
                addressLine2: payload.addressLine2,
                city: payload.city,
                state: payload.state,
                pinCode: payload.pinCode,
                isActive: true,
            },
            select: {
                id: true,
                name: true,
                code: true,
                gstin: true,
                stateCode: true,
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                pinCode: true,
                isActive: true,                
                createdAt: true,    
            }
        });

        return branch;
    }

    static async getAllBranches(actor: any) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        return await prisma.branch.findMany({
            select: {
                id: true,
                name: true,
                code: true,
                gstin: true,
                stateCode: true,
                city: true,
                state: true,
                pinCode: true,
                isActive: true,                
                createdAt: true,
                _count: {
                    select: {
                        users: true,
                    }
                }
            },
            orderBy: {
                createdAt: "desc"
            }
        });
    }

    static async getActiveBranchesForSelection(actor: any) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        return prisma.branch.findMany({
            where: {
                isActive: true,
                /** If actor have branchId === null then its OWNER or Super Acceess
                 *  so If branchAccessType is ALL then also return all branches, otherwise return only assigned branch
                 */
                ...(actor.branchAccessType === "SELECTED" && actor.branchId
                    ? { id: actor.branchId }
                    : {}),
            },
            select: {
                id: true,
                name: true,
                code: true,
                gstin: true,
                stateCode: true,
            },
            orderBy: {
                name: "asc",
            },
        });
    }

    static async getBranchById(actor: any, branchId: string) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: {
                id: true,
                name: true,
                code: true,
                gstin: true,
                stateCode: true,
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                pinCode: true,
                isActive: true,
                createdAt: true,
                users: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        status: true,
                        isActive: true,
                        branchAccessType: true,
                    }
                }
            }
        });

        if(!branch) {
            throw new ApiError("Branch not found", 404);
        }

        return branch;
    }

    static async updateBranch(actor: any, branchId: string, payload: updateBranchPayload) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const branch = await prisma.branch.findUnique({
            where: { id: branchId }
        });

        if(!branch) {
            throw new ApiError("Branch not found", 404);
        }

        const code = payload.code ? normalizeCode(payload.code) : undefined;
        const gstin = payload.gstin?.trim().toUpperCase();

        if(code && code !== branch.code) {
            const existingBranch = await prisma.branch.findUnique({
                where: { code }
            });

            if(existingBranch) {
                throw new ApiError("Branch code already exists", 400);
            }
        }

        if(gstin && gstin !== branch.gstin) {
            const existingBranch = await prisma.branch.findUnique({
                where: { gstin }
            });

            if(existingBranch) {
                throw new ApiError("Branch with this GSTIN already exists", 409);
            }
        }

        const updatedBranch = await prisma.branch.update({
            where: { id: branchId },
            data: {
                name: payload.name?.trim(),
                code,
                gstin,
                stateCode: payload.stateCode,
                addressLine1: payload.addressLine1,
                addressLine2: payload.addressLine2,
                city: payload.city?.trim(),
                state: payload.state?.trim(),
                pinCode: payload.pinCode
            },
            select: {
                id: true,
                name: true,
                code: true,
                gstin: true,
                stateCode: true,
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                pinCode: true,
                isActive: true,
                updatedAt: true,
            }
        });

        return updatedBranch;
    }

    static async toggleBranchStatus(actor: any, branchId: string, payload: {
        isActive: boolean;
    }) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(typeof payload.isActive !== "boolean") {
            throw new ApiError("isActive must be a boolean", 400);
        }

        const branch = await prisma.branch.findUnique({
            where: { id: branchId }
        });

        if(!branch) {
            throw new ApiError("Branch not found", 404);
        }

        const updatedBranch = await prisma.branch.update({
            where: { id: branchId },
            data: {
                isActive: payload.isActive
            },
            select: {
                id: true,
                name: true,
                code: true,
                gstin: true,
                stateCode: true,
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                pinCode: true,
                isActive: true,
                updatedAt: true,
            }
        });
        return updatedBranch;
    }
}