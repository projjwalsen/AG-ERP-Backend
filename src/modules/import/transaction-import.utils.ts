import {
    DebitCreditNoteType,
    EntryType,
    TransactionDirection
} from "@prisma/client";
import { createHash } from "crypto";

export const normalizeImportedTransactionType = (value: unknown) =>
    String(value || "")
        .replace(/_/g, " ")
        .replace(/\bSALE\b/gi, "SALES")
        .replace(/\s*@\s*/g, " @")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

export const normalizeImportedPartyName = (value: unknown) =>
    String(value || "")
        .replace(/\s*\(?DRS?\.?\)?\s*$/i, "")
        .replace(/\s+(?:-\s*)?CRS?\s*$/i, "")
        .replace(/[^A-Z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

export const buildTransactionImportKey = (...parts: unknown[]) =>
    createHash("sha256")
        .update(parts.map(part => String(part ?? "").trim()).join("|"))
        .digest("hex");

export const importedPurchaseNotePosting = (
    noteType: DebitCreditNoteType
) => noteType === DebitCreditNoteType.DEBIT_NOTE
    ? {
        direction: TransactionDirection.INWARD,
        noteVendorEntryType: EntryType.DEBIT,
        purchaseEntryType: EntryType.CREDIT,
        bankEntryType: EntryType.DEBIT,
        settlementVendorEntryType: EntryType.CREDIT
    }
    : {
        direction: TransactionDirection.OUTWARD,
        noteVendorEntryType: EntryType.CREDIT,
        purchaseEntryType: EntryType.DEBIT,
        bankEntryType: EntryType.CREDIT,
        settlementVendorEntryType: EntryType.DEBIT
    };
