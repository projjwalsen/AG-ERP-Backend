import { Router } from "express";
import * as PurchaseController from "./purchase.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);


/**
 * @openapi
 * /api/purchases/create:
 *   post:
 *     summary: Create Purchase
 *     tags:
 *       - Purchases
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
 *                 example: clx_vendor_001
 *
 *               branchId:
 *                 type: string
 *                 example: clx_branch_001
 *
 *               invoiceNo:
 *                 type: string
 *                 example: PUR-2026-0001
 *
 *               invoiceDate:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-07-06T00:00:00.000Z
 *
 *               supplierInvoiceDate:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-07-05T00:00:00.000Z
 *
 *               otherReference:
 *                 type: string
 *                 example: REF-001
 *
 *               remarks:
 *                 type: string
 *                 example: Fresh stock received from supplier.
 *
 *               roundOffAmount:
 *                 type: number
 *                 example: -0.25
 *
 *               transport:
 *                 type: object
 *
 *                 properties:
 *
 *                   purchaseOrderNo:
 *                     type: string
 *                     example: PO-2026-001
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
 *                     example: Blue Dart
 *
 *                   destination:
 *                     type: string
 *                     example: Kolkata Warehouse
 *
 *                   vehicleOrFlightNo:
 *                     type: string
 *                     example: WB12AB1234
 *
 *                   portOfLoading:
 *                     type: string
 *                     example: Mumbai
 *
 *                   portOfDischarge:
 *                     type: string
 *                     example: Kolkata
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
 *                     - batchNo
 *                     - quantity
 *                     - unit
 *                     - purchasePrice
 *
 *                   properties:
 *
 *                     productId:
 *                       type: string
 *                       example: clx_product_001
 *
 *                     batchNo:
 *                       type: string
 *                       description: Unique inventory batch number generated or provided during purchase.
 *                       example: PUR-2026-0001-1
 *
 *                     quantity:
 *                       type: number
 *                       example: 1000
 *
 *                     unit:
 *                       type: string
 *                       enum:
 *                         - KG
 *                         - LTR
 *                       example: KG
 *
 *                     purchasePrice:
 *                       type: number
 *                       example: 89.50
 *
 *     responses:
 *       201:
 *         description: Purchase created successfully
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
 *         description: Vendor, Branch or Product not found
 *
 *       409:
 *         description: Duplicate invoice number or inventory batch already exists
 */
router.post(
    "/create",
    checkPermission("PURCHASE:WRITE"),
    PurchaseController.createPurchase
);


/**
 * @openapi
 * /api/purchases/get-all:
 *   get:
 *     tags:
 *       - Purchases
 *     summary: Get all purchases
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
 *         description: Purchases fetched successfully
 */
router.get(
    "/get-all",
    checkPermission("PURCHASE:VIEW"),
    PurchaseController.getAllPurchases
)



/**
 * @openapi
 * /api/purchases/{purchaseId}:
 *   get:
 *     tags:
 *       - Purchases
 *     summary: Get purchase by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Purchase fetched successfully
 */
router.get(
    "/:purchaseId",
    checkPermission("PURCHASE:VIEW"),
    PurchaseController.getPurchaseById
);


/**
 * @openapi
 * /api/purchases/{purchaseId}/approve:
 *   patch:
 *     tags:
 *       - Purchases
 *     summary: Approve purchase
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Purchase approved successfully
 */
router.patch(
    "/:purchaseId/approve",
    checkPermission("PURCHASE:APPROVE"),
    PurchaseController.approvePurchase
);


/**
 * @openapi
 * /api/purchases/{purchaseId}/reject:
 *   patch:
 *     tags:
 *       - Purchases
 *     summary: Reject purchase
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Purchase rejected successfully
 */
router.patch(
    "/:purchaseId/reject",
    checkPermission("PURCHASE:APPROVE"),
    PurchaseController.rejectPurchase
);


/**
 * @openapi
 * /api/purchases/update/{purchaseId}:
 *   put:
 *     tags:
 *       - Purchases
 *     summary: Update purchase
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purchaseId
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: Purchase updated successfully
 */
router.put(
    "/update/:purchaseId",
    checkPermission("PURCHASE:WRITE"),
    PurchaseController.updatePurchase
);



export default router;