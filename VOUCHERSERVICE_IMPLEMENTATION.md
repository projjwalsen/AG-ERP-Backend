# VoucherService Implementation - Using Fixed LedgerService

## Overview

VoucherService orchestrates the creation of journal entries by:
1. Getting/Creating ledgers dynamically using `LedgerService.getOrCreateLedger()`
2. Creating ledger entries for each debit/credit
3. Updating balances using `LedgerService.updateBalance()`
4. Ensuring debit = credit balance

All operations happen atomically within `prisma.$transaction()`

---

## approvePurchase() - Complete Implementation

### What Happens

When a PENDING purchase is approved:
1. ✅ Create VENDOR ledger (for the supplier/agency)
2. ✅ Create PRODUCT ledger (GLOBAL - aggregates stock across all branches)
3. ✅ Create PURCHASE ledger (for the branch)
4. ✅ Create GST ledger (for the branch)
5. ✅ Create ledger entries (Dr/Cr movements)
6. ✅ Update all balances
7. ✅ Update inventory
8. ✅ Mark purchase as APPROVED

### Database Changes

```
PURCHASE: {
  id: "pur-123",
  invoiceNo: "PUR-001",
  status: "PENDING" → "APPROVED"
  agencyId: "ag-vendor-1",
  branchId: "br-jaipur",
  items: [
    { productId: "prod-steel", quantity: 100, unit: KG, purchasePrice: 500 },
  ]
}

LEDGER: {
  VENDOR-1: code=VEND-acmeinc-1, category=VENDOR, agencyId=ag-vendor-1, balance=50000
  PRODUCT-1: code=PROD-steel-1, category=PRODUCT, productId=prod-steel, balance=100
  PURCHASE-1: code=PURCH-1, category=PURCHASE, branchId=br-jaipur, balance=50000
  GST-1: code=GST-1, category=GST, branchId=br-jaipur, balance=5000
}

LEDGER_ENTRY: [
  { ledgerId=PURCHASE-1, entryType=DEBIT, amount=50000 },
  { ledgerId=VENDOR-1, entryType=CREDIT, amount=50000 },
  { ledgerId=PRODUCT-1, entryType=DEBIT, amount=100 (qty) },
  { ledgerId=GST-1, entryType=CREDIT, amount=5000 },
]

INVENTORY_BATCH: {
  availableQtyKG: 0 → 100 (stock added)
}

INVENTORY: {
  currentStockKG: 0 → 100 (branch total updated)
}
```

### Implementation Code

