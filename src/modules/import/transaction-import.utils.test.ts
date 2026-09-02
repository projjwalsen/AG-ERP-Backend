import assert from "node:assert/strict";
import test from "node:test";
import {
    DebitCreditNoteType,
    EntryType,
    TransactionDirection
} from "@prisma/client";
import {
    buildTransactionImportKey,
    importedPurchaseNotePosting,
    normalizeImportedPartyName,
    normalizeImportedTransactionType
} from "./transaction-import.utils";

test("Excel Type values normalize to one Purchase Account head", () => {
    assert.equal(
        normalizeImportedTransactionType("  igst___purchase  "),
        "IGST PURCHASE"
    );
});

test("vendor suffixes do not break Purchase invoice matching", () => {
    assert.equal(
        normalizeImportedPartyName("GLOBAL IMPEX - CR"),
        normalizeImportedPartyName("Global Impex")
    );
    assert.equal(
        normalizeImportedPartyName("DARSHIL PETROCHEM CRS"),
        normalizeImportedPartyName("Darshil Petrochem")
    );
});

test("Inward Debit Note credits Purchase and debits Bank of Maharashtra", () => {
    assert.deepEqual(
        importedPurchaseNotePosting(DebitCreditNoteType.DEBIT_NOTE),
        {
            direction: TransactionDirection.INWARD,
            noteVendorEntryType: EntryType.DEBIT,
            purchaseEntryType: EntryType.CREDIT,
            bankEntryType: EntryType.DEBIT,
            settlementVendorEntryType: EntryType.CREDIT
        }
    );
});

test("Inward Credit Note debits Purchase and credits Bank of Maharashtra", () => {
    assert.deepEqual(
        importedPurchaseNotePosting(DebitCreditNoteType.CREDIT_NOTE),
        {
            direction: TransactionDirection.OUTWARD,
            noteVendorEntryType: EntryType.CREDIT,
            purchaseEntryType: EntryType.DEBIT,
            bankEntryType: EntryType.CREDIT,
            settlementVendorEntryType: EntryType.DEBIT
        }
    );
});

test("import keys are stable but preserve same voucher numbers for different vendors", () => {
    const first = buildTransactionImportKey(
        "PURCHASE_NOTE",
        "branch-1",
        "vendor-1",
        "PDN/M/2526/062",
        "2026-02-28",
        3715
    );
    const repeated = buildTransactionImportKey(
        "PURCHASE_NOTE",
        "branch-1",
        "vendor-1",
        "PDN/M/2526/062",
        "2026-02-28",
        3715
    );
    const otherVendor = buildTransactionImportKey(
        "PURCHASE_NOTE",
        "branch-1",
        "vendor-2",
        "PDN/M/2526/062",
        "2026-03-02",
        577500
    );

    assert.equal(first, repeated);
    assert.notEqual(first, otherVendor);
});
