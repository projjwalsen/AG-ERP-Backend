import { Router } from "express";
import {
    getProductLedgerDetail,
    getProductLedgerFullHistory,
    getProductStock,
    getAllProductLedgers,
} from "./productLedger.controller";
import { authMiddleware } from "../../../core/middleware/auth";


const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/product-ledger:
 *   get:
 *     summary: Get All Product Ledgers
 *     description: Retrieve all product ledgers with pagination, showing stock summary for each product
 *     tags:
 *       - Product Ledger
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of records per page
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by product name or code
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - ACTIVE
 *             - INACTIVE
 *         description: Filter by product status
 *     responses:
 *       200:
 *         description: Product ledgers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     products:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             description: Product ID
 *                           productLedgerId:
 *                             type: string
 *                             description: Product Ledger ID
 *                           name:
 *                             type: string
 *                             description: Product name
 *                           code:
 *                             type: string
 *                             description: Product code
 *                           unit:
 *                             type: string
 *                             enum: [KG, LTR, PIECE]
 *                           globalStockKG:
 *                             type: number
 *                             description: Global stock in KG
 *                           globalStockLTR:
 *                             type: number
 *                             description: Global stock in LTR
 *                           entryCount:
 *                             type: integer
 *                             description: Number of ledger entries
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         pages:
 *                           type: integer
 *       400:
 *         description: Bad request - invalid parameters
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get(
    "/",
    getAllProductLedgers
);