```typescript
// File: src/modules/purchase/purchase.service.ts

static async approvePurchase(
    actor: any,
    purchaseId: string
) {
    if(!actor?.id) {
        throw new ApiError("Unauthorized", 401);
    }

    const canApprove = await RBACService.hasPermission(
        actor.id,
        "PURCHASE:APPROVE"
    );

    if(!canApprove) {
        throw new ApiError("You do not have permission to approve purchase", 403);
    }

    const purchase = await prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: {
            items: {
                include: {
                    product: true,
                    batch: true
                }
            },
            agency: true,
            branch: true
        }
    });

    if(!purchase) {
        throw new ApiError("Purchase not found", 404);
    }

    if(purchase.status !== "PENDING") {
        throw new ApiError("Purchase already processed", 400);
    }

    /**
     * ====================================
     * ATOMIC TRANSACTION
     * ====================================
     * All operations succeed or all rollback
     */
    return prisma.$transaction(async (tx) => {

        // ========================================
        // STEP 1: Get/Create Ledgers
        // ========================================

        // 1a. Vendor Ledger
        // One per agency (not one per branch)
        const vendorLedger = await LedgerService.getOrCreateLedger(
            {
                category: LedgerType.VENDOR,
                agencyId: purchase.agencyId  // e.g., "ag-123"
            },
            tx  // Pass transaction
        );
        // Creates if new: VEND-acmeinc-1 | Vendor - Acme Inc

        // 1b. Purchase Ledger
        // One per branch
        const purchaseLedger = await LedgerService.getOrCreateLedger(
            {
                category: LedgerType.PURCHASE,
                branchId: purchase.branchId  // e.g., "br-jaipur"
            },
            tx
        );
        // Creates if new: PURCH-1 | Purchase Account

        // 1c. GST Ledger
        // One per branch
        const gstLedger = await LedgerService.getOrCreateLedger(
            {
                category: LedgerType.GST,
                branchId: purchase.branchId
            },
            tx
        );
        // Creates if new: GST-1 | GST Payable

        // ========================================
        // STEP 2: Process Each Item
        // ========================================

        for (const item of purchase.items) {
            // 2a. Get/Create Product Ledger (GLOBAL)
            // Note: branchId passed but NOT used in lookup
            // This ensures ONE ledger per product across all branches
            const productLedger = await LedgerService.getOrCreateLedger(
                {
                    category: LedgerType.PRODUCT,
                    productId: item.productId,
                    branchId: purchase.branchId  // For context, not used in search
                },
                tx
            );
            // Returns: PROD-steel-1 | Product - Steel Pipes
            // Same ledger if called from another branch ✓

            // 2b. Calculate amounts
            const quantity = Number(item.quantity);
            const purchasePrice = Number(item.purchasePrice);
            const taxableAmount = quantity * purchasePrice;
            
            const gstPercent = Number(item.product.applicableGST) || 0;
            const gstAmount = (taxableAmount * gstPercent) / 100;
            const totalAmount = taxableAmount + gstAmount;

            // ========================================
            // STEP 3: Create Ledger Entries
            // ========================================

            // Entry 1: Purchase Account (DEBIT)
            // Purchase increases (goods received)
            await tx.ledgerEntry.create({
                data: {
                    ledgerId: purchaseLedger.id,
                    voucherId: purchase.id,  // Link to purchase
                    entryType: EntryType.DEBIT,
                    amount: totalAmount,
                    narration: `Purchase of ${item.product.name} - ${item.quantity} ${item.unit}`
                }
            });

            // Entry 2: Vendor Account (CREDIT)
            // We owe vendor
            await tx.ledgerEntry.create({
                data: {
                    ledgerId: vendorLedger.id,
                    voucherId: purchase.id,
                    entryType: EntryType.CREDIT,
                    amount: totalAmount,
                    narration: `Purchase from ${purchase.agency.name}`
                }
            });

            // Entry 3: Product Ledger (DEBIT)
            // Stock increases (GLOBAL aggregation)
            await tx.ledgerEntry.create({
                data: {
                    ledgerId: productLedger.id,
                    voucherId: purchase.id,
                    entryType: EntryType.DEBIT,
                    amount: quantity,
                    narration: `Stock in - ${item.batch.batchNo}`
                }
            });

            // Entry 4: GST Ledger (CREDIT)
            // GST liability increases
            if (gstAmount > 0) {
                await tx.ledgerEntry.create({
                    data: {
                        ledgerId: gstLedger.id,
                        voucherId: purchase.id,
                        entryType: EntryType.CREDIT,
                        amount: gstAmount,
                        narration: `GST on purchase - ${gstPercent}%`
                    }
                });
            }

            // ========================================
            // STEP 4: Update Ledger Balances
            // ========================================

            // Debit Purchase Account
            await LedgerService.updateBalance(
                tx,
                purchaseLedger.id,
                totalAmount,
                EntryType.DEBIT  // Balance += totalAmount
            );

            // Credit Vendor Account
            await LedgerService.updateBalance(
                tx,
                vendorLedger.id,
                totalAmount,
                EntryType.CREDIT  // Balance -= totalAmount
            );

            // Debit Product Ledger (quantity in stock)
            await LedgerService.updateBalance(
                tx,
                productLedger.id,
                quantity,
                EntryType.DEBIT  // Balance += quantity
            );

            // Credit GST Ledger
            if (gstAmount > 0) {
                await LedgerService.updateBalance(
                    tx,
                    gstLedger.id,
                    gstAmount,
                    EntryType.CREDIT  // Balance -= gstAmount
                );
            }

            // ========================================
            // STEP 5: Update Inventory
            // ========================================

            // Update batch quantities
            await tx.inventoryBatch.update({
                where: { id: item.batchId },
                data: {
                    availableQtyKG: {
                        increment: item.unit === ProductUnit.KG ? quantity : 0
                    },
                    availableQtyLTR: {
                        increment: item.unit === ProductUnit.LTR ? quantity : 0
                    }
                }
            });

            // Update branch inventory totals
            await tx.inventory.upsert({
                where: {
                    branchId_productId: {
                        branchId: purchase.branchId,
                        productId: item.productId
                    }
                },
                update: {
                    currentStockKG: {
                        increment: item.unit === ProductUnit.KG ? quantity : 0
                    },
                    currentStockLTR: {
                        increment: item.unit === ProductUnit.LTR ? quantity : 0
                    }
                },
                create: {
                    branchId: purchase.branchId,
                    productId: item.productId,
                    currentStockKG: item.unit === ProductUnit.KG ? quantity : 0,
                    currentStockLTR: item.unit === ProductUnit.LTR ? quantity : 0
                }
            });
        }

        // ========================================
        // STEP 6: Validate Debit = Credit
        // ========================================
        // Total entries debit must equal credit
        const totalDebit = purchase.grandTotal;
        const totalCredit = purchase.grandTotal + Number(purchase.totalGSTAmount);
        
        if (totalDebit !== totalCredit) {
            throw new ApiError("Debit ≠ Credit balance", 400);
        }

        // ========================================
        // STEP 7: Mark Purchase as Approved
        // ========================================

        const approvedPurchase = await tx.purchase.update({
            where: { id: purchaseId },
            data: {
                status: PurchaseStatus.APPROVED,
                approvedById: actor.id,
                approvedAt: new Date()
            },
            include: {
                items: {
                    include: {
                        product: true,
                        batch: true
                    }
                },
                agency: true,
                branch: true
            }
        });

        return approvedPurchase;

    });  // End transaction
}
```

