import { prisma } from "../../../config/db";
import { ApiError } from "../../../core/middleware/errorHandler";
import { 
  Prisma, 
  ProductMovementType, 
  ProductMovementDirection,
  ProductUnit 
} from "@prisma/client";

export class ProductLedgerService {

    /**
     * ========================================
     * GET OR CREATE PRODUCT LEDGER
     * ========================================
     * GLOBAL - One ledger per product
     * Auto-creates if not exists
     * Call this at start of approvePurchase/approveSale
     */
    static async getOrCreateProductLedger(
        productId: string,
        tx?: Prisma.TransactionClient
    ) {
        if (!productId) {
            throw new ApiError("Product ID required", 400);
        }

        const client = tx || prisma;

        // Get product - need all details for denormalization
        const product = await client.product.findUnique({
            where: { id: productId }
        });

        if (!product) {
            throw new ApiError("Product not found", 404);
        }

        // Check if ledger exists
        let productLedger = await client.productLedger.findUnique({
            where: { productId }
        });

        // If exists and active, return it
        if (productLedger) {
            if (!productLedger.isActive) {
                throw new ApiError("Product Ledger is inactive", 400);
            }
            return productLedger;
        }

        // Generate code
        const code = `PROD-${productId.substring(0, 8)}`;

        // Create new product ledger
        try {
            productLedger = await client.productLedger.create({
                data: {
                    productId,
                    code,
                    currentStockKG: 0,
                    currentStockLTR: 0,
                    isActive: true,
                }
            });

            return productLedger;
        } catch {
            // Handle race condition: another process created it
            const existing = await client.productLedger.findUnique({
                where: { productId }
            });

            if (existing) {
                return existing;
            }

            throw new ApiError("Unable to create product ledger", 500);
        }
    }

    /**
     * ========================================
     * CREATE OPENING BALANCE MOVEMENT
     * ========================================
     * Used when creating a product with initial stock
     * First entry in product ledger history
     */
    static async createOpeningBalanceMovement(
        tx: Prisma.TransactionClient,
        payload: {
            productLedgerId: string;
            quantity: number;
            unit: ProductUnit;
            remarks?: string;
            createdById?: string;
        }
    ) {
        if (payload.quantity <= 0) {
            throw new ApiError("Opening balance quantity must be greater than 0", 400);
        }

        return this.addMovement(tx, {
            productLedgerId: payload.productLedgerId,
            movementType: ProductMovementType.OPENING_BALANCE,
            direction: ProductMovementDirection.INBOUND,
            quantityKG: payload.quantity,
            quantityLTR: undefined,
            unit: payload.unit,
            branchId: undefined,
            agencyId: undefined,
            purchaseId: undefined,
            saleId: undefined,
            batchId: undefined,
            batchNo: undefined,
            invoiceNo: undefined,
            unitCost: undefined,
            entryDate: new Date(),
            remarks: payload.remarks || "Opening balance",
            createdById: payload.createdById,
        });
    }

    /**
     * ========================================
     * CREATE PURCHASE MOVEMENT
     * ========================================
     * High-level method for purchase stock entry
     * Automatically calculates costs
     * Called from: PurchaseService.approvePurchase()
     */
    static async createPurchaseMovement(
        tx: Prisma.TransactionClient,
        payload: {
            productLedgerId: string;
            purchase: any;
            purchaseItem: any;
            batchId: string;
            batchNo: string;
        }
    ) {
        if (!payload.productLedgerId || !payload.purchase || !payload.purchaseItem) {
            throw new ApiError("Missing required purchase movement data", 400);
        }

        const { purchase, purchaseItem } = payload;

        return this.addMovement(tx, {
            productLedgerId: payload.productLedgerId,
            movementType: ProductMovementType.PURCHASE,
            direction: ProductMovementDirection.INBOUND,
            quantityKG: Number(purchaseItem.quantity),
            quantityLTR: undefined,
            unit: purchaseItem.unit,
            branchId: purchase.branchId,
            agencyId: purchase.agencyId,
            purchaseId: purchase.id,
            saleId: undefined,
            batchId: payload.batchId,
            batchNo: payload.batchNo,
            invoiceNo: purchase.invoiceNo,
            unitCost: Number(purchaseItem.purchasePrice),
            entryDate: new Date(),
            remarks: `Purchase from invoice ${purchase.invoiceNo}`,
            createdById: purchase.createdById,
        });
    }

