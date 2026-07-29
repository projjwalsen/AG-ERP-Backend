import { Router } from "express";
import * as productController from "./product.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * tags:
 *   name: Products
 *   description: Product Management APIs
*/

/**
 * @openapi
 * /api/products/create:
 *   post:
 *     summary: Create Product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sku
 *               - name
 *               - category
 *               - baseUnit
 *               - operationalUnit
 *               - sellPricePerUnit
 *             properties:
 *               sku:
 *                 type: string
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *               productType:
 *                 type: string
 *                 enum:
 *                  - PURCHASED
 *                  - MANUFACTURED
 *                  - BOTH
 *               description:
 *                 type: string
 *               disclaimer:
 *                 type: string
 *               hsnNo:
 *                 type: string
 *               applicableGST:
 *                 type: number
 *               baseUnit:
 *                 type: string
 *                 enum:
 *                   - KG
 *                   - LTR
 *                   - MT
 *               operationalUnit:
 *                 type: string
 *                 enum:
 *                   - KG
 *                   - LTR
 *                   - MT
 *               density:
 *                 type: number
 *               minimumStockKG:
 *                 type: number
 *               sellPricePerUnit:
 *                 type: number
 *               recipe:
 *                 type: object
 *                 description: Required when productType is MANUFACTURED or BOTH
 *                 properties:
 *                   outputQuantity:
 *                     type: number
 *                   outputUnit:
 *                     type: string
 *                     enum:
 *                       - KG
 *                       - LTR
 *                       - MT
 *                   remarks:
 *                     type: string
 *                   items:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         productId:
 *                           type: string
 *                         quantity:
 *                           type: number
 *                         unit:
 *                           type: string
 *                           enum:
 *                             - KG
 *                             - LTR
 *                             - MT
 *     responses:
 *       201:
 *         description: Product created successfully
*/


router.post(
    "/create",
    checkPermission("PRODUCT:WRITE"),
    productController.createProduct
)

/**
 * @openapi
 * /api/products/all-list:
 *   get:
 *     summary: Get All Products
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by product name or SKU
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Product list fetched successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Products retrieved successfully
 *               data:
 *                 products: []
 *                 meta:
 *                   total: 100
 *                   page: 1
 *                   limit: 10
 *                   totalPages: 10
 *                   hasNextPage: true
 *                   hasPrevPage: false
 *       401:
 *         description: Unauthorized
 */

router.get(
    "/all-list",
    checkPermission("PRODUCT:VIEW"),
    productController.getAllProducts
)



/**
 * @openapi
 * /api/products/active-list:
 *   get:
 *     summary: Get Active Products Dropdown
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active product dropdown list
*/

router.get(
    "/active-list",
    checkPermission("PRODUCT:VIEW"),
    productController.getActiveProducts
)


/**
 * @openapi
 * /api/products/{productId}:
 *   get:
 *     summary: Get Product By ID
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product fetched successfully
*/

router.get(
    "/:productId",
    checkPermission("PRODUCT:VIEW"),
    productController.getProductById
)


/**
 * @openapi
 * /api/products/update/{productId}:
 *   patch:
 *     summary: Update Product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Product updated successfully
*/

router.patch(
    "/update/:productId",
    checkPermission("PRODUCT:WRITE"),
    productController.updateProduct
)


/**
 * @openapi
 * /api/products/toggle-status/{productId}:
 *   patch:
 *     summary: Toggle Product Status
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Product status updated successfully
*/

router.patch(
    "/toggle-status/:productId",
    checkPermission("PRODUCT:WRITE"),
    productController.toggleProductStatus
)

export default router;
