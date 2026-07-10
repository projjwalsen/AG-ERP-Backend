import { Router } from "express";
import * as TransactionController from "./transac.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);


/**
 * @openapi
 * /api/transactions/invoices:
 *   get:
 *     summary: Get Outstanding Invoices for Invoice Settlement
 *     description: |
 *       Returns all outstanding invoices for the selected agency and branch.
 *       Used by the Invoice-to-Invoice settlement flow to populate the invoice selection dropdown.
 *
 *       - **INWARD** → Returns approved Sales invoices with pending outstanding.
 *       - **OUTWARD** → Returns approved Purchase invoices with pending outstanding.
 *
 *     tags:
 *       - Transactions
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Branch ID (required only for users having ALL branch access)
 *
 *       - in: query
 *         name: agencyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agency whose invoices should be fetched
 *
 *       - in: query
 *         name: direction
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - INWARD
 *             - OUTWARD
 *         description: |
 *           INWARD returns Sales invoices.
 *           OUTWARD returns Purchase invoices.
 *
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *         description: Search by invoice number
 *
 *     responses:
 *       200:
 *         description: Outstanding invoices fetched successfully
 *
 *       400:
 *         description: Invalid request
 *
 *       401:
 *         description: Unauthorized
 *
 *       404:
 *         description: Agency or Branch not found
 */

router.get(
    "/invoices",
    TransactionController.getOutstandingInvoices
);





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
 *               - settlementType
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
 *               settlementType:
 *                 type: string
 *                 enum:
 *                   - INVOICE_TO_INVOICE
 *                   - LUMPSUM
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
 *         name: settlementType
 *         schema:
 *           type: string
 *           enum:
 *             - INVOICE_TO_INVOICE
 *             - LUMPSUM
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
 *               settlementType:
 *                 type: string
 *                 enum:
 *                   - INVOICE_TO_INVOICE
 *                   - LUMPSUM
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



/**
 * @openapi
 * /api/transactions/preview-fifo:
 *   post:
 *     summary: Preview FIFO Invoice Allocation
 *     description: |
 *       Generates a FIFO allocation preview for a Lumpsum Settlement without creating any transaction.
 *
 *       The API simulates exactly how invoices will be settled on transaction approval.
 *
 *       - Oldest invoices are settled first (FIFO)
 *       - Fully settled invoices are returned
 *       - Partially settled invoice is returned
 *       - Remaining outstanding is calculated
 *       - Preview is generated for both the Primary Agency and Third Party Agency
 *
 *       This endpoint is intended to be called whenever the user enters a lump sum amount.
 *
 *     tags:
 *       - Transactions
 *
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - primaryAgencyId
 *               - thirdPartyAgencyId
 *               - branchId
 *               - direction
 *               - amount
 *             properties:
 *               primaryAgencyId:
 *                 type: string
 *                 example: "agency_primary_id"
 *
 *               thirdPartyAgencyId:
 *                 type: string
 *                 example: "agency_third_party_id"
 *
 *               branchId:
 *                 type: string
 *                 example: "branch_id"
 *
 *               direction:
 *                 type: string
 *                 enum:
 *                   - INWARD
 *                   - OUTWARD
 *                 example: INWARD
 *
 *               amount:
 *                 type: number
 *                 example: 10000
 *
 *     responses:
 *       200:
 *         description: FIFO allocation preview generated successfully
 *
 *       400:
 *         description: Invalid request or insufficient outstanding
 *
 *       401:
 *         description: Unauthorized
 */

router.post(
    "/preview-fifo",
    TransactionController.previewFIFOAllocation
);

export default router;