    /**
     * ========================================
     * CREATE SALE MOVEMENT
     * ========================================
     * High-level method for sale stock deduction
     * Batch ID is MANDATORY (FIFO traceability)
     * Called from: SalesService.approveSale()
     */
    static async createSaleMovement(
        tx: Prisma.TransactionClient,
        payload: {
            productLedgerId: string;
            sale: any;
            saleItem: any;
            batchId: string;
            batchNo: string;
        }
    ) {
        if (!payload.productLedgerId || !payload.sale || !payload.saleItem) {
            throw new ApiError("Missing required sale movement data", 400);
        }

        if (!payload.batchId || !payload.batchNo) {
            throw new ApiError("Batch ID and Batch No are required for sale movements (FIFO traceability)", 400);
        }

        const { sale, saleItem } = payload;

        return this.addMovement(tx, {
            productLedgerId: payload.productLedgerId,
            movementType: ProductMovementType.SALE,
            direction: ProductMovementDirection.OUTBOUND,
            quantityKG: Number(saleItem.quantity),
            quantityLTR: undefined,
            unit: saleItem.unit,
            branchId: sale.branchId,
            agencyId: sale.agencyId,
            purchaseId: undefined,
            saleId: sale.id,
            batchId: payload.batchId,
            batchNo: payload.batchNo,
            invoiceNo: sale.invoiceNo,
            unitCost: undefined,
            entryDate: sale.invoiceDate || new Date(),
            remarks: `Sale to invoice ${sale.invoiceNo}`,
            createdById: sale.createdById,
        });
    }

    /**
     * ========================================
     * GENERIC ADD MOVEMENT (PRIVATE)
     * ========================================
     * Creates IMMUTABLE ledger entry (no race condition)
     * Does NOT calculate running balance on write
     * Running balance = calculated on-demand for reports
     * 
     * Why: Race condition prevention
     * - Concurrent purchases both see same last balance
     * - Both calculate from same base
     * - One overwrites the other
     * 
     * Solution: Inventory table = source of truth for stock
     * ProductLedgerEntry = immutable history
     */
    private static async addMovement(
        tx: Prisma.TransactionClient,
        payload: {
            productLedgerId: string;
            movementType: ProductMovementType;
            direction: ProductMovementDirection;
            quantityKG: number;
            quantityLTR?: number;
            unit: ProductUnit;
            branchId?: string;
            agencyId?: string;
            purchaseId?: string;
            saleId?: string;
            batchId?: string;
            batchNo?: string;
            invoiceNo?: string;
            unitCost?: number;
            entryDate: Date;
            remarks?: string;
            createdById?: string;
        }
    ) {
        const {
            productLedgerId,
            movementType,
            direction,
            quantityKG,
            quantityLTR = 0,
        } = payload;

        // Validate
        if (!productLedgerId || quantityKG <= 0) {
            throw new ApiError("Invalid movement data", 400);
        }

        // Create immutable entry - NO balance fields
        // Balance is history archive only, not for paginated views
        const entry = await tx.productLedgerEntry.create({
            data: {
                productLedgerId,
                movementType,
                direction,
                quantityKG,
                quantityLTR: quantityLTR || null,
                unit: payload.unit,
                branchId: payload.branchId || null,
                agencyId: payload.agencyId || null,
                purchaseId: payload.purchaseId || null,
                saleId: payload.saleId || null,
                batchId: payload.batchId || null,
                batchNo: payload.batchNo || null,
                invoiceNo: payload.invoiceNo || null,
                unitCost: payload.unitCost || null,
                totalCost: payload.unitCost ? (quantityKG * payload.unitCost) : null,
                entryDate: payload.entryDate,
                remarks: payload.remarks || null,
                createdById: payload.createdById || null,
            },
            include: {
                branch: true,
                agency: true,
                purchase: true,
                sale: true,
                batch: true,
                user: true,
            }
        });

        return entry;
    }

