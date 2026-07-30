import { Router } from "express";

import {
    createPurchaseOrder,
    listPurchaseOrders,
    getPurchaseOrderById,
    approvePurchaseOrder,
    rejectPurchaseOrder,
    getPurchaseInvoiceEntry,
    createPurchaseFromOrder,
    purchaseOrderPdf
} from "./po.controller";

import {
    authMiddleware,
    checkPermission
} from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);

/**
 * ============================================================
 * PURCHASE ORDER
 * ============================================================
 */

/**
 * @openapi
 * /api/purchase-orders/create:
 *   post:
 *     summary: Create Purchase Order
 *     description: Creates a new Purchase Order in PENDING state.
 *     tags:
 *       - Purchase Orders
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agencyId
 *               - branchId
 *               - items
 *             properties:
 *               agencyId:
 *                 type: string
 *                 format: uuid
 *               branchId:
 *                 type: string
 *                 format: uuid
 *               remarks:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - productId
 *                     - quantity
 *                     - purchasePrice
 *                     - unit
 *                   properties:
 *                     productId:
 *                       type: string
 *                       format: uuid
 *                     quantity:
 *                       type: number
 *                     purchasePrice:
 *                       type: number
 *                     unit:
 *                       type: string
 *     responses:
 *       201:
 *         description: Purchase Order created successfully
 */
router.post(
    "/create",
    checkPermission("PURCHASE:WRITE"),
    createPurchaseOrder
);

/**
 * @openapi
 * /api/purchase-orders/list:
 *   get:
 *     summary: List Purchase Orders
 *     description: Returns paginated Purchase Orders.
 *     tags:
 *       - Purchase Orders
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: agencyId
 *         schema:
 *           type: string
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - PENDING
 *             - APPROVED
 *             - REJECTED
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Purchase Orders retrieved successfully
 */
router.get(
    "/list",
    checkPermission("PURCHASE:VIEW"),
    listPurchaseOrders
);

/**
 * ============================================================
 * DETAILS
 * ============================================================
 */

/**
 * @openapi
 * /api/purchase-orders/{purchaseOrderId}:
 *   get:
 *     summary: Get Purchase Order by Id
 *     tags:
 *       - Purchase Orders
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseOrderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Purchase Order retrieved successfully
 */
router.get(
    "/:purchaseOrderId",
    checkPermission("PURCHASE:VIEW"),
    getPurchaseOrderById
);


/**
 * ============================================================
 * APPROVAL
 * ============================================================
 */

/**
 * @openapi
 * /api/purchase-orders/{purchaseOrderId}/approve:
 *   patch:
 *     summary: Approve Purchase Order
 *     tags:
 *       - Purchase Orders
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseOrderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Purchase Order approved successfully
 */
router.patch(
    "/:purchaseOrderId/approve",
    checkPermission("PURCHASE:APPROVE"),
    approvePurchaseOrder
);

/**
 * @openapi
 * /api/purchase-orders/{purchaseOrderId}/reject:
 *   patch:
 *     summary: Reject Purchase Order
 *     tags:
 *       - Purchase Orders
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseOrderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remarks:
 *                 type: string
 *     responses:
 *       200:
 *         description: Purchase Order rejected successfully
 */
router.patch(
    "/:purchaseOrderId/reject",
    checkPermission("PURCHASE:APPROVE"),
    rejectPurchaseOrder
);

/**
 * ============================================================
 * PDF
 * ============================================================
 */

/**
 * @openapi
 * /api/purchase-orders/{purchaseOrderId}/pdf:
 *   get:
 *     summary: View / Download Purchase Order PDF
 *     description: |
 *       Returns the Purchase Order PDF.
 *
 *       By default the PDF is viewed in the browser.
 *
 *       Pass:
 *
 *       download=true
 *
 *       to download the PDF.
 *     tags:
 *       - Purchase Orders
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseOrderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: download
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: Purchase Order PDF
 */
router.get(
    "/:purchaseOrderId/pdf",
    checkPermission("PURCHASE:VIEW"),
    purchaseOrderPdf
);





/**
 * ============================================================
 * PURCHASE INVOICE ENTRY
 * ============================================================
 */

/**
 * @openapi
 * /api/purchase-orders/{purchaseOrderId}/invoice-entry:
 *   get:
 *     summary: Get Purchase Invoice Entry data
 *     description: Populates Purchase Invoice Entry form from an approved Purchase Order.
 *     tags:
 *       - Purchase Orders
 *       - Purchase Invoice Entry
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseOrderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Purchase Invoice Entry retrieved successfully
 */
router.get(
    "/:purchaseOrderId/invoice-entry",
    checkPermission("PURCHASE:VIEW"),
    getPurchaseInvoiceEntry
);

