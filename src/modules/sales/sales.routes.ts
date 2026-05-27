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
 *     tags: [Sales]
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
 *                       enum: [KG, LTR]
 *                       example: KG
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



export default router;