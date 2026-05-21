import { Request, Response, NextFunction } from "express";
import { UserService } from "./user.service";

export const createUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            name, email, phone, password, branchAccessType, branchId
        } = req.body;

        const user = await UserService.createUser(actor, {
            name,
            email,
            phone,
            password,
            branchAccessType,
            branchId
        });

        return res.status(201).json({
            success: true,
            message: "User created successfully",
            data: { user },
        });

    } catch (error) {
        next(error);
    }
}

export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = (req as any).user;

    const users = await UserService.getAllUsers(actor, {
      search: req.query.search as string | undefined,
      branch: req.query.branch as string | undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: { users },
    });
  } catch (error) {
    next(error);
  }
};
export const getUserById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { userId } = (req as any).params;

        const user = await UserService.getUserById(actor, userId);

        return res.status(200).json({
            success: true,
            message: "User fetched successfully",
            data: { user },
        });

    } catch (error) {
        next(error);
    }
}

export const updateUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { userId } = (req as any).params;

        const {
            name, email, phone, branchAccessType, branchId
        } = req.body;

        const user = await UserService.updateUser(actor, userId, {
            name,
            email,
            phone,
            branchAccessType,
            branchId
        });

        return res.status(200).json({
            success: true,
            message: "User updated successfully",
            data: { user },
        });

    } catch (error) {
        next(error);
    }
}

export const updateUserStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { userId } = (req as any).params;
        const { status } = req.body;

        const user = await UserService.updateUserStatus(actor, userId, { status });

        return res.status(200).json({
            success: true,
            message: "User status updated successfully",
            data: { user },
        });

    } catch (error) {
        next(error);
    }
}

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { userId } = (req as any).params;
        const { newPassword } = req.body;

        const user = await UserService.resetPassword(actor, userId, { newPassword });

        return res.status(200).json({
            success: true,
            message: "User password reset successfully",
            data: { user },
        });
    } catch (error) {
        next(error);
    }
}

export const changeOwnerPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = (req as any).user;

    const result =
      await UserService.changeOwnerPassword(
        actor,
        req.body
      );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};