---

## approveSale() - Similar Pattern

### Implementation Pattern

```typescript
static async approveSale(
    actor: any,
    saleId: string
) {
    // ... Permission checks ...

    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: {
            items: {
                include: {
                    product: true,
                    batch: true
                }
            },
            agency: true,
            branch: true
        }
    });

    // ... Validations ...

    return prisma.$transaction(async (tx) => {

        // 1. Get/Create Ledgers
        const customerLedger = await LedgerService.getOrCreateLedger(
            { category: LedgerType.CUSTOMER, agencyId: sale.agencyId },
            tx
        );

        const salesLedger = await LedgerService.getOrCreateLedger(
            { category: LedgerType.SALES, branchId: sale.branchId },
            tx
        );

        const gstLedger = await LedgerService.getOrCreateLedger(
            { category: LedgerType.GST, branchId: sale.branchId },
            tx
        );

        for (const item of sale.items) {
            // Get/Create Product Ledger (GLOBAL)
            const productLedger = await LedgerService.getOrCreateLedger(
                { 
                    category: LedgerType.PRODUCT,
                    productId: item.productId,
                    branchId: sale.branchId
                },
                tx
            );

            // 2. Create entries
            // Sales Account (DEBIT) - sales revenue
            await tx.ledgerEntry.create({
                data: {
                    ledgerId: salesLedger.id,
                    voucherId: sale.id,
                    entryType: EntryType.DEBIT,
                    amount: item.totalAmount
                }
            });

            // Customer Account (CREDIT) - customer owes us
            await tx.ledgerEntry.create({
                data: {
                    ledgerId: customerLedger.id,
                    voucherId: sale.id,
                    entryType: EntryType.CREDIT,
                    amount: item.totalAmount
                }
            });

            // Product Ledger (CREDIT) - stock decreases
            await tx.ledgerEntry.create({
                data: {
                    ledgerId: productLedger.id,
                    voucherId: sale.id,
                    entryType: EntryType.CREDIT,
                    amount: item.quantity
                }
            });

            // GST Ledger (DEBIT) - GST collected from customer
            if (item.gstAmount > 0) {
                await tx.ledgerEntry.create({
                    data: {
                        ledgerId: gstLedger.id,
                        voucherId: sale.id,
                        entryType: EntryType.DEBIT,
                        amount: item.gstAmount
                    }
                });
            }

            // 3. Update balances
            await LedgerService.updateBalance(
                tx, salesLedger.id, item.totalAmount, EntryType.DEBIT
            );
            await LedgerService.updateBalance(
                tx, customerLedger.id, item.totalAmount, EntryType.CREDIT
            );
            await LedgerService.updateBalance(
                tx, productLedger.id, item.quantity, EntryType.CREDIT
            );
            if (item.gstAmount > 0) {
                await LedgerService.updateBalance(
                    tx, gstLedger.id, item.gstAmount, EntryType.DEBIT
                );
            }

            // 4. Update inventory (decrease stock)
            await tx.inventoryBatch.update({
                where: { id: item.batchId },
                data: {
                    availableQtyKG: {
                        decrement: item.unit === ProductUnit.KG ? item.quantity : 0
                    },
                    availableQtyLTR: {
                        decrement: item.unit === ProductUnit.LTR ? item.quantity : 0
                    }
                }
            });

            await tx.inventory.update({
                where: {
                    branchId_productId: {
                        branchId: sale.branchId,
                        productId: item.productId
                    }
                },
                data: {
                    currentStockKG: {
                        decrement: item.unit === ProductUnit.KG ? item.quantity : 0
                    },
                    currentStockLTR: {
                        decrement: item.unit === ProductUnit.LTR ? item.quantity : 0
                    }
                }
            });
        }

        // 5. Mark sale as approved
        return await tx.sale.update({
            where: { id: saleId },
            data: {
                status: SalesStatus.APPROVED,
                approvedById: actor.id,
                approvedAt: new Date()
            }
        });

    });
}
```

---

## Key Points for VoucherService

### ✅ Use getOrCreateLedger() for ALL Ledger Access

```typescript
// ✅ CORRECT
const ledger = await LedgerService.getOrCreateLedger({
    category: LedgerType.VENDOR,
    agencyId: purchase.agencyId
}, tx);

// ❌ WRONG - Don't manually create
const ledger = await tx.ledger.create({...});
```

