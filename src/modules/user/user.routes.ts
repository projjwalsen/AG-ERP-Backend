import { Router } from "express";
import * as userController from "./user.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/users/create:
 *   post:
 *     summary: Create user
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Branch Cashier
 *               email:
 *                 type: string
 *                 example: cashier@example.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *               password:
 *                 type: string
 *                 example: Password@123
 *               branchAccessType:
 *                 type: string
 *                 enum: [ALL, SELECTED]
 *                 example: SELECTED
 *               branchId:
 *                 type: string
 *                 example: "branch_id_1"
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Invalid request body
 *       409:
 *         description: User already exists
 */
router.post(
    "/create",
    checkPermission("USER:WRITE"),
    userController.createUser
);

/**
 * @openapi
 * /api/users/all:
 *   get:
 *     summary: Get all users
 *     description: Fetch users with optional search and branch filters.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *         description: Search by user name or email.
 *         example: rahul
 *       - in: query
 *         name: branch
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter/search by branch name, branch code, or GSTIN.
 *         example: KOL_DEPOT
 *     responses:
 *       200:
 *         description: Users fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Permission denied
 */
router.get(
    "/all",
    checkPermission("USER:VIEW"),
    userController.getAllUsers
);

/**
 * @openapi
 * /api/users/{userId}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
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
 *         description: User fetched successfully
 *       404:
 *         description: User not found
 */
router.get(
    "/:userId",
    checkPermission("USER:VIEW"),
    userController.getUserById
);

/**
 * @openapi
 * /api/users/update/{userId}:
 *   patch:
 *     summary: Update user
 *     tags: [Users]
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
 *             properties:
 *               name:
 *                 type: string
 *                 example: Updated User
 *               phone:
 *                 type: string
 *                 example: "9999999999"
 *               branchAccessType:
 *                 type: string
 *                 enum: [ALL, SELECTED]
 *                 example: SELECTED
 *               branchId:
 *                 type: string
 *                 example: "branch_id_1"
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Invalid request body
 *       404:
 *         description: User not found
 */
router.patch(
    "/update/:userId",
    checkPermission("USER:WRITE"),
    userController.updateUser
);

/**
 * @openapi
 * /api/users/update-status/{userId}:
 *   patch:
 *     summary: Update user status
 *     description: Activate or suspend a user.
 *     tags: [Users]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, SUSPENDED]
 *                 example: SUSPENDED
 *     responses:
 *       200:
 *         description: User status updated successfully
 *       400:
 *         description: Invalid status or self-suspend attempt
 *       404:
 *         description: User not found
 */
router.patch(
    "/update-status/:userId",
    checkPermission("USER:WRITE"),
    userController.updateUserStatus
);

/**
 * @openapi
 * /api/users/reset-password/{userId}:
 *   patch:
 *     summary: Reset user password
 *     description: Admin/Owner resets a user's password by replacing the old password.
 *     tags: [Users]
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
 *             required: newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 example: NewPassword@123
 *     responses:
 *       200:
 *         description: User password reset successfully
 *       400:
 *         description: Invalid password or password mismatch
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.patch(
    "/reset-password/:userId",
    checkPermission("USER:WRITE"),
    userController.resetPassword
)

export default router;