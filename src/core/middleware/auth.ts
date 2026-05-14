import { BranchAccessType, UserStatus } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { AUTH_COOKIE_NAME } from '../utils/cookie.util';
import { ApiError } from './errorHandler';
import { verifyAuthToken } from '../utils/jwt.util';
import { prisma } from '../../config/db';

type TokenData = {
    userId: string;
    companyId: string;
}

export const authMiddleware = async(req: Request, res: Response, next: NextFunction) => {
    try {
        const token = req.cookies?.[AUTH_COOKIE_NAME];
    
        if(!token){
            throw new ApiError("Authentation token missing", 401);
        }
        
        const tokenData = verifyAuthToken(token) as TokenData;

        if(!tokenData){
            throw new ApiError("Invalid authentication token", 401);
        }

        const user = await prisma.user.findUnique({
            where: { id: tokenData.userId },
            select: {
                id: true,
                name: true,
                email: true,
                companyId: true,
                branchAccessType: true,
                status: true,
                isActive: true,
                company: {
                    select: {
                        id: true,
                        name: true,
                        isActive: true,
                    }
                },
                branches: {
                    include: {
                        branch: {
                            select: {
                                id: true,
                                isActive: true,
                            }
                        }
                    }
                }
            }
        });

        if(!user) throw new ApiError("Invalid Authentication", 401);
        if(user.companyId !== tokenData.companyId) throw new ApiError("Invalid Company Authentication", 401);
        if(!user.isActive || user.status !== UserStatus.ACTIVE) throw new ApiError("User is Inactive or Suspended", 403);
        if(!user.company?.isActive) throw new ApiError("Company account is inactive", 403);

        const activeBranchIds = user.branches
            .filter((item) => item.branch.isActive)
            .map((item) => item.branch.id);

        (req as any).user = {
            id: user.id,
            name: user.name,
            email: user.email,
            companyId: user.companyId,
            branchAccessType: user.branchAccessType,
            activeBranchIds: activeBranchIds,
        }

        next()
    } catch (error) {
        if(error instanceof ApiError){
            next(error);
        }

        return next(new ApiError("Authentication failed or got Invalid", 401));
    }
}