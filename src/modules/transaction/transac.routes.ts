import { Router } from "express";
import * as TransactionController from "./transac.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/transactions/create:
 *   post:
 *     summary: Create Transaction
 *     tags:
 *       - Transactions
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
 *               - direction
 *               - suspense
 *               - paymentType
 *               - amount
 *               - paymentMode
 *             properties:
 *               branchId:
 *                 type: string
 *               direction:
 *                 type: string
 *                 enum:
 *                   - INWARD
 *                   - OUTWARD
 *               suspense:
 *                 type: boolean
 *               agencyId:
 *                 type: string
 *               paymentType:
 *                 type: string
 *                 enum:
 *                   - NORMAL
 *                   - THIRD_PARTY
 *               paymentThrough:
 *                 type: string
 *                 enum:
 *                   - CASH
 *                   - CHEQUE
 *                   - DD
 *                   - NEFT
 *                   - RTGS
 *                   - UPI
 *                   - BANK_DEPOSIT
 *                 example: UPI
 *      
 *               referenceNo:
 *                 type: string
 *                 description: Reference number for CHEQUE / DD transactions
 *                 example: CHQ123456
 *               thirdPartyAgencyId:
 *                 type: string
 *               amount:
 *                 type: number
 *               paymentMode:
 *                 type: string
 *                 enum:
 *                   - ONLINE
 *                   - OFFLINE
 *                 example: ONLINE
 *               transactionRefNo:
 *                 type: string
 *                 description: NEFT/RTGS/UPI/BANK_DEPOSIT reference number
 *                 example: UPI123456789
 *               remarks:
 *                 type: string
 *     responses:
 *       201:
 *         description: Transaction created successfully
 */

router.post(
    "/create",
    checkPermission("TRANSACTION:WRITE"),
    TransactionController.createTransaction
);


/**
 * @openapi
 * /api/transactions/all:
 *   get:
 *     summary: Get All Transactions
 *     tags:
 *       - Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: agencyId
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - PENDING
 *             - APPROVED
 *             - REJECTED
 *
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum:
 *             - INWARD
 *             - OUTWARD
 *
 *       - in: query
 *         name: paymentType
 *         schema:
 *           type: string
 *           enum:
 *             - NORMAL
 *             - THIRD_PARTY
 *
 *       - in: query
 *         name: suspenseAccount
 *         schema:
 *           type: boolean
 *
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
 */
router.get(
    "/all",
    checkPermission("TRANSACTION:VIEW"),
    TransactionController.getAllTransactions
);

/**
 * @openapi
 * /api/transactions/outstanding:
 *   get:
 *     summary: Get Agency Outstanding
 *     tags:
 *       - Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: agencyId
 *         schema:
 *           type: string
 *
 *
 *     responses:
 *       200:
 *         description: Outstanding retrieved successfully
 */
router.get(
    "/outstanding",
    checkPermission("TRANSACTION:VIEW"),
    TransactionController.getAgencyOutstanding
);


/**
 * @openapi
 * /api/transactions/{transactionId}:
 *   get:
 *     summary: Get Transaction By Id
 *     tags:
 *       - Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction retrieved successfully
 */
router.get(
    "/:transactionId",
    checkPermission("TRANSACTION:VIEW"),
    TransactionController.getTransactionById
);


/**
 * @openapi
 * /api/transactions/update/{transactionId}:
 *   patch:
 *     summary: Update Transaction
 *     tags:
 *       - Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               branchId:
 *                 type: string
 *               direction:
 *                 type: string
 *                 enum:
 *                   - INWARD
 *                   - OUTWARD
 *               suspense:
 *                 type: boolean
 *               agencyId:
 *                 type: string
 *               paymentType:
 *                 type: string
 *                 enum:
 *                   - NORMAL
 *                   - THIRD_PARTY
 *               paymentThrough:
 *                 type: string
 *                 enum:
 *                  - CASH
 *                  - CHEQUE
 *                  - DD
 *                  - NEFT
 *                  - RTGS
 *                  - UPI
 *                  - BANK_DEPOSIT
 *                 example: UPI
 *               thirdPartyAgencyId:
 *                 type: string
 *               amount:
 *                 type: number
 *               paymentMode:
 *                 type: string
 *               transactionRefNo:
 *                 type: string
 *                 description: NEFT/RTGS/UPI/BANK_DEPOSIT reference number
 *                 example: UPI123456789
 *               referenceNo:
 *                 type: string
 *                 description: Reference number for CHEQUE / DD transactions
 *                 example: CHQ123456
 *               remarks:
 *                 type: string
 *
 *     responses:
 *       200:
 *         description: Transaction updated successfully
 */
router.patch(
    "/update/:transactionId",
    checkPermission("TRANSACTION:WRITE"),
    TransactionController.updateTransaction
);


/**
 * @openapi
 * /api/transactions/{transactionId}/approve:
 *   patch:
 *     summary: Approve Transaction
 *     tags:
 *       - Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction approved successfully
 */
router.patch(
    "/:transactionId/approve",
    checkPermission("TRANSACTION:APPROVE"),
    TransactionController.approveTransaction
);


/**
 * @openapi
 * /api/transactions/{transactionId}/reject:
 *   patch:
 *     summary: Reject Transaction
 *     tags:
 *       - Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remarks:
 *                 type: string
 *
 *     responses:
 *       200:
 *         description: Transaction rejected successfully
 */
router.patch(
    "/:transactionId/reject",
    checkPermission("TRANSACTION:APPROVE"),
    TransactionController.rejectTransaction
);

export default router;