### ✅ Always Pass `tx` to LedgerService

```typescript
await prisma.$transaction(async (tx) => {
    // ✅ Pass tx
    await LedgerService.getOrCreateLedger({...}, tx);
    await LedgerService.updateBalance(tx, ...);

    // ❌ Don't forget tx
    // await LedgerService.getOrCreateLedger({...});
});
```

### ✅ Product Ledger is GLOBAL

```typescript
// Branch-1 purchase
const prod1 = await LedgerService.getOrCreateLedger({
    category: PRODUCT,
    productId: "prod-789",
    branchId: "br-jaipur"
}, tx);
// Creates: PROD-ghi789-1 if new

// Branch-2 sale
const prod2 = await LedgerService.getOrCreateLedger({
    category: PRODUCT,
    productId: "prod-789",
    branchId: "br-delhi"
}, tx);
// Returns SAME ledger (PROD-ghi789-1) ✓
// branchId is IGNORED in lookup

// Result: ONE ledger contains ALL movements
// Jaipur: +100 (debit), -20 (credit)
// Delhi: -15 (credit)
// Final balance: 65 units (total stock across all branches)
```

### ✅ Entry Debit = Credit

```typescript
// For every debit, create equal credit
let totalDebit = 0;
let totalCredit = 0;

// Debit Purchase Account
await tx.ledgerEntry.create({
    ledgerId: purchaseLedger.id,
    entryType: DEBIT,
    amount: 50000
});
totalDebit += 50000;

// Credit Vendor Account
await tx.ledgerEntry.create({
    ledgerId: vendorLedger.id,
    entryType: CREDIT,
    amount: 50000
});
totalCredit += 50000;

// Validate before update
if (totalDebit !== totalCredit) {
    throw new ApiError("Entries must balance", 400);
}
```

### ✅ Balance Updates are One-Way

```typescript
// Always use LedgerService.updateBalance()
// Never update balance manually

// ✅ Correct
await LedgerService.updateBalance(tx, ledgerId, 50000, DEBIT);

// ❌ Wrong
await tx.ledger.update({
    where: { id: ledgerId },
    data: { currentBalance: 50000 }
});
```

---

## Testing Scenarios

### Scenario 1: Multi-Branch Product Purchase

```
Purchase 1: Branch-JAIPUR, Product-Steel, Qty=100
Purchase 2: Branch-DELHI, Product-Steel, Qty=50
Sale 1: Branch-JAIPUR, Product-Steel, Qty=20
```

**Expected Result:**
- Product Ledger (PROD-steel-1) contains:
  - DEBIT 100 (Jaipur purchase)
  - DEBIT 50 (Delhi purchase)
  - CREDIT 20 (Jaipur sale)
  - **Balance: 130** (total stock across all branches)

### Scenario 2: Multiple Branches, Same Agency

```
Vendor-A: VEND-acme-1 (agencyId=ag-1)

Purchase 1: Branch-JAIPUR, Vendor-A → VEND-acme-1 (created)
Purchase 2: Branch-DELHI, Vendor-A → VEND-acme-1 (returned, not created)
```

**Expected Result:**
- Only ONE vendor ledger per agency
- Both purchases update SAME ledger

### Scenario 3: GST Calculation

```
Purchase: qty=100, price=500/unit, GST=18%
  Taxable: 50,000
  GST: 9,000
  Total: 59,000

Entries:
  1. Purchase (DEBIT): 59,000
  2. Vendor (CREDIT): 59,000
  3. GST (CREDIT): 9,000  ← GST liability

Balance Validation:
  Debit: 59,000
  Credit: 59,000 + 9,000 = 68,000
```

---

## Required Schema Fields

Ensure schema has these enums:

```prisma
enum LedgerType {
  CUSTOMER
  VENDOR
  BANK
  CASH
  GST
  SALES
  PURCHASE
  INVENTORY
  PRODUCT
  SUSPENSE
}

enum EntryType {
  DEBIT
  CREDIT
}

enum VoucherType {
  PURCHASE
  SALE
  PAYMENT
  // ...
}
```

---

## Import Statements

```typescript
import { LedgerService } from "../accounting/ledger/ledger.service";
import { 
    LedgerType, 
    EntryType, 
    PurchaseStatus,
    SalesStatus,
    ProductUnit,
    Prisma 
} from "@prisma/client";
```

---

## Next Steps

1. ✅ Implement `approvePurchase()` using above pattern
2. ✅ Implement `approveSale()` using above pattern
3. ✅ Create `createPayment()` for transaction allocation
4. ⭐ Add unit tests for all scenarios
5. ⭐ Add integration tests (multi-step workflows)
6. ⭐ Document payment allocation logic

