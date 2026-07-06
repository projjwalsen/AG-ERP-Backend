import { Router } from "express";
import * as SalesController from "./sales.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);


/**
 * @openapi
 * /api/sales/create:
 *   post:
 *     summary: Create Sale
 *     tags:
 *       - Sales
 *     security:
 *       - cookieAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             required:
 *               - agencyId
 *               - branchId
 *               - invoiceNo
 *               - invoiceDate
 *               - items
 *
 *             properties:
 *
 *               agencyId:
 *                 type: string
 *                 example: clx_customer_001
 *
 *               branchId:
 *                 type: string
 *                 example: clx_branch_001
 *
 *               invoiceNo:
 *                 type: string
 *                 example: SALE-2026-0001
 *
 *               invoiceDate:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-07-06T00:00:00.000Z
 *
 *               otherReference:
 *                 type: string
 *                 example: REF-001
 *
 *               remarks:
 *                 type: string
 *                 example: Regular customer order
 *
 *               roundOffAmount:
 *                 type: number
 *                 example: -0.35
 *
 *               transport:
 *                 type: object
 *
 *                 properties:
 *
 *                   purchaseOrderNo:
 *                     type: string
 *                     example: PO-001
 *
 *                   purchaseOrderDate:
 *                     type: string
 *                     format: date-time
 *
 *                   receiptNoteNo:
 *                     type: string
 *                     example: RN-001
 *
 *                   receiptNoteDate:
 *                     type: string
 *                     format: date-time
 *
 *                   lrNo:
 *                     type: string
 *                     example: LR45879
 *
 *                   dispatchThrough:
 *                     type: string
 *                     example: Road Transport
 *
 *                   destination:
 *                     type: string
 *                     example: Pune Warehouse
 *
 *                   vehicleOrFlightNo:
 *                     type: string
 *                     example: MH12AB1234
 *
 *                   portOfLoading:
 *                     type: string
 *                     example: Mumbai
 *
 *                   portOfDischarge:
 *                     type: string
 *                     example: Chennai
 *
 *                   countryTo:
 *                     type: string
 *                     example: India
 *
 *                   billOfEntryNo:
 *                     type: string
 *                     example: BOE-001
 *
 *                   billOfEntryDate:
 *                     type: string
 *                     format: date-time
 *
 *                   portCode:
 *                     type: string
 *                     example: INMUM1
 *
 *               items:
 *                 type: array
 *
 *                 items:
 *                   type: object
 *
 *                   required:
 *                     - productId
 *                     - quantity
 *                     - unit
 *                     - salePrice
 *                     - batches
 *
 *                   properties:
 *
 *                     productId:
 *                       type: string
 *                       example: clx_product_001
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
 *                     salePrice:
 *                       type: number
 *                       example: 125.50
 *
 *                     taxableAmount:
 *                       type: number
 *                       example: 62750
 *
 *                     cgst:
 *                       type: number
 *                       example: 5647.5
 *
 *                     sgst:
 *                       type: number
 *                       example: 5647.5
 *
 *                     igst:
 *                       type: number
 *                       example: 0
 *
 *                     total:
 *                       type: number
 *                       example: 74045
 *
 *                     batches:
 *                       type: array
 *
 *                       description: FIFO batch allocations used for this sale item.
 *
 *                       items:
 *                         type: object
 *
 *                         required:
 *                           - batchId
 *                           - quantity
 *
 *                         properties:
 *
 *                           batchId:
 *                             type: string
 *                             example: clx_batch_001
 *
 *                           quantity:
 *                             type: number
 *                             example: 250
 *
 *     responses:
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
 *       404:
 *         description: Customer, Branch or Product not found
 *
 *       409:
 *         description: Insufficient inventory or duplicate invoice
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