    /**
     * ========================================
     * CALCULATE RUNNING BALANCE (PRIVATE)
     * ========================================
     * WARNING: Only use when you have COMPLETE history (all entries)
     * DO NOT use for paginated results - creates wrong balances
     * 
     * Balance continues from where list ends
     * Page 1 balance 100 -> Page 2 starts 0 (WRONG!)
     * 
     * Solution: Use this only for complete non-paginated exports
     * For paginated views: Simply don't show running balance (like all ERPs)
     */
    private static calculateRunningBalances(
        entries: any[]
    ): any[] {
        let balanceKG = 0;
        let balanceLTR = 0;

        return entries.map((entry) => {
            const quantityKG = Number(entry.quantityKG);
            const quantityLTR = entry.quantityLTR ? Number(entry.quantityLTR) : 0;

            if (entry.direction === ProductMovementDirection.INBOUND) {
                balanceKG += quantityKG;
                balanceLTR += quantityLTR;
            } else {
                balanceKG -= quantityKG;
                balanceLTR -= quantityLTR;
            }

            return {
                ...entry,
                balanceKG,
                balanceLTR,
            };
        });
    }

    /**
     * ========================================
     * GET GLOBAL PRODUCT STOCK (OPTIMIZED)
     * ========================================
     * Uses Prisma aggregation - NO N+1 problem
     * Single query with _sum aggregation
     */
    static async getGlobalProductStock(productId: string) {
        const result = await prisma.inventory.aggregate({
            where: { productId },
            _sum: {
                currentStockKG: true,
                currentStockLTR: true,
            }
        });

        return {
            productId,
            globalStockKG: Number(result._sum.currentStockKG || 0),
            globalStockLTR: Number(result._sum.currentStockLTR || 0),
        };
    }

    /**
     * ========================================
     * GET PRODUCT LEDGER DETAIL
     * ========================================
     * MAIN ENDPOINT - Complete product overview
     * Includes:
     * - Product metadata
     * - Current stock (global + by branch)
     * - Analytics (sales, purchases, turnover)
     * - Paginated movement history
     */
    static async getProductLedgerDetail(
        productId: string,
        query?: {
            page?: number;
            limit?: number;
            movementType?: ProductMovementType;
            branchId?: string;
        },
        tx?: Prisma.TransactionClient
    ) {
        const client = tx || prisma;
        const page = query?.page || 1;
        const limit = query?.limit || 20;
        const skip = (page - 1) * limit;

        const ledger = await client.productLedger.findUnique({
            where: { productId },
            include: { product: true }
        });

        if (!ledger) {
            throw new ApiError("Product Ledger not found", 404);
        }

        // Get global stock from Inventory aggregation
        const globalStock = await this.getGlobalProductStock(productId);

        // Get branch-wise stock
        const branchWiseStock = await this.getBranchWiseStock(productId);

        // Get analytics
        const analytics = await this.getProductAnalytics(productId);

        // Get paginated movement history
        const where: any = {
            productLedgerId: ledger.id,
            ...(query?.movementType && { movementType: query.movementType }),
            ...(query?.branchId && { branchId: query.branchId }),
        };

        const [movements, totalMovements] = await Promise.all([
            client.productLedgerEntry.findMany({
                where,
                include: {
                    branch: { select: { id: true, name: true, code: true } },
                    agency: { select: { id: true, name: true, type: true } },
                    batch: true,
                    user: { select: { id: true, name: true, email: true } },
                },
                orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
                skip,
                take: limit,
            }),
            client.productLedgerEntry.count({ where })
        ]);

        return {
            id: ledger.id,
            productId: ledger.productId,
            code: ledger.code,

            // Product Metadata
            productName: ledger.product.name,
            productSKU: ledger.product.sku,
            productCategory: ledger.product.category,
            baseUnit: ledger.product.baseUnit,
            density: ledger.product.density ? Number(ledger.product.density) : null,
            minimumStockKG: ledger.product.minimumStockKG ? Number(ledger.product.minimumStockKG) : null,
            applicableGST: Number(ledger.product.applicableGST || 0),
            sellPricePerUnit: Number(ledger.product.sellPricePerUnit),

            // Global Stock
            stock: {
                globalStockKG: globalStock.globalStockKG,
                globalStockLTR: globalStock.globalStockLTR,
                isLowStock: ledger.product.minimumStockKG
                    ? globalStock.globalStockKG < Number(ledger.product.minimumStockKG)
                    : false,
            },

            // Branch-wise Stock Distribution
            branchStock: branchWiseStock,

            // Analytics
            analytics,

            // Paginated Movement History (NO running balance)
            movements: {
                entries: movements.map((e) => ({
                    id: e.id,
                    movementType: e.movementType,
                    direction: e.direction,
                    quantityKG: Number(e.quantityKG),
                    quantityLTR: e.quantityLTR ? Number(e.quantityLTR) : null,
                    unit: e.unit,
                    branch: e.branch,
                    agency: e.agency,
                    purchaseId: e.purchaseId,
                    saleId: e.saleId,
                    invoiceNo: e.invoiceNo,
                    batchNo: e.batchNo,
                    unitCost: e.unitCost ? Number(e.unitCost) : null,
                    totalCost: e.totalCost ? Number(e.totalCost) : null,
                    remarks: e.remarks,
                    entryDate: e.entryDate,
                    createdBy: e.user,
                    createdAt: e.createdAt,
                })),
                meta: {
                    total: totalMovements,
                    page,
                    limit,
                    totalPages: Math.ceil(totalMovements / limit),
                    hasNextPage: page * limit < totalMovements,
                    hasPreviousPage: page > 1,
                }
            },

            // Status & Timestamps
            isActive: ledger.isActive,
            createdAt: ledger.createdAt,
            updatedAt: ledger.updatedAt,
        };
    }

