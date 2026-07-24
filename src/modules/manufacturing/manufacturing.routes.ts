import { Router } from "express";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";
import * as controller from "./manufacturing.controller";

const router = Router();
router.use(authMiddleware);

/**
 * @openapi
 * /api/manufacturing/recipes:
 *   post:
 *     tags: [Manufacturing]
 *     summary: Create a manufacturing recipe
 *     description: Creates a draft BOM recipe for an existing manufactured product. Creating a recipe does not create stock or manufacture goods.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [outputProductId, outputQuantity, outputUnit, items]
 *             properties:
 *               outputProductId:
 *                 type: string
 *                 description: Existing product master with productType MANUFACTURED or BOTH
 *               outputQuantity:
 *                 type: number
 *                 format: double
 *                 example: 1
 *               outputUnit:
 *                 type: string
 *                 enum: [KG, LTR]
 *                 example: KG
 *               remarks:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [productId, quantity, unit]
 *                   properties:
 *                     productId:
 *                       type: string
 *                       description: Raw material product ID
 *                     quantity:
 *                       type: number
 *                       format: double
 *                       example: 1
 *                     unit:
 *                       type: string
 *                       enum: [KG, LTR]
 *                       example: KG
 *     responses:
 *       201:
 *         description: Recipe created in DRAFT status
 *       400:
 *         description: Invalid recipe, duplicate item, self-reference, or circular composition
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
router.post("/recipes", checkPermission("PRODUCT:WRITE"), controller.createRecipe);

/**
 * @openapi
 * /api/manufacturing/recipes:
 *   get:
 *     tags: [Manufacturing]
 *     summary: List manufacturing recipes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, APPROVED, LOCKED, REJECTED]
 *         required: false
 *     responses:
 *       200:
 *         description: Recipes retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/recipes", checkPermission("PRODUCT:VIEW"), controller.listRecipes);

/**
 * @openapi
 * /api/manufacturing/recipes/{recipeId}/approve:
 *   patch:
 *     tags: [Manufacturing]
 *     summary: Approve a manufacturing recipe
 *     description: Approves a draft recipe. The previously approved recipe for the same output product is locked.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: recipeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Recipe approved successfully
 *       400:
 *         description: Recipe is not a draft or output product is not manufactured
 *       404:
 *         description: Recipe not found
 */
router.patch("/recipes/:recipeId/approve", checkPermission("PRODUCT:WRITE"), controller.approveRecipe);

/**
 * @openapi
 * /api/manufacturing/recipes/{recipeId}/reject:
 *   patch:
 *     tags: [Manufacturing]
 *     summary: Reject a manufacturing recipe
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: recipeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remarks:
 *                 type: string
 *     responses:
 *       200:
 *         description: Recipe rejected successfully
 *       400:
 *         description: Only draft recipes can be rejected
 */
router.patch("/recipes/:recipeId/reject", checkPermission("PRODUCT:WRITE"), controller.rejectRecipe);

/**
 * @openapi
 * /api/manufacturing/preview:
 *   post:
 *     tags: [Manufacturing]
 *     summary: Preview manufacturing requirements and cost
 *     description: Calculates required raw material quantities, FIFO batch allocations, shortages, and manufacturing cost without changing inventory.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipeId, branchId, outputQuantity]
 *             properties:
 *               recipeId:
 *                 type: string
 *               branchId:
 *                 type: string
 *               outputQuantity:
 *                 type: number
 *                 format: double
 *                 example: 100
 *               remarks:
 *                 type: string
 *     responses:
 *       200:
 *         description: Manufacturing preview generated successfully
 *       400:
 *         description: Recipe is not approved or output quantity is invalid
 *       404:
 *         description: Recipe not found
 */
router.post("/preview", checkPermission("PRODUCT:VIEW"), controller.previewManufacture);

/**
 * @openapi
 * /api/manufacturing/manufactures:
 *   post:
 *     tags: [Manufacturing]
 *     summary: Create a manufacturing document
 *     description: Creates a draft manufacturing document from an approved recipe. No inventory, ledger, or accounting changes occur until approval.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipeId, branchId, outputQuantity]
 *             properties:
 *               recipeId:
 *                 type: string
 *               branchId:
 *                 type: string
 *               outputQuantity:
 *                 type: number
 *                 format: double
 *                 example: 100
 *               remarks:
 *                 type: string
 *     responses:
 *       201:
 *         description: Manufacturing document created in DRAFT status
 *       400:
 *         description: Insufficient stock, invalid quantity, or recipe is not approved
 *       403:
 *         description: Branch access denied
 */
router.post("/manufactures", checkPermission("PRODUCT:WRITE"), controller.createManufacture);

/**
 * @openapi
 * /api/manufacturing/manufactures:
 *   get:
 *     tags: [Manufacturing]
 *     summary: List manufacturing documents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, APPROVED, REJECTED]
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Manufacturing documents retrieved successfully
 */
router.get("/manufactures", checkPermission("PRODUCT:VIEW"), controller.listManufactures);

/**
 * @openapi
 * /api/manufacturing/manufactures/{manufactureId}/approve:
 *   patch:
 *     tags: [Manufacturing]
 *     summary: Approve manufacturing
 *     description: Rechecks FIFO stock inside a transaction, consumes raw materials, creates finished goods inventory, writes product-ledger movements, and creates a balanced accounting voucher.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: manufactureId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Manufacturing approved successfully
 *       400:
 *         description: Insufficient stock or invalid manufacturing document
 *       409:
 *         description: Manufacturing document was already processed or stock changed concurrently
 */
router.patch("/manufactures/:manufactureId/approve", checkPermission("PRODUCT:WRITE"), controller.approveManufacture);

/**
 * @openapi
 * /api/manufacturing/manufactures/{manufactureId}/reject:
 *   patch:
 *     tags: [Manufacturing]
 *     summary: Reject manufacturing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: manufactureId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remarks:
 *                 type: string
 *     responses:
 *       200:
 *         description: Manufacturing rejected successfully
 *       400:
 *         description: Only draft manufacturing documents can be rejected
 */
router.patch("/manufactures/:manufactureId/reject", checkPermission("PRODUCT:WRITE"), controller.rejectManufacture);

export default router;
