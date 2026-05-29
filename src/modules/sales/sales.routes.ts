import { Router } from "express";
import * as SalesController from "./sales.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);


/**
 * @openapi
 * /api/sales/create:
 *   post:
 *     summary: Create sale
 *
 *     tags:
 *       - Sales
 *
 *     security:
 *       - cookieAuth: []
 *
 *     requestBody:
 *       required: true
 *
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             required:
 *               - agencyId
 *               - branchId
 *               - items
 *
 *             properties:
 *
 *               agencyId:
 *                 type: string
 *                 example: clx_agency_001
 *
 *               branchId:
 *                 type: string
 *                 example: clx_branch_001
 *
 *               remarks:
 *                 type: string
 *                 example: Urgent delivery
 *
 *               deliveryNote:
 *                 type: string
 *                 example: Delivered via warehouse truck
 *
 *               suppliersRef:
 *                 type: string
 *                 example: SUP-REF-001
 *
 *               otherReference:
 *                 type: string
 *                 example: Internal Office Ref
 *
 *               buyerOrderNo:
 *                 type: string
 *                 example: BO-2026-001
 *
 *               buyerOrderDate:
 *                 type: string
 *                 format: date
 *                 example: 2026-05-29
 *
 *               despatchDocNo:
 *                 type: string
 *                 example: DESP-4455
 *
 *               despatchDocDate:
 *                 type: string
 *                 format: date
 *                 example: 2026-05-29
 *
 *               despatchThrough:
 *                 type: string
 *                 example: Road Transport
 *
 *               destination:
 *                 type: string
 *                 example: Kolkata Warehouse
 *
 *               items:
 *                 type: array
 *
 *                 items:
 *                   type: object
 *
 *                   required:
 *                     - productId
 *                     - batchId
 *                     - quantity
 *                     - unit
 *
 *                   properties:
 *
 *                     productId:
 *                       type: string
 *                       example: clx_product_001
 *
 *                     batchId:
 *                       type: string
 *                       example: clx_batch_001
 *
 *                     quantity:
 *                       type: number
 *                       example: 500
 *
 *                     unit:
 *                       type: string
 *                       enum:
 *                         - KG
 *                         - LTR
 *                       example: KG
 *
 *     responses:
 *
 *       201:
 *         description: Sale created successfully
 *
 *       400:
 *         description: Invalid request body
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Permission denied
 *
 *       409:
 *         description: Duplicate sale/batch conflict
 */


router.post(
    "/create",
    checkPermission("SALE:WRITE"),
    SalesController.createSale
);


/**
 * @openapi
 * /api/sales/get-all:
 *   get:
 *     tags:
 *       - Sales
 *     summary: Get all sales
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Sales fetched successfully
 */
router.get(
    "/get-all",
    checkPermission("SALE:VIEW"),
    SalesController.getAllSales
);


/**
 * @openapi
 * /api/sales/{saleId}:
 *   get:
 *     tags:
 *       - Sales
 *     summary: Get sale by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: saleId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Sale fetched successfully
 */
router.get(
    "/:saleId",
    checkPermission("SALE:VIEW"),
    SalesController.getSaleById
);


/**
 * @openapi
 * /api/sales/{saleId}/approve:
 *   patch:
 *     tags:
 *       - Sales
 *     summary: Approve sale
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: saleId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Sale approved successfully
 */
router.patch(
    "/:saleId/approve",
    checkPermission("SALE:APPROVE"),
    SalesController.approveSale
);


/**
 * @openapi
 * /api/sales/{saleId}/reject:
 *   patch:
 *     tags:
 *       - Sales
 *     summary: Reject sale
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: saleId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Sale rejected successfully
 */
router.patch(
    "/:saleId/reject",
    checkPermission("SALE:APPROVE"),
    SalesController.rejectSale
);


/**
 * @openapi
 * /api/sales/update/{saleId}:
 *   put:
 *     tags:
 *       - Sales
 *     summary: Update sale
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: saleId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Sale updated successfully
 */
router.put(
    "/update/:saleId",
    checkPermission("SALE:WRITE"),
    SalesController.updateSale
);



/**
 * @openapi
 * /api/sales/invoice/download/{saleId}:
 *   get:
 *     tags:
 *       - Sales
 *     summary: Download sales invoice PDF
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: saleId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Sales invoice downloaded successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *
 *       401:
 *         description: Unauthorized
 *
 *       404:
 *         description: Sale not found
 */


router.get(
    "/invoice/download/:saleId",
    // checkPermission("SALE:VIEW"),
    SalesController.downloadSalesInvoicePdf
)



/**
 * @openapi
 * /api/sales/invoice/preview/{saleId}:
 *   get:
 *     tags:
 *       - Sales
 *     summary: Preview sales invoice PDF
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: saleId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Sales invoice preview generated successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *
 *       401:
 *         description: Unauthorized
 *
 *       404:
 *         description: Sale not found
 */
router.get(
    "/invoice/preview/:saleId",
    // checkPermission("SALE:VIEW"),
    SalesController.previewSalesInvoice
)


export default router;