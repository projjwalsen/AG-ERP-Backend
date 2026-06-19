# LedgerService - Quick Reference & Implementation Checklist

## What Was Fixed?

| Issue | Before | After | Impact |
|-------|--------|-------|--------|
| **No Transaction Support** | Methods used `prisma` directly | All methods accept optional `tx: Prisma.TransactionClient` | ✅ Safe for atomic operations |
| **No Dynamic Creation** | VoucherService manually created ledgers | `getOrCreateLedger()` auto-creates with smart lookup | ✅ Less boilerplate, fewer bugs |
| **No Smart Lookup** | Blocked VENDOR #2 for same agency | Category-aware lookup - CUSTOMER + VENDOR both allowed | ✅ Correct duplicate detection |
| **No Auto-Codes** | Manual code entry | `generateLedgerCode()` auto-generates CUST-, VEND-, PROD-, etc. | ✅ Consistent, meaningful codes |
| **Missing Relations** | Missing product inclusion | All methods include branch, agency, product | ✅ Complete data on every call |
| **No Product Support** | productId field ignored | Full support for PRODUCT/INVENTORY ledger types | ✅ Product ledgers work |
| **Product Ledger Design** | Unclear per-branch vs global | ✅ Confirmed GLOBAL - one per product across ALL branches | ✅ Proper inventory aggregation |

---

## LedgerService Architecture

```
LedgerService
│
├── validateLedger(ledgerId, checkActive?, tx?)
│   └── Validates ledger exists + optionally checks active status
│   └── Transaction-safe ✓
│
├── ⭐ getOrCreateLedger(payload, tx?)  [MAIN FOR VOUCHERSERVICE]
│   ├── Calls buildLedgerSearchQuery() → Smart lookup query
│   ├── Tries to find existing ledger
│   ├── If not found → calls generateLedgerCode() → creates new
│   └── Returns ledger (with branch, agency, product relations)
│
├── buildLedgerSearchQuery(payload)  [INTERNAL]
│   ├── CUSTOMER/VENDOR → { category, agencyId }
│   ├── PRODUCT/INVENTORY → { category, productId } (GLOBAL - no branchId)
│   └── BANK/CASH/GST/SALES/PURCHASE → { category, branchId }
│
├── generateLedgerCode(category, context)  [INTERNAL]
│   ├── CUST-<abbrev>-<serial> | Customer - <AgencyName>
│   ├── VEND-<abbrev>-<serial> | Vendor - <AgencyName>
│   ├── PROD-<abbrev>-<serial> | Product - <ProductName>
│   ├── BANK-<serial> | Bank Account
│   └── GST-<serial> | GST Payable
│
├── updateBalance(tx, ledgerId, amount, entryType)
│   ├── DEBIT → Balance += amount
│   ├── CREDIT → Balance -= amount
│   └── ⚠️ Must be called from within transaction
│
├── getLedgerById(ledgerId, tx?)
├── getLedgerByCode(code, tx?)
├── getLedgerByAgency(agencyId, tx?)
├── ⭐ getLedgerByCategory(category, filters?, tx?)
├── getLedgers(query?)
├── createLedger(payload, tx?)
├── updateLedger(ledgerId, payload, tx?)
├── getLedgerBalance(ledgerId)
└── getAgencyOutstanding(agencyId)
```

---

## Usage Pattern for VoucherService

### In approvePurchase()

```typescript
await prisma.$transaction(async (tx) => {
    // 1. Get/Create Ledgers
    const vendorLedger = await LedgerService.getOrCreateLedger(
        { category: VENDOR, agencyId: purchase.agencyId },
        tx
    );
    const productLedger = await LedgerService.getOrCreateLedger(
        { category: PRODUCT, productId: item.productId, branchId: purchase.branchId },
        tx
    );
    const purchaseLedger = await LedgerService.getOrCreateLedger(
        { category: PURCHASE, branchId: purchase.branchId },
        tx
    );
    const gstLedger = await LedgerService.getOrCreateLedger(
        { category: GST, branchId: purchase.branchId },
        tx
    );

    // 2. Create entries + update balances
    await tx.ledgerEntry.create({...});
    await LedgerService.updateBalance(tx, ledgerId, amount, DEBIT);
    
    // Repeat for each entry...

    // 3. Mark as approved
    await tx.purchase.update({...});
});
```

### In approveSale() - Same Pattern

