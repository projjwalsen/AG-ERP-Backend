import bcrypt from 'bcryptjs';
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { BranchAccessType, UserStatus } from '@prisma/client';
import { generateToken } from '../../core/utils/jwt.util';

export type SignupPayload = {
  companyName: string;
  companyPhone?: string;
  companyEmail?: string;

  gstin?: string;
  pan?: string;

  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pinCode?: string;

  name: string;
  email: string;
  phone?: string;
  password: string;
}

export type LoginPayload = {
  email: string;
  password: string;
}

export class AuthService {
    static async signup(payload: SignupPayload){
        const normalizedEmail = payload.email.trim().toLowerCase();

        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (existingUser) {
            throw new ApiError('User already exists with this email', 409);
        }

        const passwordHash = await bcrypt.hash(payload.password, 10);

        const result = await prisma.$transaction(async (tx) => {
            const company = await tx.company.create({
                data: {
                    name: payload.companyName,
                    phone: payload.companyPhone,
                    email: payload.companyEmail,
                    gstin: payload.gstin,
                    pan: payload.pan,
                    addressLine1: payload.addressLine1,
                    addressLine2: payload.addressLine2,
                    city: payload.city,
                    state: payload.state,
                    stateCode: payload.stateCode,
                    pinCode: payload.pinCode,
                }
            });

            const user = await tx.user.create({
                data: {
                    companyId: company.id,
                    name: payload.name,
                    email: normalizedEmail,
                    phone: payload.phone,
                    password: passwordHash,
                    status: UserStatus.ACTIVE,
                    isActive: true,

                    // first user of the company is super admin by default
                    branchAccessType: BranchAccessType.ALL,
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
                }
            });

            return { company, user };
        });

        const token = generateToken({
            userId: result.user.id,
            companyId: result.company.id,
        })

        return {
            token,
            user: result.user,
            company: {
                id: result.company.id,
                name: result.company.name,
                email:  result.company.email,
                phone: result.company.phone,
                gstin: result.company.gstin,
                pan: result.company.pan,
            }
        }
    }

    static async login(payload: LoginPayload) {
        const normalizedEmail = payload.email.trim().toLowerCase();

        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            include: {
            company: {
                select: {
                id: true,
                name: true,
                isActive: true,
                },
            },
            branches: {
                include: {
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
        });

        if (!user) {
            throw new ApiError("Invalid email or password", 401);
        }

        const isPasswordValid = await bcrypt.compare(payload.password, user.password);

        if (!isPasswordValid) {
            throw new ApiError("Invalid email or password", 401);
        }

        if (!user.isActive || user.status !== UserStatus.ACTIVE) {
            throw new ApiError("User is inactive or suspended", 403);
        }

        if (!user.company?.isActive) {
            throw new ApiError("Company account is inactive", 403);
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
            lastLoginAt: new Date(),
            },
        });

        const activeBranches = user.branches
            .filter((item) => item.branch.isActive)
            .map((item) => ({
            id: item.branch.id,
            name: item.branch.name,
            code: item.branch.code,
            isPrimary: item.isPrimary,
            }));

        const token = generateToken({
            userId: user.id,
            companyId: user.companyId,
        });

        return {
            token,
            user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            companyId: user.companyId,
            branchAccessType: user.branchAccessType,
            status: user.status,
            isActive: user.isActive,
            company: user.company,
            branches: activeBranches,
            },
        };
    }

    static async getProfile(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                companyId: true,
                branchAccessType: true,
                status: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
                company: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        gstin: true,
                        pan: true,
                        addressLine1: true,
                        isActive: true,
                    },
                },
                branches: {
                    include: {
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

        if (!user) {
            throw new ApiError("User not found", 404);
        }
        if(!user.isActive || user.status !== UserStatus.ACTIVE){
            throw new ApiError("User is inactive or suspended", 403);
        }
        if(!user.company?.isActive){
            throw new ApiError("Company account is inactive", 403);
        }

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            companyId: user.companyId,
            branchAccessType: user.branchAccessType,
            status: user.status,
            isActive: user.isActive,
            company: user.company,
            branches: user.branches.map((item) => ({
                id: item.branch.id,
                name: item.branch.name,
                code: item.branch.code,
                gstin: item.branch.gstin,
                stateCode: item.branch.stateCode,
                isActive: item.branch.isActive,
                isPrimary: item.isPrimary,
            })),
        }
    }
}