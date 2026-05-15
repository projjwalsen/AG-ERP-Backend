import { Router } from "express";
import * as rbacController from "./rbac.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware)

/**
 * @openapi
 * tags:
 *   - name: RBAC
 *     description: Role and permission management APIs
*/

/**
 * @openapi
 * /api/rbac/roles/upsert:
 *   post:
 *     summary: Create or update role
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Owner
 *               code:
 *                 type: string
 *                 example: OWNER
 *               isActive:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Role upserted successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 */
router.post(
    "/roles/upsert",
    checkPermission("ROLE:WRITE"),
    rbacController.upsertRole
)

/**
 * @openapi
 * /api/rbac/roles/all:
 *   get:
 *     summary: Get all roles
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Roles fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
    "/roles/all",
    checkPermission("ROLE:VIEW"),
    rbacController.getAllRoles
)

/**
 * @openapi
 * /api/rbac/permissions/upsert:
 *   post:
 *     summary: Create or update permission
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [module, action]
 *             properties:
 *               module:
 *                 type: string
 *                 example: USER
 *               action:
 *                 type: string
 *                 example: CREATE
 *               description:
 *                 type: string
 *                 example: Can create users
 *     responses:
 *       200:
 *         description: Permission upserted successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 */
router.post(
    "/permissions/upsert",
    checkPermission("ROLE:WRITE"),
    rbacController.upsertPermissions
)

/**
 * @openapi
 * /api/rbac/permissions/all:
 *   get:
 *     summary: Get all permissions
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Permissions fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
    "/permissions/all",
    checkPermission("ROLE:VIEW"),
    rbacController.getAllPermissions
)

/**
 * @openapi
 * /api/rbac/roles/{roleId}/permissions:
 *   post:
 *     summary: Assign permissions to role
 *     description: Replaces existing role permissions with the given permission IDs.
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: string
 *         example: role_id_1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [permissionIds]
 *             properties:
 *               permissionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["permission_id_1", "permission_id_2"]
 *     responses:
 *       200:
 *         description: Permissions assigned to role successfully
 *       400:
 *         description: Invalid permission IDs
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Role not found
 */
router.post(
    "/roles/:roleId/permissions",
    checkPermission("ROLE:WRITE"),
    rbacController.assignPermissionsToRole
)

/**
 * @openapi
 * /api/rbac/users/{userId}/roles/assign:
 *   post:
 *     summary: Assign roles to user
 *     description: Replaces existing user roles with the given role IDs.
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: user_id_1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleIds]
 *             properties:
 *               roleIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["role_id_1", "role_id_2"]
 *     responses:
 *       200:
 *         description: Roles assigned to user successfully
 *       400:
 *         description: Invalid role IDs
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.post(
    '/users/:userId/roles/assign',
    checkPermission("ROLE:WRITE"),
    rbacController.assignRolesToUser
)

/**
 * @openapi
 * /api/rbac/users/{userId}/roles/unassign:
 *   delete:
 *     summary: Unassign role from user
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: user_id_1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 example: role_id_1
 *     responses:
 *       200:
 *         description: Role unassigned from user successfully
 *       400:
 *         description: Invalid role ID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User or role not found
 */
router.delete(
    '/users/:userId/roles/unassign',
    checkPermission("ROLE:WRITE"),
    rbacController.unassignRoleFromUser
)

/**
 * @openapi
 * /api/rbac/users/{userId}/access:
 *   get:
 *     summary: Get user roles and permissions
 *     tags: [RBAC]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: user_id_1
 *     responses:
 *       200:
 *         description: User roles and permissions fetched successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get(
    '/users/:userId/access',
    checkPermission("ROLE:VIEW"),
    rbacController.getUserRolesAndPermissions
)

export default router;