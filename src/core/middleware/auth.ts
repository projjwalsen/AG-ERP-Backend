import { UserStatus } from "@prisma/client";
import { Request, Response, NextFunction } from "express";
import { AUTH_COOKIE_NAME } from "../utils/cookie.util";
import { ApiError } from "./errorHandler";
import { verifyAuthToken } from "../utils/jwt.util";
import { prisma } from "../../config/db";

type TokenData = {
  userId: string;
};

export const authMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token) {
      throw new ApiError("Authentication token missing", 401);
    }

    const tokenData = verifyAuthToken<TokenData>(token);

    if (!tokenData?.userId) {
      throw new ApiError("Invalid authentication token", 401);
    }

    const user = await prisma.user.findUnique({
      where: {
        id: tokenData.userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        branchId: true,
        branchAccessType: true,

        status: true,
        isActive: true,

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

    if (!user) {
      throw new ApiError("Invalid authentication", 401);
    }

    if (!user.isActive || user.status !== UserStatus.ACTIVE) {
      throw new ApiError("User is inactive or suspended", 403);
    }

    /**
     * Admin rule:
     * - Admin/Owner/Director can have masterId
     * - Admin should not have branchId
     * - Admin uses branchAccessType = ALL
     *
     * Branch user rule:
     * - Normal user has branchId
     * - Normal user uses branchAccessType = SELECTED
     */

    (req as any).user = {
      id: user.id,
      name: user.name,
      email: user.email,

      branchId: user.branchId,

      branchAccessType: user.branchAccessType,

      branch: user.branch
        ? {
            id: user.branch.id,
            name: user.branch.name,
            code: user.branch.code,
          }
        : null,
    };

    return next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }

    return next(new ApiError("Authentication failed or invalid", 401));
  }
};

export const checkPermission = (permKey: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const actor = (req as any).user;

            if(!actor.id){
                throw new ApiError("Authentication required", 401);
            }

            const hasPermissions = await prisma.userRole.findFirst({
                where: {
                    userId: actor.id,
                    role: {
                        isActive: true,
                        rolePermissions: {
                            some: {
                                permission: {
                                    key: permKey,
                                    isActive: true,
                                }
                            }
                        }
                    }
                },
                select: {
                    id: true,
                }
            });

            if (!hasPermissions) {
                throw new ApiError(
                    "Forbidden: You don't have permission to perform this action",
                    403
                );
            }

            next();
        } catch (error) {
            next(error);
        }
    }
}


export const checkBranchAccess = (fieldName = "branchId") => {
    return async (req: Request, res: Response, next: NextFunction) => {
      const actor = (req as any).user;
      const branchId = (req as any).body[fieldName] || (req as any).params?.[fieldName];

      if (!actor.id) {
        return next(new ApiError("Authentication required", 401));
      }

      if(!branchId) {
        return next(new ApiError("Branch ID is required", 400));
      }

      if(actor.branchAccessType === "ALL") {
        return next();
      }

      if(actor.branchId !== branchId) {
        return next(new ApiError("Forbidden: You don't have access to this branch", 403));
      }

      next();
    }
}