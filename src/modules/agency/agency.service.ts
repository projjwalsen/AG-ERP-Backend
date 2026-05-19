import { AgencyType } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { prisma } from "../../config/db";

export type AgencyBranchInput = {
    branchId: string;
    openingBalance?: number;
};

export type CreateAgencyInput = {
    name: string;
    type: AgencyType;
    gstin: string;

    contactPerson: string;
    mobileNumber: string;
    email: string;

    addressLine1: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    stateCode: string;
    pinCode: string;

    branches?: AgencyBranchInput[];
}

type UpdateAgencyInput = Omit<Partial<CreateAgencyInput>, "branches"> & {
    branches?: AgencyBranchInput[];
};

export class AgencyService {

    static async createAgency(actor: any, payload: CreateAgencyInput) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(!payload.name || !payload.type) {
            throw new ApiError("Agency Name and Agency Type are required", 400);
        }
        if(!Object.values(AgencyType).includes(payload.type)) {
            throw new ApiError("Invalid Agency Type", 400);
        }

        if(payload.gstin && !payload.stateCode) {
            throw new ApiError("State Code is required when GSTIN is provided", 400);
        }

        const normalizeGstin = payload.gstin?.trim().toUpperCase();

        if(normalizeGstin){
            const existingGstin = await prisma.agency.findUnique({
                where: { gstin: normalizeGstin }
            });

            if(existingGstin) {
                throw new ApiError("Agency with this GSTIN already exists", 409);
            }
        }

        if(payload.branches && payload.branches.length > 0) {
            const uniqueBranchIds = [...new Set(payload.branches.map(b => b.branchId))];

            if(uniqueBranchIds.length !== payload.branches.length) {
                throw new ApiError("Duplicate branch entries are not allowed", 400);
            }

            const validBranches = await prisma.branch.findMany({
                where: {
                    id: {
                        in: uniqueBranchIds
                    },
                    isActive: true
                },
                select: {
                    id: true
                }
            });

            if(validBranches.length !== uniqueBranchIds.length){
                throw new ApiError("One or more branches are invalid or inactive", 400);
            }
        }