/**
 * @openapi
 * /api/purchase-orders/{purchaseOrderId}/create-invoice:
 *   post:
 *     summary: Create Purchase Invoice from Purchase Order
 *     description: |
 *       Creates the actual Purchase Invoice from an approved Purchase Order.
 *
 *       The Purchase Order determines:
 *       - Agency
 *       - Branch
 *       - Allowed products
 *       - Purchase Order number
 *       - Purchase Order date
 *
 *       During Purchase Invoice Entry:
 *       - Supplier invoice number is required.
 *       - Invoice date can be provided.
 *       - Supplier invoice date can be provided.
 *       - Quantity can be changed from the ordered quantity.
 *       - Purchase price can be changed from the PO price.
 *       - Batch number is provided for the actual received stock.
 *       - Unit is provided for each item.
 *       - Transport and dispatch details can be provided.
 *       - Round-off, remarks and other reference can be provided.
 *
 *       Product restrictions:
 *       - Every PO product must be included.
 *       - Products cannot be removed from the PO during invoice entry.
 *       - Products not present in the Purchase Order cannot be added.
 *
 *       The Purchase is then created through the existing Purchase workflow.
 *
 *     tags:
 *       - Purchase Orders
 *       - Purchase Invoice Entry
 *
 *     security:
 *       - cookieAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: purchaseOrderId
 *         required: true
 *         description: Approved Purchase Order ID
 *         schema:
 *           type: string
 *           format: uuid
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             required:
 *               - invoiceNo
 *               - items
 *
 *             properties:
 *
 *               invoiceNo:
 *                 type: string
 *                 description: Supplier invoice number
 *                 example: INV-2026-00125
 *
 *               invoiceDate:
 *                 type: string
 *                 format: date-time
 *                 description: Purchase invoice date
 *                 example: "2026-07-30T00:00:00.000Z"
 *
 *               supplierInvoiceDate:
 *                 type: string
 *                 format: date-time
 *                 description: Date printed on the supplier invoice
 *                 example: "2026-07-29T00:00:00.000Z"
 *
 *               otherReference:
 *                 type: string
 *                 description: Additional supplier or invoice reference
 *                 example: SUP-REF-10024
 *
 *               remarks:
 *                 type: string
 *                 description: Purchase remarks
 *                 example: Material received against approved PO
 *
 *               roundOffAmount:
 *                 type: number
 *                 format: double
 *                 description: Invoice round-off adjustment
 *                 example: -0.35
 *
 *               transport:
 *                 type: object
 *                 description: Transport, dispatch and import information
 *
 *                 properties:
 *
 *                   termsOfDelivery:
 *                     type: string
 *                     example: Delivered at warehouse
 *
 *                   receiptNoteNo:
 *                     type: string
 *                     example: RN-2026-001
 *
 *                   receiptNoteDate:
 *                     type: string
 *                     format: date-time
 *                     example: "2026-07-30T00:00:00.000Z"
 *
 *                   lrNo:
 *                     type: string
 *                     description: Lorry Receipt / transport reference number
 *                     example: LR-987654
 *
 *                   dispatchThrough:
 *                     type: string
 *                     example: ABC Transport
 *
 *                   destination:
 *                     type: string
 *                     example: Kolkata Warehouse
 *
 *                   vehicleOrFlightNo:
 *                     type: string
 *                     example: WB01AB1234
 *
 *                   portOfLoading:
 *                     type: string
 *                     example: Mumbai Port
 *
 *                   portOfDischarge:
 *                     type: string
 *                     example: Kolkata Port
 *
 *                   countryTo:
 *                     type: string
 *                     example: India
 *
 *                   billOfEntryNo:
 *                     type: string
 *                     example: BOE-2026-00124
 *
 *                   billOfEntryDate:
 *                     type: string
 *                     format: date-time
 *                     example: "2026-07-28T00:00:00.000Z"
 *
 *                   portCode:
 *                     type: string
 *                     example: INCCU1
 *
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 description: |
 *                   Actual received Purchase items.
 *
 *                   productId must belong to the selected Purchase Order.
 *                   Quantity, purchase price and batch number represent the
 *                   actual received goods and may differ from the PO values
 *                   where permitted by the service.
 *
 *                 items:
 *                   type: object
 *
 *                   required:
 *                     - productId
 *                     - batchNo
 *                     - quantity
 *                     - unit
 *                     - purchasePrice
 *
 *                   properties:
 *
 *                     productId:
 *                       type: string
 *                       format: uuid
 *                       description: Product ID from the Purchase Order
 *                       example: 7c1512d5-f28e-4c8f-a11f-3a908a3a7135
 *
 *                     batchNo:
 *                       type: string
 *                       description: Actual received batch number
 *                       example: BATCH-E20-0726
 *
 *                     quantity:
 *                       type: number
 *                       format: double
 *                       minimum: 0.01
 *                       description: Actual received quantity
 *                       example: 200
 *
 *                     unit:
 *                       type: string
 *                       description: Product unit
 *                       example: KG
 *
 *                     purchasePrice:
 *                       type: number
 *                       format: double
 *                       minimum: 0
 *                       description: Actual purchase price per unit
 *                       example: 210
 *
 *
 *     responses:
 *
 *       201:
 *         description: Purchase Invoice created successfully from Purchase Order

 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: User does not have PURCHASE:WRITE permission or branch access
 *
 *       404:
 *         description: Purchase Order not found
 */
router.post(
    "/:purchaseOrderId/create-invoice",
    checkPermission("PURCHASE:CREATE"),
    createPurchaseFromOrder
);

export default router;