```typescript
await prisma.$transaction(async (tx) => {
    const customerLedger = await LedgerService.getOrCreateLedger(
        { category: CUSTOMER, agencyId: sale.agencyId },
        tx
    );
    const salesLedger = await LedgerService.getOrCreateLedger(
        { category: SALES, branchId: sale.branchId },
        tx
    );
    const productLedger = await LedgerService.getOrCreateLedger(
        { category: PRODUCT, productId: item.productId, branchId: sale.branchId },
        tx
    );
    // ... create entries, update balances, approve sale
});
```

---

## Key Design Decisions

### 1. Product Ledger is GLOBAL

```
Product: Steel Pipes (prod-789)

Branch-Jaipur + Product-Steel → PROD-ghi789-1
Branch-Delhi + Product-Steel   → PROD-ghi789-1 (SAME) ✓

One ledger aggregates ALL movements:
- Jaipur purchase: +100 qty
- Delhi sale: -20 qty
- Delhi purchase: +50 qty
- Balance: 130 (total stock)
```

### 2. One Ledger per Agency per Category

```
Agency: Acme Inc (ag-1)

CUSTOMER for ag-1 → CUST-acmeinc-1
VENDOR for ag-1   → VEND-acmeinc-1 (different!)
VENDOR #2 for ag-1 ✗ Blocked (returns existing)
```

### 3. Transaction Safety

```typescript
// ✅ All operations atomic
await prisma.$transaction(async (tx) => {
    const ledger = await LedgerService.getOrCreateLedger({...}, tx);
    await LedgerService.updateBalance(tx, ledger.id, ...);
    await tx.ledgerEntry.create({...});
    // All succeed or all rollback
});

// ❌ If one fails, none happen
if (error) {
    // All changes rolled back automatically
}
```

### 4. Auto-Code Generation

```
No need to:
- Pass code manually
- Generate codes in VoucherService
- Worry about duplicate codes

System auto-generates:
- VEND-acmeinc-1  ← From agency name
- PROD-steel-1    ← From product name
- BANK-1          ← Sequential
```

---

## Must-Have Checklist for VoucherService

- [ ] **Transaction Wrapper**
  - [ ] All changes wrapped in `prisma.$transaction()`
  - [ ] Single transaction per voucher approval

- [ ] **Ledger Management**
  - [ ] Use `getOrCreateLedger()` for ALL ledger access
  - [ ] Pass `tx` to all LedgerService methods
  - [ ] Don't manually create ledgers

- [ ] **Entry Creation**
  - [ ] Create `LedgerEntry` for each Dr/Cr
  - [ ] Link entry to voucher: `voucherId: voucher.id`
  - [ ] Set correct `entryType: DEBIT | CREDIT`

- [ ] **Balance Updates**
  - [ ] Call `updateBalance()` after each entry
  - [ ] Use `EntryType.DEBIT` or `EntryType.CREDIT`
  - [ ] Track total debits and credits

- [ ] **Balance Validation**
  - [ ] Total debits must equal total credits
  - [ ] Throw error if imbalanced
  - [ ] Validate before approval

- [ ] **Inventory Updates**
  - [ ] Update `InventoryBatch` quantities
  - [ ] Update `Inventory` branch totals
  - [ ] Handle both KG and LTR units

- [ ] **Final State**
  - [ ] Mark voucher as APPROVED
  - [ ] Set `approvedById` and `approvedAt`
  - [ ] Return complete voucher with relations

---

## Database State After approvePurchase()

### Before Approval
```
Purchase {
  id: "pur-123",
  status: "PENDING",
  invoiceNo: "PUR-001",
  agencyId: "ag-vendor-1",
  branchId: "br-jaipur",
  grandTotal: 50000,
  totalGSTAmount: 5000,
}

Ledger: (none created)
LedgerEntry: (none created)
Inventory: currentStockKG: 0
```

### After Approval (Complete State)
```
Purchase {
  id: "pur-123",
  status: "APPROVED",  ← Changed
  approvedAt: now(),   ← Set
  approvedById: "user-456",  ← Set
}

Ledger {
  VEND-acmeinc-1: { category: VENDOR, agencyId: ag-1, balance: -50000 }
  PROD-steel-1: { category: PRODUCT, productId: prod-789, balance: +100 }
  PURCH-1: { category: PURCHASE, branchId: br-1, balance: +50000 }
  GST-1: { category: GST, branchId: br-1, balance: -5000 }
}

LedgerEntry: [
  { ledgerId: PURCH-1, entryType: DEBIT, amount: 50000 },
  { ledgerId: VEND-acmeinc-1, entryType: CREDIT, amount: 50000 },
  { ledgerId: PROD-steel-1, entryType: DEBIT, amount: 100 },
  { ledgerId: GST-1, entryType: CREDIT, amount: 5000 },
]

Inventory {
  branchId: br-jaipur,
  productId: prod-789,
  currentStockKG: 100  ← Updated
}

InventoryBatch {
  availableQtyKG: 100  ← Updated
}
```

