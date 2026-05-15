import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";


type CreateRolePayload = {
  name: string;
  code: string;
  description?: string;
  isActive?: boolean;
};

type CreatePermissionPayload = {
  module: string;
  action: string;
  description?: string;
};

type AssignPermissionsPayload = {
  permissionIds: string[];
};

type AssignRolesPayload = {
  roleIds: string[];
};

const normalizeCode = (value: string) => {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
};

export class RBACService {

    static async upsertRole(
        actor: any,
        payload: CreateRolePayload
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }
        if(!payload.name || !payload.code) {
            throw new ApiError("Name and code are required", 400);
        }

        const code = normalizeCode(payload.code);

        const role = await prisma.role.upsert({
            where: { code },
            update: {
                name: payload.name,
                ...(typeof payload.isActive === "boolean" && {
                isActive: payload.isActive,
                }),
            },
            create: {
                name: payload.name,
                code,
                isDefault: false,
                isActive: payload.isActive ?? true,
            },
            select: {
                id: true,
                name: true,
                code: true,
                isDefault: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
            },
        });

    return role;
    }

    static async getRoles(actor: any){
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }
        const roles = await prisma.role.findMany({
            where: {
                isActive: true,
            },
            select: {
                id: true,
                name: true,
                code: true,
                isDefault: true,
                isActive: true,
                createdAt: true,
                rolePermissions: {
                    select: {
                        permission: {
                            select: {
                                id: true,
                                module: true,
                                action: true,
                                key: true,
                                isActive: true,
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: "asc",
            }
        });
        return roles.map((role) => ({
            ...role,
            permissions: role.rolePermissions.map((rp) => rp.permission),
            rolePermissions: undefined,
        }))
    }

    static async upsertPermission(actor: any, payload: CreatePermissionPayload) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(!payload.module || !payload.action) {
            throw new ApiError("Module and action are required", 400);
        }

        const module = normalizeCode(payload.module);
        const action = normalizeCode(payload.action);
        const key = `${module}:${action}`;

        const permissions = await prisma.permission.upsert({
            where: { key },
            update: {
                module,
                action,
                description: payload.description,
                isActive: true,
            },
            create: {
                module,
                action,
                key,
                description: payload.description,
                isActive: true,
            },
            select: {
                id: true,
                module: true,
                action: true,
                key: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
            }
        });
        return permissions;
    }

    static async getPermissions(actor: any) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        return prisma.permission.findMany({
            where: {
                isActive: true,
            },
            select: {
                id: true,
                module: true,
                action: true,
                key: true,
                description: true,
                isActive: true,
                createdAt: true,
            },
            orderBy: [
                {
                    module: "asc",
                },
                {
                    action: "asc",
                }
            ]
        })
    }

    static async assignPermissionsToRole(actor: any, roleId: string, payload: AssignPermissionsPayload) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(!payload.permissionIds || payload.permissionIds.length === 0) {
            throw new ApiError("Permission IDs are required", 400);
        }

        const role = await prisma.role.findUnique({
            where: { id: roleId },
        });
        if(!role) {
            throw new ApiError("Role not found", 404);
        }

        const permissions = await prisma.permission.findMany({
            where: {
                id: {
                    in: payload.permissionIds,
                },
                isActive: true,
            },
        });

        if(permissions.length !== payload.permissionIds.length) {
            throw new ApiError("Some permissions not found or inactive", 404);
        }

        await prisma.$transaction(async (tx) => {
            await tx.rolePermission.deleteMany({
                where: {
                    roleId,
                },
            });

            await tx.rolePermission.createMany({
                data: payload.permissionIds.map((permissionId) => ({
                    roleId,
                    permissionId
                })),
                skipDuplicates: true,
            });
        });

        return {
            message: "Permissions assigned to role successfully",
        }
    }

    static async assignRolesToUser(actor: any, userId: string, payload: AssignRolesPayload) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(!payload.roleIds || payload.roleIds.length === 0) {
            throw new ApiError("Role IDs are required", 400);
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if(!user) {
            throw new ApiError("User not found", 404);
        }

        const roles = await prisma.role.findMany({
            where: {
                id: {
                    in: payload.roleIds,
                },
                isActive: true,
            },
            select: {
                id: true,
            }
        });

        if(roles.length !== payload.roleIds.length) {
            throw new ApiError("Some roles not found or inactive", 404);
        }

        await prisma.$transaction(async (tx) => {
            await tx.userRole.deleteMany({
                where: {
                    userId,
                },
            });
            await tx.userRole.createMany({
                data: payload.roleIds.map((roleId) => ({
                    userId,
                    roleId
                })),
                skipDuplicates: true,
            });
        });

        return {
            message: "Roles assigned to user successfully",
        };
    }

    static async unassignRoleFromUser(actor: any, userId: string, roleId: string) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if(actor.id === userId) {
            throw new ApiError("You cannot unassign your own role", 400);
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if(!user) {
            throw new ApiError("User not found", 404);
        }

        const role = await prisma.role.findUnique({
            where: { id: roleId },
        });

        if(!role) {
            throw new ApiError("Role not found", 404);
        }

        await prisma.userRole.deleteMany({
            where: {
                userId,
                roleId,
            },
        });

        return {
            message: "Role unassigned from user successfully",
        };
    }

    static async getUserRoleAndPermissions(actor: any, userId: string) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                lastLoginAt: true,
                userRoles: {
                    select: {
                        role: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                isActive: true,
                                rolePermissions: {
                                    select: {
                                        permission: {
                                            select: {
                                                id: true,
                                                module: true,
                                                action: true,
                                                key: true,
                                                isActive: true,
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if(!user) {
            throw new ApiError("User not found", 404);
        }

        const activeRoles = user.userRoles
            .filter((ur) => ur.role.isActive)
            .map((ur) => ur.role);

        const permissions = Array.from(
            new Map(
                activeRoles
                .flatMap((role) => role.rolePermissions)
                .map((rp) => rp.permission)
                .filter((perm) => perm.isActive)
                .map((perm) => [perm.key, perm])
            ).values()
        )

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            lastLoginAt: user.lastLoginAt,
            roles: activeRoles.map((role) => ({
                id: role.id,
                name: role.name,
                code: role.code,
            })),
            permissions
        }
    }
}