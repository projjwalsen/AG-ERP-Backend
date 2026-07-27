import {
    EntryType,
    LedgerNature,
    LedgerType,
    Prisma,
    ProductManufactureStatus,
    ProductRecipeStatus,
    ProductType,
    ProductUnit,
    VoucherType
} from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { InventoryService } from "../inventory/inventory.service";
import { ProductLedgerService } from "../accounting/productLedger/productLedger.service";
import { LedgerService } from "../accounting/ledger/ledger.service";

type RecipeItemInput = { productId: string; quantity: number; unit: ProductUnit };
type RecipeInput = { outputProductId: string; outputQuantity: number; outputUnit: ProductUnit; items: RecipeItemInput[]; remarks?: string };
type ManufactureInput = { recipeId: string; branchId: string; outputQuantity: number; remarks?: string };

const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));
const consumptionInclude = { product: { select: { name: true } } };
const withConsumptionProductName = (manufacture: any) => ({
    ...manufacture,
    consumptions: manufacture.consumptions?.map(({ product, id, manufactureId, productId, ...consumption }: any) => ({
        id,
        manufactureId,
        productId,
        productName: product?.name || null,
        ...consumption,
    }))
});

export class ManufacturingService {
    private static actor(actor: any) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
    }

    private static branch(actor: any, branchId: string) {
        if (actor.branchAccessType !== "ALL" && actor.branchId !== branchId) {
            throw new ApiError("Forbidden: You do not have access to this branch", 403);
        }
    }

    private static validateRecipe(input: RecipeInput) {
        if (!input.outputProductId || !input.outputUnit || !(Number(input.outputQuantity) > 0)) {
            throw new ApiError("Output product, output quantity and output unit are required", 400);
        }
        if (!Array.isArray(input.items) || input.items.length === 0) {
            throw new ApiError("At least one recipe item is required", 400);
        }
        const ids = new Set<string>();
        for (const item of input.items) {
            if (!item.productId || ids.has(item.productId) || !(Number(item.quantity) > 0) || !item.unit) {
                throw new ApiError("Recipe items must contain unique products with positive quantities and units", 400);
            }
            if (item.productId === input.outputProductId) throw new ApiError("A recipe cannot contain its output product", 400);
            ids.add(item.productId);
        }
    }

    private static async recipeForManufacture(tx: any, recipeId: string) {
        const recipe = await tx.productRecipe.findUnique({
            where: { id: recipeId },
            include: { outputProduct: true, items: { include: { product: true } } }
        });
        if (!recipe) throw new ApiError("Recipe not found", 404);
        if (recipe.status !== ProductRecipeStatus.APPROVED && recipe.status !== ProductRecipeStatus.LOCKED) {
            throw new ApiError("Only an approved recipe can be manufactured", 400);
        }
        if (recipe.outputProduct.productType === ProductType.PURCHASED) {
            throw new ApiError("The recipe output product must be MANUFACTURED or BOTH", 400);
        }
        return recipe;
    }

    private static async rejectCircularRecipe(outputProductId: string, itemProductIds: string[]) {
        const approved = await prisma.productRecipe.findMany({
            where: { status: { in: [ProductRecipeStatus.APPROVED, ProductRecipeStatus.LOCKED] } },
            select: { outputProductId: true, items: { select: { productId: true } } }
        });
        const graph = new Map<string, string[]>();
        for (const recipe of approved) graph.set(recipe.outputProductId, recipe.items.map(item => item.productId));
        const reachesOutput = (productId: string, seen = new Set<string>()): boolean => {
            if (productId === outputProductId) return true;
            if (seen.has(productId)) return false;
            seen.add(productId);
            return (graph.get(productId) || []).some(child => reachesOutput(child, new Set(seen)));
        };
        if (itemProductIds.some(pid => reachesOutput(pid))) throw new ApiError("Circular recipe composition is not allowed", 400);
    }

    private static async allocations(tx: any, recipe: any, branchId: string, outputQuantity: number) {
        const factor = outputQuantity / Number(recipe.outputQuantity);
        const result: any[] = [];
        const insufficient: any[] = [];
        let total = 0;

        for (const item of recipe.items) {
            const required = round(Number(item.quantity) * factor, 3);
            const fifo = await InventoryService.allocateFIFO(tx, {
                branchId, productId: item.productId, quantity: required, unit: item.unit
            });
            if (fifo.shortage > 0.000001) {
                insufficient.push({
                    productId: item.productId,
                    productName: item.product.name,
                    requiredQuantity: required,
                    availableQuantity: fifo.available,
                    shortage: fifo.shortage,
                    unit: item.unit
                });
                continue;
            }
            for (const allocation of fifo.allocations) {
                const unitCost = Number(allocation.batch.purchasePrice);
                const cost = round(allocation.quantity * unitCost);
                total += cost;
                result.push({
                    productId: item.productId,
                    productName: item.product.name,
                    batchId: allocation.batch.id,
                    batchNo: allocation.batch.batchNo,
                    quantity: allocation.quantity,
                    unit: item.unit,
                    unitCost,
                    totalCost: cost
                });
            }
        }

        return {
            allocations: result,
            insufficient,
            totalManufacturingCost: round(total),
            unitManufacturingCost: round(total / outputQuantity)
        };
    }

    static async createRecipe(actor: any, input: RecipeInput) {
        this.actor(actor);
        this.validateRecipe(input);
        const product = await prisma.product.findUnique({ where: { id: input.outputProductId } });
        if (!product) throw new ApiError("Output product not found", 404);
        if (product.productType === ProductType.PURCHASED) throw new ApiError("Output product must be MANUFACTURED or BOTH", 400);
        const itemProducts = await prisma.product.findMany({ where: { id: { in: input.items.map(item => item.productId) } }, select: { id: true } });
        if (itemProducts.length !== input.items.length) throw new ApiError("One or more recipe products were not found", 404);
        await this.rejectCircularRecipe(input.outputProductId, input.items.map(item => item.productId));
        return prisma.productRecipe.create({
            data: {
                outputProductId: input.outputProductId,
                outputQuantity: input.outputQuantity,
                outputUnit: input.outputUnit,
                remarks: input.remarks?.trim() || null,
                createdById: actor.id,
                items: { create: input.items.map(item => ({ productId: item.productId, quantity: item.quantity, unit: item.unit })) }
            },
            include: { outputProduct: true, items: { include: { product: true } } }
        });
    }

    static async listRecipes(actor: any, status?: ProductRecipeStatus) {
        this.actor(actor);
        return prisma.productRecipe.findMany({
            where: status ? { status } : undefined,
            include: { outputProduct: true, items: { include: { product: true } } },
            orderBy: { createdAt: "desc" }
        });
    }

    static async approveRecipe(actor: any, recipeId: string) {
        this.actor(actor);
        return prisma.$transaction(async tx => {
            const recipe = await tx.productRecipe.findUnique({ where: { id: recipeId }, include: { items: true } });
            if (!recipe) throw new ApiError("Recipe not found", 404);
            if (recipe.status !== ProductRecipeStatus.DRAFT) throw new ApiError("Only draft recipes can be approved", 400);
            const product = await tx.product.findUnique({ where: { id: recipe.outputProductId } });
            if (!product || product.productType === ProductType.PURCHASED) throw new ApiError("Output product must be MANUFACTURED or BOTH", 400);
            await tx.productRecipe.updateMany({ where: { outputProductId: recipe.outputProductId, status: ProductRecipeStatus.APPROVED }, data: { status: ProductRecipeStatus.LOCKED } });
            return tx.productRecipe.update({ where: { id: recipeId }, data: { status: ProductRecipeStatus.APPROVED, approvedById: actor.id, approvedAt: new Date() }, include: { outputProduct: true, items: { include: { product: true } } } });
        });
    }

    static async rejectRecipe(actor: any, recipeId: string, remarks?: string) {
        this.actor(actor);
        const result = await prisma.productRecipe.updateMany({ where: { id: recipeId, status: ProductRecipeStatus.DRAFT }, data: { status: ProductRecipeStatus.REJECTED, remarks: remarks?.trim() || undefined } });
        if (!result.count) throw new ApiError("Only draft recipes can be rejected", 400);
        return prisma.productRecipe.findUnique({ where: { id: recipeId }, include: { outputProduct: true, items: true } });
    }

    static async previewManufacture(actor: any, input: ManufactureInput) {
        this.actor(actor);
        this.branch(actor, input.branchId);
        if (!(Number(input.outputQuantity) > 0)) throw new ApiError("Output quantity must be greater than 0", 400);
        const recipe = await this.recipeForManufacture(prisma, input.recipeId);
        const calculation = await this.allocations(prisma, recipe, input.branchId, Number(input.outputQuantity));
        return { recipe, outputQuantity: input.outputQuantity, canManufacture: calculation.insufficient.length === 0, ...calculation };
    }

    static async createManufacture(actor: any, input: ManufactureInput) {
        this.actor(actor);
        this.branch(actor, input.branchId);
        if (!(Number(input.outputQuantity) > 0)) throw new ApiError("Output quantity must be greater than 0", 400);
        const recipe = await this.recipeForManufacture(prisma, input.recipeId);
        const calculation = await this.allocations(prisma, recipe, input.branchId, Number(input.outputQuantity));
        if (calculation.insufficient.length) throw new ApiError(`Insufficient stock: ${calculation.insufficient.map(item => `${item.productName} requires ${item.requiredQuantity} ${item.unit}, available ${item.availableQuantity} ${item.unit}`).join("; ")}`, 400);
        return prisma.productManufacture.create({
            data: {
                recipeId: recipe.id,
                outputProductId: recipe.outputProductId,
                branchId: input.branchId,
                outputBatchNo: `MFG-${Date.now()}`,
                outputQuantity: input.outputQuantity,
                outputUnit: recipe.outputUnit,
                totalManufacturingCost: calculation.totalManufacturingCost,
                unitManufacturingCost: calculation.unitManufacturingCost,
                remarks: input.remarks?.trim() || null,
                createdById: actor.id
            },
            include: { recipe: { include: { outputProduct: true, items: true } }, outputProduct: true }
        });
    }

    static async listManufactures(actor: any, status?: ProductManufactureStatus, branchId?: string) {
        this.actor(actor);
        if (branchId) this.branch(actor, branchId);
        const manufactures = await prisma.productManufacture.findMany({ where: { ...(status ? { status } : {}), ...(branchId ? { branchId } : {}) }, include: { outputProduct: true, recipe: true, consumptions: { include: consumptionInclude } }, orderBy: { createdAt: "desc" } });
        return manufactures.map(withConsumptionProductName);
    }

    static async approveManufacture(actor: any, manufactureId: string) {
        this.actor(actor);
        return prisma.$transaction(async tx => {
            const existing = await tx.productManufacture.findUnique({ where: { id: manufactureId } });
            if (!existing) throw new ApiError("Manufacturing document not found", 404);
            this.branch(actor, existing.branchId);
            const claimed = await tx.productManufacture.updateMany({ where: { id: manufactureId, status: ProductManufactureStatus.DRAFT }, data: { status: ProductManufactureStatus.APPROVED, approvedById: actor.id, approvedAt: new Date() } });
            if (!claimed.count) throw new ApiError("Only draft manufacturing documents can be approved", 409);
            const manufacture = await tx.productManufacture.findUnique({ where: { id: manufactureId } });
            if (!manufacture) throw new ApiError("Manufacturing document not found after approval", 404);
            const recipe = await this.recipeForManufacture(tx, manufacture.recipeId);
            const calculation = await this.allocations(tx, recipe, manufacture.branchId, Number(manufacture.outputQuantity));
            if (calculation.insufficient.length) throw new ApiError(`Insufficient stock: ${calculation.insufficient.map(item => `${item.productName} requires ${item.requiredQuantity} ${item.unit}, available ${item.availableQuantity} ${item.unit}`).join("; ")}`, 400);

            const outputBatch = await InventoryService.addStock(tx, { branchId: manufacture.branchId, productId: manufacture.outputProductId, batchNo: manufacture.outputBatchNo, quantity: Number(manufacture.outputQuantity), unit: manufacture.outputUnit, purchasePrice: calculation.unitManufacturingCost, transactionDate: manufacture.createdAt });
            const outputLedger = await ProductLedgerService.getOrCreateProductLedger(manufacture.outputProductId, tx);
            await ProductLedgerService.createManufactureInMovement(tx, { productLedgerId: outputLedger.id, manufacture: { ...manufacture, totalManufacturingCost: calculation.totalManufacturingCost, unitManufacturingCost: calculation.unitManufacturingCost }, batchId: outputBatch.id, batchNo: manufacture.outputBatchNo });

            const accountingEntries: any[] = [];
            const wipLedger = await LedgerService.getOrCreateLedger(tx, { code: `MFG_WIP_${manufacture.branchId}`, name: "Manufacturing WIP", category: LedgerType.JOURNAL, groupCode: "DIRECT_EXPENSE", nature: LedgerNature.DEBIT, branchId: manufacture.branchId, createdById: actor.id });
            accountingEntries.push({ ledgerId: wipLedger.id, entryType: EntryType.DEBIT, amount: calculation.totalManufacturingCost, branchId: manufacture.branchId, narration: `Manufacturing WIP ${manufacture.id}` });

            for (const allocation of calculation.allocations) {
                await InventoryService.removeStock(tx, { branchId: manufacture.branchId, productId: allocation.productId, batchId: allocation.batchId, quantity: allocation.quantity, unit: allocation.unit, transactionDate: manufacture.createdAt });
                await tx.productManufactureConsumption.create({ data: { manufactureId: manufacture.id, productId: allocation.productId, batchId: allocation.batchId, quantity: allocation.quantity, unit: allocation.unit, unitCost: allocation.unitCost, totalCost: allocation.totalCost } });
                const ledger = await ProductLedgerService.getOrCreateProductLedger(allocation.productId, tx);
                await ProductLedgerService.createManufactureOutMovement(tx, { productLedgerId: ledger.id, manufacture, consumption: allocation, batchNo: allocation.batchNo });
                const productLedger = await LedgerService.getOrCreateLedger(tx, { code: `PRODUCT_${allocation.productId}`, name: allocation.productName, category: LedgerType.PRODUCT, groupCode: "ASSETS", nature: LedgerNature.DEBIT, branchId: manufacture.branchId, productId: allocation.productId, createdById: actor.id });
                accountingEntries.push({ ledgerId: productLedger.id, entryType: EntryType.CREDIT, amount: allocation.totalCost, branchId: manufacture.branchId, productId: allocation.productId, narration: `Raw material consumed for ${manufacture.id}` });
            }
            const finishedLedger = await LedgerService.getOrCreateLedger(tx, { code: `PRODUCT_${manufacture.outputProductId}`, name: recipe.outputProduct.name, category: LedgerType.PRODUCT, groupCode: "ASSETS", nature: LedgerNature.DEBIT, branchId: manufacture.branchId, productId: manufacture.outputProductId, createdById: actor.id });
            accountingEntries.push({ ledgerId: finishedLedger.id, entryType: EntryType.DEBIT, amount: calculation.totalManufacturingCost, branchId: manufacture.branchId, productId: manufacture.outputProductId, narration: `Finished goods received for ${manufacture.id}` });
            accountingEntries.push({ ledgerId: wipLedger.id, entryType: EntryType.CREDIT, amount: calculation.totalManufacturingCost, branchId: manufacture.branchId, narration: `Manufacturing WIP cleared for ${manufacture.id}` });
            const voucher = await LedgerService.createVoucher({ voucherType: VoucherType.JOURNAL, sourceId: manufacture.id, branchId: manufacture.branchId, narration: `Manufacturing ${recipe.outputProduct.name}`, voucherDate: manufacture.createdAt, entries: accountingEntries }, tx);
            const updatedManufacture = await tx.productManufacture.update({ where: { id: manufacture.id }, data: { totalManufacturingCost: calculation.totalManufacturingCost, unitManufacturingCost: calculation.unitManufacturingCost, outputBatchId: outputBatch.id, voucherId: voucher.id }, include: { outputProduct: true, recipe: { include: { outputProduct: true, items: true } }, consumptions: { include: consumptionInclude }, voucher: { include: { entries: true } } } });
            return withConsumptionProductName(updatedManufacture);
        });
    }

    static async rejectManufacture(actor: any, manufactureId: string, remarks?: string) {
        this.actor(actor);
        const result = await prisma.productManufacture.updateMany({ where: { id: manufactureId, status: ProductManufactureStatus.DRAFT }, data: { status: ProductManufactureStatus.REJECTED, remarks: remarks?.trim() || undefined } });
        if (!result.count) throw new ApiError("Only draft manufacturing documents can be rejected", 400);
        return prisma.productManufacture.findUnique({ where: { id: manufactureId }, include: { outputProduct: true, recipe: true } });
    }
}