    /**
     * ========================================
     * GET PRODUCT ANALYTICS
     * ========================================
     * Calculate from ProductLedgerEntry history
     */
    private static async getProductAnalytics(productId: string) {
        const ledger = await prisma.productLedger.findUnique({
            where: { productId }
        });

        if (!ledger) {
            return null;
        }

        const entries = await prisma.productLedgerEntry.findMany({
            where: { productLedgerId: ledger.id },
            orderBy: { entryDate: "asc" }
        });

        if (entries.length === 0) {
            return {
                totalPurchased: 0,
                totalSold: 0,
                averagePurchasePrice: 0,
                stockValue: 0,
                turnoverRatio: 0,
                oldestEntryDate: null,
                newestEntryDate: null,
                lastMovementDaysAgo: null,
            };
        }

        // Purchase analytics
        const purchaseEntries = entries.filter(
            (e) => e.movementType === ProductMovementType.PURCHASE
        );
        const totalPurchased = purchaseEntries.reduce(
            (sum, e) => sum + Number(e.quantityKG),
            0
        );
        const totalPurchaseCost = purchaseEntries.reduce(
            (sum, e) => sum + Number(e.totalCost || 0),
            0
        );
        const averagePurchasePrice =
            totalPurchased > 0 ? totalPurchaseCost / totalPurchased : 0;

        // Sale analytics
        const saleEntries = entries.filter(
            (e) => e.movementType === ProductMovementType.SALE
        );
        const totalSold = saleEntries.reduce(
            (sum, e) => sum + Number(e.quantityKG),
            0
        );

        // Stock value (current stock * avg purchase price)
        const globalStock = await this.getGlobalProductStock(productId);
        const stockValue = globalStock.globalStockKG * averagePurchasePrice;

        // Turnover ratio
        const turnoverRatio =
            totalPurchased > 0 ? totalSold / totalPurchased : 0;

        // Date analytics
        const oldestEntryDate = entries[0]?.entryDate;
        const newestEntryDate = entries[entries.length - 1]?.entryDate;
        const lastMovementDaysAgo = newestEntryDate
            ? Math.floor(
                (new Date().getTime() - newestEntryDate.getTime()) / (1000 * 60 * 60 * 24)
            )
            : null;

        return {
            totalPurchased,
            totalSold,
            averagePurchasePrice: Math.round(averagePurchasePrice * 100) / 100,
            stockValue: Math.round(stockValue * 100) / 100,
            turnoverRatio: Math.round(turnoverRatio * 100) / 100,
            oldestEntryDate,
            newestEntryDate,
            lastMovementDaysAgo,
        };
    }

