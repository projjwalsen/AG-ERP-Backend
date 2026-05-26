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




export default router;