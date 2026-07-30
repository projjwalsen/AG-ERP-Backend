import { Router } from "express";
import * as controller from "./debitCreditNote.controller";
import {
    authMiddleware,
    checkPermission
} from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);


/**
 * ============================================================
 * GET INVOICES FOR DEBIT / CREDIT NOTE
 * ============================================================
 */

/**
 * @openapi
 * /api/debit-credit-notes/invoices:
 *   get:
 *     summary: List Sale/Purchase invoices for Debit/Credit Note selection
 *     description: >
 *       Returns approved Sale or Purchase invoices for the selected agency.
 *       Invoices are returned irrespective of whether they are PAID,
 *       PARTIALLY PAID, or UNPAID.
 *     tags:
 *       - Debit Credit Notes
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: agencyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agency whose invoices should be returned
 *
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional branch filter
 *
 *       - in: query
 *         name: sourceType
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - SALE
 *             - PURCHASE
 *         description: Determines whether Sale or Purchase invoices are returned
 *
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *         description: Search invoices by invoice number or supported invoice fields
 *
 *     responses:
 *       200:
 *         description: Invoices retrieved successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
    "/invoices",
    checkPermission("SALE:VIEW"),
    controller.getAgencyInvoices
);


/**
 * ============================================================
 * CREATE DEBIT / CREDIT NOTE
 * ============================================================
 */

/**
 * @openapi
 * /api/debit-credit-notes:
 *   post:
 *     summary: Create Debit/Credit Note draft
 *     description: >
 *       Creates a Debit or Credit Note against an existing Sale or Purchase
 *       invoice. Creating the draft does not modify the original invoice
 *       grand total and does not post accounting effects until approval.
 *     tags:
 *       - Debit Credit Notes
 *     security:
 *       - cookieAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - sourceType
 *               - agencyId
 *               - branchId
 *               - particulars
 *
 *             properties:
 *
 *               type:
 *                 type: string
 *                 enum:
 *                   - DEBIT_NOTE
 *                   - CREDIT_NOTE
 *                 example: DEBIT_NOTE
 *
 *               sourceType:
 *                 type: string
 *                 enum:
 *                   - SALE
 *                   - PURCHASE
 *                 example: PURCHASE
 *
 *               agencyId:
 *                 type: string
 *                 example: 550e8400-e29b-41d4-a716-446655440000
 *
 *               branchId:
 *                 type: string
 *                 example: 083b75b6-b332-4a0a-8355-3f7bccebbd64
 *
 *               saleId:
 *                 type: string
 *                 nullable: true
 *                 description: Required when sourceType is SALE
 *
 *               purchaseId:
 *                 type: string
 *                 nullable: true
 *                 description: Required when sourceType is PURCHASE
 *
 *               noteDate:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-07-30T10:00:00.000Z
 *
 *               narration:
 *                 type: string
 *                 example: Adjustment against transportation charges
 *
 *               particulars:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - description
 *                     - amount
 *                   properties:
 *                     description:
 *                       type: string
 *                       example: Additional Transportation Cost
 *                     amount:
 *                       type: number
 *                       format: double
 *                       minimum: 0.01
 *                       example: 3000
 *
 *           examples:
 *
 *             purchaseDebitNote:
 *               summary: Debit Note against Purchase
 *               value:
 *                 type: DEBIT_NOTE
 *                 sourceType: PURCHASE
 *                 agencyId: 550e8400-e29b-41d4-a716-446655440000
 *                 branchId: 083b75b6-b332-4a0a-8355-3f7bccebbd64
 *                 purchaseId: 1fca2345-1234-4567-8901-123456789abc
 *                 noteDate: 2026-07-30T10:00:00.000Z
 *                 narration: Damaged goods adjustment
 *                 particulars:
 *                   - description: Damaged Goods
 *                     amount: 1000
 *                   - description: Quantity Shortage
 *                     amount: 500
 *
 *             saleCreditNote:
 *               summary: Credit Note against Sale
 *               value:
 *                 type: CREDIT_NOTE
 *                 sourceType: SALE
 *                 agencyId: 550e8400-e29b-41d4-a716-446655440000
 *                 branchId: 083b75b6-b332-4a0a-8355-3f7bccebbd64
 *                 saleId: 2fca2345-1234-4567-8901-123456789abc
 *                 noteDate: 2026-07-30T10:00:00.000Z
 *                 narration: Post invoice discount
 *                 particulars:
 *                   - description: Discount Adjustment
 *                     amount: 2000
 *
 *     responses:
 *       201:
 *         description: Debit/Credit Note draft created successfully
 *       400:
 *         description: Invalid payload or invoice/agency mismatch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Invoice or agency not found
 */
