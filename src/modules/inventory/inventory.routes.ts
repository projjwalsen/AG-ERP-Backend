import { Router } from "express";
import * as InventoryController from "./inventory.controller";
import { authMiddleware } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);


/**
 * @openapi
 * /api/inventory/batches:
 *   get:
 *     tags:
 *       - Inventory
 *     summary: Get available inventory batches
 *     description: Fetch batches by optional branch, product and active status filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         required: false
 *         description: Branch ID
 *
 *       - in: query
 *         name: productId
 *         schema:
 *           type: string
 *         required: false
 *         description: Product ID
 *
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         required: false
 *         description: Filter active/inactive batches
 *
 *     responses:
 *       200:
 *         description: Batches fetched successfully
 */
router.get(
    "/batches",
    InventoryController.getAvailableBatches
);


/**
 * @openapi
 * /api/inventory/batches/all:
 *   get:
 *     tags:
 *       - Inventory
 *     summary: Get all inventory batches
 *     description: Paginated inventory batch listing with filters
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
 *         name: branchId
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: productId
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *
 *     responses:
 *       200:
 *         description: Inventory batches fetched successfully
 */

router.get(
    "/batches/all",
    InventoryController.getAllInventoryBatches
);



/**
 * @openapi
 * /api/inventory/summary:
 *   get:
 *     summary: Get aggregated branch inventory summary
 *     description: |
 *       Returns live aggregated inventory stock
 *       branch-wise and product-wise.
 *
 *       Used for:
 *       - Inventory dashboard
 *       - Live stock monitoring
 *       - Low stock alerts
 *
 *       NOTE:
 *       This endpoint returns aggregated inventory,
 *       not batch-wise stock.
 *
 *     tags:
 *       - Inventory
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           example: 1
 *         description: Page number
 *
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           example: 20
 *         description: Records per page
 *
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by branch ID
 *
 *       - in: query
 *         name: productId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by product ID
 *
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by branch name, product name or SKU
 *
 *     responses:
 *       200:
 *         description: Inventory summary retrieved successfully
 *
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *
 *                 message:
 *                   type: string
 *                   example: Branch inventory summary retrieved successfully
 *
 *                 data:
 *                   type: object
 *
 *                   properties:
 *                     data:
 *                       type: array
 *
 *                       items:
 *                         type: object
 *
 *                         properties:
 *                           branchId:
 *                             type: string
 *
 *                           productId:
 *                             type: string
 *
 *                           currentStockKG:
 *                             type: number
 *                             example: 400
 *
 *                           currentStockLTR:
 *                             type: number
 *                             example: 476.19
 *
 *                           status:
 *                             type: string
 *                             example: IN_STOCK
 *
 *                           branch:
 *                             type: object
 *                             properties:
 *                               name:
 *                                 type: string
 *                                 example: Kalyani Depot
 *
 *                               code:
 *                                 type: string
 *                                 example: KALYANI
 *
 *                           product:
 *                             type: object
 *                             properties:
 *                               name:
 *                                 type: string
 *                                 example: Industrial Diesel Fuel
 *
 *                               sku:
 *                                 type: string
 *                                 example: IND-DIESEL-FUEL
 *
 *                     meta:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                           example: 10
 *
 *                         page:
 *                           type: integer
 *                           example: 1
 *
 *                         totalPages:
 *                           type: integer
 *                           example: 1
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal server error
 */

router.get(
    "/summary",
    InventoryController.getBranchInventorySummary
);



/**
 * @openapi
 * /api/inventory/product/{productId}/batch-history:
 *   get:
 *     tags:
 *       - Inventory
 *     summary: Get product batch history
 *     description: Returns all batches of a product grouped by branch with current stock availability.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *
 *     responses:
 *       200:
 *         description: Product batch history retrieved successfully
 *
 *       400:
 *         description: Product ID is required
 *
 *       401:
 *         description: Unauthorized
 *
 *       404:
 *         description: Product not found
 */


router.get(
    "/product/:productId/batch-history",
    InventoryController.getProductBatchWiseHistory
)


export default router;