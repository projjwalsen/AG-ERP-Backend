import { Router } from "express";
import * as BankController from "./bank.controller";
import { authMiddleware } from "../../core/middleware/auth";

const router = Router();
router.use(authMiddleware);

/**
 * @openapi
 * /api/bank/create:
 *   post:
 *     tags:
 *       - Bank Accounts
 *     summary: Create Bank Account
 *     description: Creates a new bank account under a branch.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - branchId
 *               - accountNumber
 *               - ifscCode
 *               - bankName
 *               - bankBranchName
 *             properties:
 *               branchId:
 *                 type: string
 *                 format: uuid
 *               accountNumber:
 *                 type: string
 *               ifscCode:
 *                 type: string
 *               bankName:
 *                 type: string
 *               bankBranchName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Bank account created successfully.
 *       400:
 *         description: Validation failed.
 *       401:
 *         description: Unauthorized.
 *       404:
 *         description: Branch not found.
 *       409:
 *         description: Bank account already exists.
 */
router.post(
    "/create",
    BankController.createBankAccount
);

/**
 * @openapi
 * /api/bank/get-all:
 *   get:
 *     tags:
 *       - Bank Accounts
 *     summary: Get All Bank Accounts
 *     description: Returns all bank accounts. Optionally filter by branch and search.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by branch.
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by bank name, account number, IFSC or branch name.
 *     responses:
 *       200:
 *         description: Bank accounts fetched successfully.
 *       401:
 *         description: Unauthorized.
 */
router.get(
    "/get-all",
    BankController.getAllBankAccounts
);

/**
 * @openapi
 * /api/bank/branch/{branchId}:
 *   get:
 *     tags:
 *       - Bank Accounts
 *     summary: Get Branch Bank Accounts
 *     description: Returns all active bank accounts belonging to a branch.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Active bank accounts fetched successfully.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Branch not found.
 */
router.get(
    "/branch/:branchId",
    BankController.getBranchBankAccounts
);

/**
 * @openapi
 * /api/bank/branch/{branchId}:
 *   get:
 *     tags:
 *       - Bank Accounts
 *     summary: Get Branch Bank Accounts
 *     description: Returns all active bank accounts belonging to a branch.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Active bank accounts fetched successfully.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Branch not found.
 */
router.get(
    "/:bankAccountId",
    BankController.getBankAccountById
);

/**
 * @openapi
 * /api/bank/update/{bankAccountId}:
 *   put:
 *     tags:
 *       - Bank Accounts
 *     summary: Update Bank Account
 *     description: Updates bank account information.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bankAccountId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               branchId:
 *                 type: string
 *                 format: uuid
 *               accountNumber:
 *                 type: string
 *               ifscCode:
 *                 type: string
 *               bankName:
 *                 type: string
 *               bankBranchName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bank account updated successfully.
 *       400:
 *         description: Validation failed.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Bank account not found.
 *       409:
 *         description: Duplicate bank account.
 */
router.put(
    "/update/:bankAccountId",
    BankController.updateBankAccount
);

/**
 * @openapi
 * /api/bank/{bankAccountId}/status:
 *   patch:
 *     tags:
 *       - Bank Accounts
 *     summary: Toggle Bank Account Status
 *     description: Activate or deactivate a bank account.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bankAccountId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isActive
 *             properties:
 *               isActive:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Bank account status updated successfully.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Bank account not found.
 */
router.patch(
    "/:bankAccountId/status",
    BankController.toggleBankAccountStatus
);


export default router;