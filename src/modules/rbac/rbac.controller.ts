import { Request, Response, NextFunction } from "express";
import { RBACService } from "./rbac.service";

export const upsertRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            name, code, isActive
        } = req.body;

        const role = await RBACService.upsertRole(actor, {
            name,
            code,
            isActive
        });

        return res.status(200).json({
            success: true,
            message: "Role upserted successfully",
            data: { role },
        });
    } catch (error) {
        next(error);
    }
}

export const getAllRoles = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const allRoles = await RBACService.getRoles(actor);

        return res.status(200).json({
            success: true,
            message: "Roles fetched successfully",
            data: { roles: allRoles },
        });
    } catch (error) {
        next(error);
    }
}

export const upsertPermissions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const { module, action, description } = req.body;

        const permissions = await RBACService.upsertPermission(actor, {
            module,
            action,
            description
        });

        return res.status(200).json({
            success: true,
            message: "Permission upserted successfully",
            data: { permissions },
        });
    } catch (error) {
        next(error);
    }
}

export const getAllPermissions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const allPermissions = await RBACService.getPermissions(actor);

        return res.status(200).json({
            success: true,
            message: "Permissions fetched successfully",
            data: { permissions: allPermissions },
        });
    } catch (error) {
        next(error);
    }
}

export const assignPermissionsToRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { roleId } = (req as any).params;
        const { permissionIds } = req.body;

        const result = await RBACService.assignPermissionsToRole(
            actor, roleId, {permissionIds}
        );

        return res.status(200).json({
            success: true,
            message: "Permissions assigned to role successfully",
            data: { result },
        });
    } catch (error) {
        next(error);
    }
}

export const assignRolesToUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { userId } = (req as any).params;
        const { roleIds } = req.body;

        const result = await RBACService.assignRolesToUser(
            actor, userId, {roleIds}
        );

        return res.status(200).json({
            success: true,
            message: "Roles assigned to user successfully",
            data: { result },
        });
    } catch (error) {
        next(error);
    }
}

export const unassignRoleFromUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { userId } = (req as any).params;
        const { roleId } = req.body;

        const result = await RBACService.unassignRoleFromUser(
            actor, userId, roleId
        )

        return res.status(200).json({
            success: true,
            message: "Role unassigned from user successfully",
            data: { result },
        });
    } catch (error) {
        next(error);
    }
}

export const getUserRolesAndPermissions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { userId } = (req as any).params;

        const result = await RBACService.getUserRoleAndPermissions(actor, userId);

        return res.status(200).json({
            success: true,
            message: "User roles and permissions fetched successfully",
            data: { result },
        });
    } catch (error) {
        next(error);
    }
}