        const agency = await prisma.$transaction(async (tx) => {
            const createdAgency = await tx.agency.create({
                data: {
                    name: payload.name.trim(),
                    type: payload.type,
                    gstin: normalizeGstin,
                    contactPerson: payload.contactPerson?.trim(),
                    mobileNumber: payload.mobileNumber?.trim(),
                    email: payload.email?.trim(),
                    addressLine1: payload.addressLine1?.trim(),
                    addressLine2: payload.addressLine2?.trim(),
                    city: payload.city?.trim(),
                    state: payload.state?.trim(),
                    stateCode: payload.stateCode?.trim(),
                    pinCode: payload.pinCode?.trim(),

                    isActive: true,
                },
                select: {
                    id: true,
                    name: true,
                    type: true,
                    gstin: true,
                    contactPerson: true,
                    mobileNumber: true,
                    email: true,
                    addressLine1: true,
                    addressLine2: true,
                    city: true,
                    state: true,
                    stateCode: true,
                    pinCode: true,
                    isActive: true,
                    createdAt: true,
                }
            });

            if(payload.branches?.length) {
                await tx.agencyBranch.createMany({
                    data: payload.branches.map((b) => ({
                        agencyId: createdAgency.id,
                        branchId: b.branchId,
                        openingBalance: b.openingBalance ?? 0,
                        isActive: true,
                    })),
                    skipDuplicates: true,
                });
            }

            return createdAgency;
        });
        return agency;
    }

    static async getAllAgencies(
        actor: any, 
        query?: {
            search?: string;
            type?: AgencyType;
            branch?: string;
        }
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const search = query?.search?.trim();
        const branch = query?.branch?.trim();
        const type = query?.type;

        const agencies = await prisma.agency.findMany({
            where: {
                isActive: true,

                ...(type && { type }),

                ...(search && {
                    OR: [
                        {
                            name: {
                                contains: search,
                                mode: "insensitive",
                            }
                        },
                        {
                            gstin: {
                                contains: search,
                                mode: "insensitive",
                            }
                        },
                        {
                            contactPerson: {
                                contains: search,
                                mode: "insensitive",
                            }
                        },
                        {
                            mobileNumber: {
                                contains: search,
                                mode: "insensitive",
                            }
                        }
                    ]
                }),

                ...(branch && {
                    branches: {
                        some: {
                            branch: {
                                OR: [
                                    {
                                        name: {
                                            contains: branch,
                                            mode: "insensitive",
                                        }
                                    },
                                    {
                                        code: {
                                            contains: branch,
                                            mode: "insensitive",
                                        }
                                    },
                                    {
                                        gstin: {
                                            contains: branch,
                                            mode: "insensitive",
                                        }
                                    }
                                ]
                            }
                        }
                    }
                })
            },
            select: {
                id: true,
                name: true,
                type: true,
                gstin: true,
                contactPerson: true,
                mobileNumber: true,
                email: true,
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                stateCode: true,
                pinCode: true,
                isActive: true,
                branches: {
                    select: {
                        id: true,
                        openingBalance: true,
                        isActive: true,
                        branch: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                gstin: true,
                                state: true,
                                stateCode: true,
                                pinCode: true,
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        return agencies.map((agency) => ({
            ...agency,
            branches: agency.branches.map((ab) => ({
                agencyBranchId: ab.id,
                openingBalance: ab.openingBalance,
                isActive: ab.isActive,
                branch: ab.branch,
            }))
        }));
    }

    static async getAgencyById(actor: any, agencyId: string) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const agency = await prisma.agency.findFirst({
            where: {
                id: agencyId,
            },
            select: {
                id: true,
                name: true,
                type: true,
                gstin: true,

                contactPerson: true,
                mobileNumber: true,
                email: true,

                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                stateCode: true,
                pinCode: true,

                isActive: true,
                createdAt: true,
                updatedAt: true,

                branches: {
                    select: {
                        id: true,
                        openingBalance: true,
                        isActive: true,
                        branch: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                gstin: true,
                                state: true,
                                stateCode: true,
                                pinCode: true,
                                isActive: true,
                            }
                        }
                    }
                }
            }
        });

        if(!agency) {
            throw new ApiError("Agency not found", 404);
        }

        return {
            ...agency,
            branches: agency.branches.map((ab) => ({
                agencyBranchId: ab.id,
                openingBalance: ab.openingBalance,
                isActive: ab.isActive,
                branch: ab.branch,
            }))
        };
    };

    static async updateAgency(actor: any, agencyId: string, payload: UpdateAgencyInput) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const existingAgency = await prisma.agency.findUnique({
            where: { id: agencyId }
        });

        if(!existingAgency) {
            throw new ApiError("Agency not found", 404);
        }

        if(payload.type && !Object.values(AgencyType).includes(payload.type)) {
            throw new ApiError("Invalid Agency Type", 400);
        }

        const normalizeGstin = payload.gstin?.trim().toUpperCase();

        if(normalizeGstin && normalizeGstin !== existingAgency.gstin) {
            const existingGstin = await prisma.agency.findFirst({
                where: {
                    gstin: normalizeGstin,
                    NOT: {
                        id: agencyId
                    }
                }
            });

            if(existingGstin) {
                throw new ApiError("Another agency with this GSTIN already exists", 409);
            }
        }

        // Branches
        if(payload.branches) {
            if(payload.branches.length === 0) {
                throw new ApiError("At least one branch is required", 400);
            }

            const uniqueBranchIds = [...new Set(payload.branches.map(b => b.branchId))];

            if(uniqueBranchIds.length !== payload.branches.length) {
                throw new ApiError("Duplicate branch entries are not allowed", 400);
            }

            const validBranches = await prisma.branch.findMany({
                where: {
                    id: {
                        in: uniqueBranchIds
                    },
                    isActive: true,
                },
                select: {
                    id: true,
                }
            });

            if(validBranches.length !== uniqueBranchIds.length){
                throw new ApiError("One or more branches are invalid or inactive", 400);
            }
        };

        const updatedAgency = await prisma.$transaction(async (tx) => {
             const agency = await tx.agency.update({
                where: { id: agencyId },
                data: {
                    name: payload.name,
                    type: payload.type,
                    gstin: normalizeGstin,

                    contactPerson: payload.contactPerson,
                    mobileNumber: payload.mobileNumber,
                    email: payload.email,

                    addressLine1: payload.addressLine1,
                    addressLine2: payload.addressLine2,
                    city: payload.city,
                    state: payload.state,
                    stateCode: payload.stateCode,
                    pinCode: payload.pinCode,
                },
                select: {
                    id: true,
                    name: true,
                    type: true,
                    gstin: true,
                    contactPerson: true,
                    mobileNumber: true,
                    email: true,
                    addressLine1: true,
                    addressLine2: true,
                    city: true,
                    state: true,
                    stateCode: true,
                    pinCode: true,
                    isActive: true,
                    updatedAt: true,
                },
            });

            if(payload.branches) {
                await tx.agencyBranch.deleteMany({
                    where: { agencyId }
                });

                await tx.agencyBranch.createMany({
                    data: payload.branches.map((b) => ({
                        agencyId,
                        branchId: b.branchId,
                        openingBalance: b.openingBalance ?? 0,
                        isActive: true,
                    })),
                    skipDuplicates: true,
                });
            }

            return agency;
        });

        return updatedAgency;
    };

    static async toggleAgencyStatus(actor: any, agencyId: string, payload: {
        isActive: boolean;
    }) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(typeof payload.isActive !== "boolean") {
            throw new ApiError("isActive must be a boolean", 400);
        }

        const agency = await prisma.agency.findUnique({
            where: { id: agencyId }
        });

        if(!agency) {
            throw new ApiError("Agency not found", 404);
        }

        const updatedAgency = await prisma.agency.update({
            where: { id: agencyId },
            data: {
                isActive: payload.isActive
            },
            select: {
                id: true,
                name: true,
                type: true,
                gstin: true,
                isActive: true,
                updatedAt: true,
            }
        });
        return updatedAgency;
    }
}