router.post(
    "/",
    checkPermission("SALE:WRITE"),
    controller.createNote
);


/**
 * ============================================================
 * LIST DEBIT / CREDIT NOTES
 * ============================================================
 */

/**
 * @openapi
 * /api/debit-credit-notes:
 *   get:
 *     summary: List Debit/Credit Notes
 *     description: >
 *       Returns paginated Debit and Credit Notes with optional filters
 *       for agency, branch, invoice, source type, note type, and status.
 *     tags:
 *       - Debit Credit Notes
 *     security:
 *       - cookieAuth: []
 *
 *     parameters:
 *
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 10
 *
 *       - in: query
 *         name: agencyId
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: saleId
 *         schema:
 *           type: string
 *         description: Filter notes belonging to a Sale invoice
 *
 *       - in: query
 *         name: purchaseId
 *         schema:
 *           type: string
 *         description: Filter notes belonging to a Purchase invoice
 *
 *       - in: query
 *         name: sourceType
 *         schema:
 *           type: string
 *           enum:
 *             - SALE
 *             - PURCHASE
 *
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum:
 *             - DEBIT_NOTE
 *             - CREDIT_NOTE
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
 *     responses:
 *       200:
 *         description: Debit/Credit Notes retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
    "/",
    checkPermission("SALE:VIEW"),
    controller.listNotes
);


/**
 * ============================================================
 * GET NOTE BY ID
 * ============================================================
 */

/**
 * @openapi
 * /api/debit-credit-notes/{noteId}:
 *   get:
 *     summary: Get Debit/Credit Note by ID
 *     tags:
 *       - Debit Credit Notes
 *     security:
 *       - cookieAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Debit/Credit Note retrieved successfully
 *       404:
 *         description: Debit/Credit Note not found
 */
router.get(
    "/:noteId",
    checkPermission("SALE:VIEW"),
    controller.getNoteById
);



/**
 * ============================================================
 * APPROVE NOTE
 * ============================================================
 */

/**
 * @openapi
 * /api/debit-credit-notes/{noteId}/approve:
 *   patch:
 *     summary: Approve Debit/Credit Note
 *     description: >
 *       Approves the note and posts its accounting effects.
 *       The original Sale/Purchase grandTotal remains unchanged.
 *       The approved note affects the settlement position,
 *       AgencyOutstanding and agency ledger/accounting records
 *       according to the Debit/Credit Note type and source.
 *     tags:
 *       - Debit Credit Notes
 *     security:
 *       - cookieAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Debit/Credit Note approved successfully
 *       400:
 *         description: Note cannot be approved
 *       404:
 *         description: Debit/Credit Note not found
 */
router.patch(
    "/:noteId/approve",
    checkPermission("SALE:APPROVE"),
    controller.approveNote
);


/**
 * ============================================================
 * REJECT NOTE
 * ============================================================
 */

/**
 * @openapi
 * /api/debit-credit-notes/{noteId}/reject:
 *   patch:
 *     summary: Reject Debit/Credit Note
 *     description: Rejects a pending Debit/Credit Note without posting accounting effects.
 *     tags:
 *       - Debit Credit Notes
 *     security:
 *       - cookieAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remarks:
 *                 type: string
 *                 example: Adjustment amount requires correction
 *
 *     responses:
 *       200:
 *         description: Debit/Credit Note rejected successfully
 *       400:
 *         description: Note cannot be rejected
 *       404:
 *         description: Debit/Credit Note not found
 */
router.patch(
    "/:noteId/reject",
    checkPermission("SALE:APPROVE"),
    controller.rejectNote
);

export default router;