    /**
     * ========================================
     * GET PRODUCT LEDGER FULL HISTORY
     * ========================================
     * COMPLETE AUDIT ENDPOINT - Everything with full history
     * Includes:
     * - All product details
     * - Global + branch-wise stock
     * - Full analytics
     * - COMPLETE movement history with running balance
     * 
     * NOT PAGINATED - Use for exports, audits, reports
     */
    static async getProductLedgerFullHistory(
        productId: string,
        query?: {
            movementType?: ProductMovementType;
            branchId?: string;
            startDate?: Date;
            endDate?: Date;
        }
    ) {
        const ledger = await prisma.productLedger.findUnique({
            where: { productId },
            include: { product: true }
        });

        if (!ledger) {
            throw new ApiError("Product Ledger not found", 404);
        }

        // Get global stock
        const globalStock = await this.getGlobalProductStock(productId);

        // Get branch-wise stock
        const branchWiseStock = await this.getBranchWiseStock(productId);

        // Get analytics
        const analytics = await this.getProductAnalytics(productId);

        // Get FULL movement history (no pagination)
        const where: any = {
            productLedgerId: ledger.id,
            ...(query?.movementType && { movementType: query.movementType }),
            ...(query?.branchId && { branchId: query.branchId }),
            ...(query?.startDate || query?.endDate) && {
                entryDate: {
                    ...(query?.startDate && { gte: query.startDate }),
                    ...(query?.endDate && { lte: query.endDate }),
                }
            }
        };

        const allMovements = await prisma.productLedgerEntry.findMany({
            where,
            include: {
                branch: { select: { id: true, name: true, code: true } },
                agency: { select: { id: true, name: true, type: true } },
                batch: true,
                user: { select: { id: true, name: true, email: true } },
            },
            orderBy: { entryDate: "asc", createdAt: "asc" },
        });

        // Calculate running balances (safe - full history)
        const entriesWithBalance = this.calculateRunningBalances(allMovements);

        return {
            id: ledger.id,
            productId: ledger.productId,
            code: ledger.code,

            // Product Metadata
            productName: ledger.product.name,
            productSKU: ledger.product.sku,
            productCategory: ledger.product.category,
            baseUnit: ledger.product.baseUnit,
            density: ledger.product.density ? Number(ledger.product.density) : null,
            minimumStockKG: ledger.product.minimumStockKG ? Number(ledger.product.minimumStockKG) : null,
            applicableGST: Number(ledger.product.applicableGST || 0),
            sellPricePerUnit: Number(ledger.product.sellPricePerUnit),

            // Global Stock
            stock: {
                globalStockKG: globalStock.globalStockKG,
                globalStockLTR: globalStock.globalStockLTR,
                isLowStock: ledger.product.minimumStockKG
                    ? globalStock.globalStockKG < Number(ledger.product.minimumStockKG)
                    : false,
            },

            // Branch-wise Stock Distribution
            branchStock: branchWiseStock,

            // Analytics
            analytics,

            // FULL Movement History with Running Balance (complete audit trail)
            movements: {
                entries: entriesWithBalance.map((e) => ({
                    id: e.id,
                    movementType: e.movementType,
                    direction: e.direction,
                    quantityKG: Number(e.quantityKG),
                    quantityLTR: e.quantityLTR ? Number(e.quantityLTR) : null,
                    unit: e.unit,
                    balanceKG: e.balanceKG, // Calculated with full history
                    balanceLTR: e.balanceLTR, // Calculated with full history
                    branch: e.branch,
                    agency: e.agency,
                    purchaseId: e.purchaseId,
                    saleId: e.saleId,
                    invoiceNo: e.invoiceNo,
                    batchNo: e.batchNo,
                    unitCost: e.unitCost ? Number(e.unitCost) : null,
                    totalCost: e.totalCost ? Number(e.totalCost) : null,
                    remarks: e.remarks,
                    entryDate: e.entryDate,
                    createdBy: e.user,
                    createdAt: e.createdAt,
                })),
                total: entriesWithBalance.length,
            },

            // Status & Timestamps
            isActive: ledger.isActive,
            createdAt: ledger.createdAt,
            updatedAt: ledger.updatedAt,
        };
    }

