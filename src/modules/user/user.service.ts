import { BranchAccessType, UserStatus } from "@prisma/client";
import { prisma } from "../../config/db";
import bcrypt from 'bcryptjs';
import { ApiError } from "../../core/middleware/errorHandler";

export class UserService {
    static async createUser(actor: any, payload: {
        name: string;
        email: string;
        phone?: string;
        password: string;
        branchAccessType: BranchAccessType;
        branchIds?: string[];
    }) {
        const normalizedEmail = payload.email.trim().toLowerCase();

        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });
        if (existingUser) {
            throw new ApiError("User with this email already exists", 409);
        }
        if(!payload.name || !payload.email || !payload.password){
            throw new ApiError("Name, email and password are required", 400);
        }
        if(payload.password.length < 6){
            throw new ApiError("Password must be at least 6 characters long", 400);
        }

        const branchAccessType = payload.branchAccessType || BranchAccessType.SELECTED;
        if(branchAccessType === BranchAccessType.SELECTED && (!payload.branchIds || payload.branchIds.length === 0)){
            throw new ApiError("Branch IDs are required for SELECTED branch access type", 400);
        }

        if(payload.branchIds?.length){
            //verify branches belong to the company
            const validBranches = await prisma.branch.findMany({
                where: {
                    id: { in: payload.branchIds },
                    companyId: actor.companyId,
                    isActive: true,
                },
                select: { id: true },
            });

            if(validBranches.length !== payload.branchIds.length){
                throw new ApiError("One or more invalid branch IDs provided", 400);
            }
        }

        //Hash password
        const passwordHash = await bcrypt.hash(payload.password, 10);

        const user = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    companyId: actor.companyId,
                    name: payload.name,
                    email: normalizedEmail,
                    phone: payload.phone,
                    password: passwordHash,
                    status: UserStatus.ACTIVE,
                    isActive: true,
                    branchAccessType,
                    createdById: actor.id,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    companyId: true,
                    branchAccessType: true,
                    status: true,
                    isActive: true,
                    createdAt: true,
                },
            });

            if(branchAccessType === BranchAccessType.SELECTED && payload.branchIds?.length){
                const userBranchData = payload.branchIds.map((branchId, indx) => ({
                    userId: newUser.id,
                    branchId,
                    isPrimary: indx === 0, // first branch is primary by default
                }))
                await tx.userBranch.createMany({
                    data: userBranchData,
                    skipDuplicates: true,
                });
            }
            return newUser;
        });

        return user;
    }

    static async updateUser(actor: any, userId: string, payload: {
        name?: string;
        phone?: string;
        email?: string;
        branchAccessType?: BranchAccessType;
        branchIds?: string[];
    }) {
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            include: { branches: true },
        });

        if(!existingUser) throw new ApiError("User not found", 404);

        const branchAccessType = payload.branchAccessType || existingUser.branchAccessType;

        if(branchAccessType === BranchAccessType.SELECTED &&
            payload.branchIds &&
            payload.branchIds.length === 0
        ){
            throw new ApiError("Branch IDs are required for SELECTED branch access type", 400);
        }

        if(payload.branchIds?.length){
            //verify branches belong to the company
            const validBranches = await prisma.branch.findMany({
                where: {
                    id: { in: payload.branchIds },
                    companyId: actor.companyId,
                    isActive: true,
                },
                select: { id: true },
            });

            if(validBranches.length !== payload.branchIds.length){
                throw new ApiError("One or more invalid branch IDs provided", 400);
            }
        }

        const updatedUser = await prisma.$transaction(async (tx) => {
            const user = await tx.user.update({
                where: { id: userId },
                data: {
                    name: payload.name,
                    phone: payload.phone,
                    email: payload.email ? payload.email.trim().toLowerCase() : undefined,
                    branchAccessType,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    companyId: true,
                    branchAccessType: true,
                    status: true,
                    isActive: true,
                    createdAt: true,
                },
            });
            
            if(payload.branchIds){
                // if branch IDs are provided, update user branches
                await tx.userBranch.deleteMany({
                    where: { userId },
                });

                if(branchAccessType === BranchAccessType.SELECTED && payload.branchIds.length > 0){
                    await tx.userBranch.createMany({
                        data: payload.branchIds.map((branchId, indx) => ({
                            userId,
                            branchId,
                            isPrimary: indx === 0, // first branch is primary by default
                        })),
                        skipDuplicates: true,
                    })
                }
            }
            return user;
        });

        return updatedUser;
    }

    static async getAllUsers(actor: any){
        const users = await prisma.user.findMany({
            where: { companyId: actor.companyId },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                branchAccessType: true,
                status: true,
                isActive: true,
                createdAt: true,
                branches: {
                    select: {
                        isPrimary: true,
                        branch: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                isActive: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return users.map((user) => ({
            ...user,
            branches: user.branches.map((ub) => ({
                id: ub.branch.id,
                name: ub.branch.name,
                code: ub.branch.code,
                isPrimary: ub.isPrimary,
                isActive: ub.branch.isActive,
            })),
        }))
    }

    static async getUserById(actor: any, userId: string){
        const user = await prisma.user.findFirst({
            where: {
                id: userId,
                companyId: actor.companyId,
            },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                companyId: true,
                branchAccessType: true,
                status: true,
                isActive: true,
                createdAt: true,
                branches: {
                    select: {
                        isPrimary: true,
                        branch: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                gstin: true,
                                stateCode: true,
                                isActive: true,
                            },
                        },
                    },
                },
            }
        });

        if(!user){
            throw new ApiError("User not found", 404);
        }

        return {
            ...user,
            branches: user.branches.map((ub) => ({
                id: ub.branch.id,
                name: ub.branch.name,
                code: ub.branch.code,
                gstin: ub.branch.gstin,
                stateCode: ub.branch.stateCode,
                isActive: ub.branch.isActive,
                isPrimary: ub.isPrimary,
            }))
        }
    }

    static async updateUserStatus(actor: any, userId: string, payload: {
        status: UserStatus
    }){
        if(actor.id === userId){
            throw new ApiError("You cannot update your own status", 400);
        }

        if (!(payload.status === UserStatus.ACTIVE || payload.status === UserStatus.SUSPENDED)) {
            throw new ApiError("Invalid user status", 400);
        }

        const user = await prisma.user.findFirst({
            where: {
                id: userId,
                companyId: actor.companyId,
            }
        });

        if(!user){
            throw new ApiError("User not found", 404);
        }

        if(user.status === payload.status){
            throw new ApiError(`User is already ${payload.status.toLowerCase()}`, 400);
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                status: payload.status,
                isActive: payload.status === UserStatus.ACTIVE,
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
                isActive: true,
                updatedAt: true,
            }
        })

        return updatedUser;
    }

    
}