---

## Error Handling

### Common Errors to Catch

```typescript
// 1. Ledger not found
try {
    await LedgerService.validateLedger(invalidId);
} catch (e) {
    // ApiError: "Ledger not found" (404)
}

// 2. Ledger inactive
try {
    await LedgerService.getOrCreateLedger({...}, tx);
} catch (e) {
    // ApiError: "Ledger is inactive" (400)
}

// 3. Missing required context
try {
    await LedgerService.getOrCreateLedger({
        category: VENDOR
        // ❌ Missing agencyId
    }, tx);
} catch (e) {
    // ApiError: "Agency ID is required for VENDOR ledger" (400)
}

// 4. Duplicate ledger
try {
    await LedgerService.createLedger({
        code: "VEND-acmeinc-1",  // Already exists
        category: VENDOR,
        agencyId: "ag-1"
    }, tx);
} catch (e) {
    // ApiError: "Ledger code already exists" (400)
}

// 5. Imbalanced entries
if (totalDebit !== totalCredit) {
    throw new ApiError("Entries must balance (Dr = Cr)", 400);
}
```

---

## File Structure

```
src/modules/
├── accounting/
│   └── ledger/
│       ├── ledger.service.ts          ✅ FIXED
│       ├── ledger.controller.ts
│       └── ledger.routes.ts
│
├── purchase/
│   ├── purchase.service.ts            🔄 TO UPDATE (approvePurchase)
│   ├── purchase.controller.ts
│   └── purchase.routes.ts
│
└── sales/
    ├── sales.service.ts               🔄 TO UPDATE (approveSale)
    ├── sales.controller.ts
    └── sales.routes.ts

Documents/
├── LEDGER_SERVICE_FIXED.md            ✅ NEW
├── VOUCHERSERVICE_IMPLEMENTATION.md   ✅ NEW
└── LEDGER_SERVICE_QUICK_REFERENCE.md  ✅ THIS FILE
```

---

## Testing Checklist

### Unit Tests

- [ ] `getOrCreateLedger()` creates new VENDOR ledger
- [ ] `getOrCreateLedger()` returns existing VENDOR ledger on second call
- [ ] `getOrCreateLedger()` auto-generates unique codes
- [ ] `getOrCreateLedger()` with different branches returns SAME product ledger
- [ ] `updateBalance()` correctly DEBIT (+=) vs CREDIT (-=)
- [ ] `validateLedger()` throws on inactive ledger
- [ ] `validateLedger()` works inside transaction

### Integration Tests

- [ ] `approvePurchase()` creates all required ledgers
- [ ] `approvePurchase()` creates ledger entries with correct Dr/Cr
- [ ] `approvePurchase()` updates inventory batch and branch total
- [ ] `approvePurchase()` validates debit = credit
- [ ] `approveSale()` follows same pattern

### Multi-Branch Scenarios

- [ ] Purchase in Branch-A, Sale in Branch-B → Same product ledger
- [ ] Product ledger balance = total stock across all branches
- [ ] Multiple vendors, same agency → Separate ledgers

### Error Scenarios

- [ ] Missing ledger throws 404
- [ ] Imbalanced entries throws 400
- [ ] Duplicate code throws 400
- [ ] Inactive ledger throws 400

---

## Quick Links

- **LedgerService Code**: [ledger.service.ts](src/modules/accounting/ledger/ledger.service.ts)
- **Detailed Guide**: [LEDGER_SERVICE_FIXED.md](LEDGER_SERVICE_FIXED.md)
- **Implementation Pattern**: [VOUCHERSERVICE_IMPLEMENTATION.md](VOUCHERSERVICE_IMPLEMENTATION.md)
- **Schema**: [schema.prisma](prisma/schema.prisma) - See LedgerType, EntryType enums

---

## Next Immediate Steps

1. **Update purchase.service.ts**
   - Implement `approvePurchase()` using LedgerService
   - Reference: VOUCHERSERVICE_IMPLEMENTATION.md

2. **Update sales.service.ts**
   - Implement `approveSale()` using LedgerService
   - Reference: VOUCHERSERVICE_IMPLEMENTATION.md

3. **Create payment module**
   - Implement `createPayment()` for transaction allocation
   - Link payments to Sales/Purchase

4. **Write tests**
   - Unit tests for LedgerService
   - Integration tests for Purchase/Sale approval

5. **Documentation**
   - Add API documentation
   - Add example API requests/responses