    /**
     * ========================================
     * GET BRANCH-WISE STOCK
     * ========================================
     * Show which branch has what quantity
     */
    static async getBranchWiseStock(productId: string) {
        const inventory = await prisma.inventory.findMany({
            where: { productId },
            include: { branch: true }
        });

        return inventory.map((inv) => ({
            branchId: inv.branchId,
            branchName: inv.branch.name,
            branchCode: inv.branch.code,
            currentStockKG: Number(inv.currentStockKG),
            currentStockLTR: Number(inv.currentStockLTR),
        }));
    }

    /**
     * ========================================
     * GET PRODUCT LEDGER LIST (OPTIMIZED)
     * ========================================
     * Efficient: Single query with aggregation
     * NO expensive analytics in list view
     * Analytics only in detail view
     */
    static async getAllProductLedgers(
        query?: {
            page?: number;
            limit?: number;
            search?: string;
            isLowStock?: boolean;
            category?: string;
        }
    ) {
        const page = query?.page || 1;
        const limit = query?.limit || 20;
        const skip = (page - 1) * limit;

        const where: any = {
            isActive: true,
            ...(query?.search && {
                product: {
                    OR: [
                        { name: { contains: query.search, mode: "insensitive" } },
                        { sku: { contains: query.search, mode: "insensitive" } },
                    ]
                }
            }),
            ...(query?.category && {
                product: {
                    category: { contains: query.category, mode: "insensitive" }
                }
            })
        };

        // Get ledgers with product info
        const [ledgers, total] = await Promise.all([
            prisma.productLedger.findMany({
                where,
                include: { product: true },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            }),
            prisma.productLedger.count({ where })
        ]);

        // Get all inventory aggregates in ONE query (not N queries)
        const inventoryAggregates = await prisma.inventory.groupBy({
            by: ['productId'],
            where: {
                productId: { in: ledgers.map((l) => l.productId) }
            },
            _sum: {
                currentStockKG: true,
                currentStockLTR: true,
            }
        });

        // Create map for O(1) lookup
        const stockMap = new Map(
            inventoryAggregates.map((inv) => [
                inv.productId,
                {
                    globalStockKG: Number(inv._sum.currentStockKG || 0),
                    globalStockLTR: Number(inv._sum.currentStockLTR || 0),
                }
            ])
        );

        // Enrich ledgers with stock (no additional queries)
        const enriched = ledgers.map((l) => {
            const stock = stockMap.get(l.productId) || {
                globalStockKG: 0,
                globalStockLTR: 0,
            };

            return {
                id: l.id,
                code: l.code,
                productId: l.productId,
                productName: l.product.name,
                productSKU: l.product.sku,
                productCategory: l.product.category,
                baseUnit: l.product.baseUnit,
                globalStockKG: stock.globalStockKG,
                globalStockLTR: stock.globalStockLTR,
                minimumStockKG: l.product.minimumStockKG ? Number(l.product.minimumStockKG) : null,
                sellPricePerUnit: Number(l.product.sellPricePerUnit),
                isLowStock: l.product.minimumStockKG
                    ? stock.globalStockKG < Number(l.product.minimumStockKG)
                    : false,
                isActive: l.isActive,
            };
        });

        return {
            data: enriched,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1,
            }
        };
    }
}
