import bcrypt from "bcryptjs";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { BranchAccessType, UserStatus } from "@prisma/client";
import { generateToken } from "../../core/utils/jwt.util";

export type SignupPayload = {
  name: string;
  email: string;
  phone?: string;
  password: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export class AuthService {
  static async signup(payload: SignupPayload) {
    const normalizedEmail = payload.email.trim().toLowerCase();

    const existingUsersCount = await prisma.user.count();

    if (existingUsersCount > 0) {
        throw new ApiError(
            "Signup is already completed. Please login or ask admin to create user.",
            403
        );
    }

    if (!payload.name || !payload.email || !payload.password) {
      throw new ApiError("Name, email and password are required", 400);
    }

    if (payload.password.length < 6) {
      throw new ApiError("Password must be at least 6 characters long", 400);
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ApiError("User already exists with this email", 409);
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const user = await prisma.user.create({
      data: {
        name: payload.name,
        email: normalizedEmail,
        phone: payload.phone,
        password: passwordHash,

        status: UserStatus.ACTIVE,
        isActive: true,

        // first signup user is admin/owner-level user
        branchAccessType: BranchAccessType.ALL,
        branchId: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        branchId: true,
        branchAccessType: true,
        status: true,
        isActive: true,
        createdAt: true,
      },
    });

    const token = generateToken({
      userId: user.id,
    });

    return {
      token,
      user,
    };
  }

  static async login(payload: LoginPayload) {
    const normalizedEmail = payload.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
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
    });

    if (!user) {
      throw new ApiError("Invalid email or password", 401);
    }

    const isPasswordValid = await bcrypt.compare(
      payload.password,
      user.password
    );

    if (!isPasswordValid) {
      throw new ApiError("Invalid email or password", 401);
    }

    if (!user.isActive || user.status !== UserStatus.ACTIVE) {
      throw new ApiError("User is inactive or suspended", 403);
    }

    if (
      user.branchAccessType === BranchAccessType.SELECTED &&
      (!user.branchId || !user.branch?.isActive)
    ) {
      throw new ApiError("Assigned branch is missing or inactive", 403);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    const token = generateToken({
      userId: user.id,
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,

        branchId: user.branchId,
        branchAccessType: user.branchAccessType,

        status: user.status,
        isActive: user.isActive,

        branch: user.branch,
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

        branchId: true,
        branchAccessType: true,

        status: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,

        branch: {
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
          },
        },
      },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    if (!user.isActive || user.status !== UserStatus.ACTIVE) {
      throw new ApiError("User is inactive or suspended", 403);
    }

    if (
      user.branchAccessType === BranchAccessType.SELECTED &&
      (!user.branchId || !user.branch?.isActive)
    ) {
      throw new ApiError("Assigned branch is missing or inactive", 403);
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,

      branchId: user.branchId,
      branchAccessType: user.branchAccessType,

      status: user.status,
      isActive: user.isActive,

      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,

      branch: user.branch,
    };
  }
}