/**
 * @openapi
 * /api/product-ledger/{productId}/detail:
 *   get:
 *     summary: Get Product Ledger Detail
 *     description: Retrieve detailed product ledger with paginated stock movements. Main UI endpoint showing product info, current stock, and recent movements.
 *     tags:
 *       - Product Ledger
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for paginated movements
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of movement records per page
 *       - in: query
 *         name: movementType
 *         schema:
 *           type: string
 *           enum:
 *             - OPENING_BALANCE
 *             - PURCHASE
 *             - SALE
 *             - ADJUSTMENT_IN
 *             - ADJUSTMENT_OUT
 *             - RETURN_IN
 *             - RETURN_OUT
 *             - DAMAGE
 *             - TRANSFER_IN
 *             - TRANSFER_OUT
 *         description: Filter by movement type
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Filter movements by branch
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter movements from start date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter movements until end date
 *     responses:
 *       200:
 *         description: Product ledger detail retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     productLedger:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         productId:
 *                           type: string
 *                         product:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: string
 *                             name:
 *                               type: string
 *                             code:
 *                               type: string
 *                             unit:
 *                               type: string
 *                             description:
 *                               type: string
 *                             hsn:
 *                               type: string
 *                             sac:
 *                               type: string
 *                             gstRate:
 *                               type: number
 *                     stock:
 *                       type: object
 *                       properties:
 *                         globalStockKG:
 *                           type: number
 *                           description: Current global stock in KG
 *                         globalStockLTR:
 *                           type: number
 *                           description: Current global stock in LTR
 *                     analytics:
 *                       type: object
 *                       properties:
 *                         totalMovements:
 *                           type: integer
 *                         purchaseCount:
 *                           type: integer
 *                         saleCount:
 *                           type: integer
 *                         totalInbound:
 *                           type: number
 *                         totalOutbound:
 *                           type: number
 *                     movements:
 *                       type: object
 *                       properties:
 *                         entries:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               movementType:
 *                                 type: string
 *                               action:
 *                                 type: string
 *                               quantityKG:
 *                                 type: number
 *                               quantityLTR:
 *                                 type: number
 *                               unit:
 *                                 type: string
 *                               invoiceNo:
 *                                 type: string
 *                               batchNo:
 *                                 type: string
 *                               branchId:
 *                                 type: string
 *                               entryDate:
 *                                 type: string
 *                                 format: date-time
 *                               remarks:
 *                                 type: string
 *                         pagination:
 *                           type: object
 *                           properties:
 *                             page:
 *                               type: integer
 *                             limit:
 *                               type: integer
 *                             total:
 *                               type: integer
 *                             pages:
 *                               type: integer
 *       404:
 *         description: Product not found
 *       400:
 *         description: Bad request - invalid parameters
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get(
    "/:productId/detail",
    getProductLedgerDetail
);

/**
 * @openapi
 * /api/product-ledger/{productId}/full-history:
 *   get:
 *     summary: Get Product Ledger Full History
 *     description: Retrieve complete audit trail with running balance calculation. Shows all movements with cumulative balance. Not paginated - returns all historical data.
 *     tags:
 *       - Product Ledger
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *       - in: query
 *         name: movementType
 *         schema:
 *           type: string
 *           enum:
 *             - OPENING_BALANCE
 *             - PURCHASE
 *             - SALE
 *             - ADJUSTMENT_IN
 *             - ADJUSTMENT_OUT
 *             - RETURN_IN
 *             - RETURN_OUT
 *             - DAMAGE
 *             - TRANSFER_IN
 *             - TRANSFER_OUT
 *         description: Filter by movement type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter from start date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter until end date
 *       - in: query
 *         name: invoiceNo
 *         schema:
 *           type: string
 *         description: Filter by invoice number
 *     responses:
 *       200:
 *         description: Full product ledger history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     productLedger:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         productId:
 *                           type: string
 *                         product:
 *                           type: object
 *                           properties:
 *                             name:
 *                               type: string
 *                             code:
 *                               type: string
 *                             unit:
 *                               type: string
 *                     history:
 *                       type: array
 *                       description: Complete movement history with running balance
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           movementType:
 *                             type: string
 *                             description: Type of movement (PURCHASE, SALE, etc)
 *                           action:
 *                             type: string
 *                             enum: [DEBIT, CREDIT]
 *                           quantityKG:
 *                             type: number
 *                             description: Quantity moved in KG
 *                           quantityLTR:
 *                             type: number
 *                             description: Quantity moved in LTR
 *                           balanceKG:
 *                             type: number
 *                             description: Running balance in KG after this movement
 *                           balanceLTR:
 *                             type: number
 *                             description: Running balance in LTR after this movement
 *                           invoiceNo:
 *                             type: string
 *                             description: Purchase/Sale invoice number
 *                           batchNo:
 *                             type: string
 *                             description: Batch number
 *                           batchId:
 *                             type: string
 *                             description: Batch ID (for FIFO traceability)
 *                           unitCost:
 *                             type: number
 *                             description: Cost per unit (for purchases)
 *                           totalCost:
 *                             type: number
 *                             description: Total cost (quantity × unitCost)
 *                           branchId:
 *                             type: string
 *                           branch:
 *                             type: object
 *                             properties:
 *                               name:
 *                                 type: string
 *                           entryDate:
 *                             type: string
 *                             format: date-time
 *                           remarks:
 *                             type: string
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalEntries:
 *                           type: integer
 *                           description: Total number of movements
 *                         totalInbound:
 *                           type: number
 *                           description: Total inbound quantity
 *                         totalOutbound:
 *                           type: number
 *                           description: Total outbound quantity
 *                         currentBalance:
 *                           type: number
 *                           description: Current stock balance
 *       404:
 *         description: Product not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get(
    "/:productId/full-history",
    getProductLedgerFullHistory
);


/**
 * @openapi
 * /api/product-ledger/{productId}/stock:
 *   get:
 *     summary: Get Product Global Stock
 *     description: Retrieve current global stock for a specific product across all branches and locations
 *     tags:
 *       - Product Ledger
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product stock retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     product:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         code:
 *                           type: string
 *                         unit:
 *                           type: string
 *                           enum: [KG, LTR, PIECE]
 *                     stock:
 *                       type: object
 *                       properties:
 *                         currentStockKG:
 *                           type: number
 *                           description: Total stock in KG
 *                         currentStockLTR:
 *                           type: number
 *                           description: Total stock in LTR
 *                         lastUpdated:
 *                           type: string
 *                           format: date-time
 *                           description: Last update timestamp
 *       404:
 *         description: Product not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get(
    "/:productId/stock",
    getProductStock
);

export default router;
