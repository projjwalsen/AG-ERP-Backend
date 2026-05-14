import { BranchAccessType, UserStatus } from "@prisma/client";
import { prisma } from "../../config/db";
import bcrypt from "bcryptjs";
import { ApiError } from "../../core/middleware/errorHandler";

export class UserService {
  static async createUser(
    actor: any,
    payload: {
      name: string;
      email: string;
      phone?: string;
      password: string;
      branchAccessType?: BranchAccessType;
      branchId?: string;
    }
  ) {
    const normalizedEmail = payload.email.trim().toLowerCase();

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
      throw new ApiError("User with this email already exists", 409);
    }

    const branchAccessType =
      payload.branchAccessType || BranchAccessType.SELECTED;

    if (branchAccessType === BranchAccessType.SELECTED && !payload.branchId) {
      throw new ApiError(
        "Branch ID is required for SELECTED branch access type",
        400
      );
    }

    if (branchAccessType === BranchAccessType.ALL && payload.branchId) {
      throw new ApiError("ALL branch access user should not have branchId", 400);
    }

    if (payload.branchId) {
      const branch = await prisma.branch.findFirst({
        where: {
          id: payload.branchId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!branch) {
        throw new ApiError("Invalid branch ID provided", 400);
      }
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const user = await prisma.user.create({
      data: {
        branchId:
          branchAccessType === BranchAccessType.SELECTED
            ? payload.branchId
            : null,

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
        branchId: true,
        branchAccessType: true,
        status: true,
        isActive: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
          },
        },
      },
    });

    return user;
  }

  static async updateUser(
    actor: any,
    userId: string,
    payload: {
      name?: string;
      phone?: string;
      email?: string;
      branchAccessType?: BranchAccessType;
      branchId?: string | null;
    }
  ) {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new ApiError("User not found", 404);
    }

    if (actor.id === userId && payload.branchAccessType) {
      throw new ApiError("You cannot change your own branch access", 400);
    }

    const branchAccessType =
      payload.branchAccessType || existingUser.branchAccessType;

    if (branchAccessType === BranchAccessType.SELECTED && !payload.branchId) {
      throw new ApiError(
        "Branch ID is required for SELECTED branch access type",
        400
      );
    }

    if (branchAccessType === BranchAccessType.ALL && payload.branchId) {
      throw new ApiError("ALL branch access user should not have branchId", 400);
    }

    if (payload.email) {
      const normalizedEmail = payload.email.trim().toLowerCase();

      const emailExists = await prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          NOT: { id: userId },
        },
      });

      if (emailExists) {
        throw new ApiError("User with this email already exists", 409);
      }
    }

    if (payload.branchId) {
      const branch = await prisma.branch.findFirst({
        where: {
          id: payload.branchId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!branch) {
        throw new ApiError("Invalid branch ID provided", 400);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: payload.name,
        phone: payload.phone,
        email: payload.email ? payload.email.trim().toLowerCase() : undefined,
        branchAccessType,
        branchId:
          branchAccessType === BranchAccessType.SELECTED
            ? payload.branchId
            : null,
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
        updatedAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
          },
        },
      },
    });

    return updatedUser;
  }

  static async getAllUsers(_actor: any) {
    const users = await prisma.user.findMany({
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
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return users;
  }

  static async getUserById(_actor: any, userId: string) {
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
        createdAt: true,
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
      throw new ApiError("User not found", 404);
    }

    return user;
  }

  static async updateUserStatus(
    actor: any,
    userId: string,
    payload: {
      status: UserStatus;
    }
  ) {
    if (actor.id === userId) {
      throw new ApiError("You cannot update your own status", 400);
    }

    if (
      !(
        payload.status === UserStatus.ACTIVE ||
        payload.status === UserStatus.SUSPENDED
      )
    ) {
      throw new ApiError("Invalid user status", 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    if (user.status === payload.status) {
      throw new ApiError(
        `User is already ${payload.status.toLowerCase()}`,
        400
      );
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
      },
    });

    return updatedUser;
  }
}