import "dotenv/config";
import {
    EntryType,
    LedgerType,
    TransactionDirection,
    TransactionStatus,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";
import { normalizeImportedTransactionType } from "../modules/import/transaction-import.utils";

/**
 * Classifies the sale settled by the specified receipt as SCRAP DRUMS.
 *
 * The receipt remains a RECEIPT and continues to credit the customer ledger.
 * The linked SALE voucher's sales line is moved to the typed SCRAP DRUMS
 * ledger, which is the amount shown under Scrap Drums in Trial Balance.
 *
 * Dry run:
 *   npm run repair:scrap-drums-receipt -- --transaction-id <uuid>
 * Apply:
 *   npm run repair:scrap-drums-receipt -- --transaction-id <uuid> --apply
 */

const DEFAULT_TRANSACTION_ID = "948e2896-4593-40e5-bce7-cdb63ccf9128";
const EXPECTED_AMOUNT = 190000;
const SCRAP_DRUMS = normalizeImportedTransactionType("SCRAP DRUMS");

const args = process.argv.slice(2);
const apply = args.includes("--apply");

function valueAfter(flag: string) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function money(value: unknown) {
    return Number(Number(value || 0).toFixed(2));
}

async function main() {
    const transactionId = valueAfter("--transaction-id") || DEFAULT_TRANSACTION_ID;

    const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
            sale: { select: { id: true, invoiceNo: true, status: true } },
            allocations: {
                select: {
                    sourceType: true,
                    saleId: true,
                    allocatedAmount: true,
                    sale: { select: { id: true, invoiceNo: true, status: true } }
                }
            },
            voucher: {
                select: { id: true, voucherNo: true, voucherType: true }
            }
        }
    });

    if (!transaction) throw new Error(`Transaction not found: ${transactionId}`);
    if (transaction.status !== TransactionStatus.APPROVED) {
        throw new Error(`Transaction is ${transaction.status}; only APPROVED receipts are supported`);
    }
    if (transaction.direction !== TransactionDirection.INWARD) {
        throw new Error("The target must be an inward receipt");
    }
    if (money(transaction.amount) !== EXPECTED_AMOUNT) {
        throw new Error(
            `Amount validation failed: expected ${EXPECTED_AMOUNT}, found ${money(transaction.amount)}`
        );
    }

    const receiptVouchers = transaction.voucher.filter(
        voucher => voucher.voucherType === VoucherType.RECEIPT
    );
    if (receiptVouchers.length !== 1) {
        throw new Error(
            `Expected exactly one RECEIPT voucher for the transaction; found ${receiptVouchers.length}`
        );
    }

    const saleIds = new Set<string>();
    if (transaction.sale?.id) saleIds.add(transaction.sale.id);
    for (const allocation of transaction.allocations) {
        if (allocation.sourceType === "SALE" && allocation.saleId) {
            saleIds.add(allocation.saleId);
        }
    }
    if (saleIds.size !== 1) {
        throw new Error(
            `Expected exactly one linked sale for Scrap Drums classification; found ${saleIds.size}`
        );
    }

    const saleId = [...saleIds][0];
    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        select: { id: true, invoiceNo: true, branchId: true, status: true }
    });
    if (!sale) throw new Error(`Linked sale not found: ${saleId}`);

    const saleVouchers = await prisma.voucher.findMany({
        where: { sourceId: sale.id, voucherType: VoucherType.SALE },
        select: { id: true, voucherNo: true },
        orderBy: { createdAt: "desc" }
    });
    if (saleVouchers.length !== 1) {
        throw new Error(
            `Expected exactly one SALE voucher for invoice ${sale.invoiceNo}; found ${saleVouchers.length}`
        );
    }

    const salesEntries = await prisma.ledgerEntry.findMany({
        where: {
            voucherId: saleVouchers[0].id,
            ledger: { category: LedgerType.SALES }
        },
        select: {
            id: true,
            entryType: true,
            amount: true,
            ledger: { select: { id: true, code: true, name: true } }
        }
    });
    const salesCredit = money(
        salesEntries
            .filter(entry => entry.entryType === EntryType.CREDIT)
            .reduce((sum, entry) => sum + money(entry.amount), 0)
    );
    const salesDebit = money(
        salesEntries
            .filter(entry => entry.entryType === EntryType.DEBIT)
            .reduce((sum, entry) => sum + money(entry.amount), 0)
    );
    if (salesCredit - salesDebit !== EXPECTED_AMOUNT) {
        throw new Error(
            `Linked SALE sales posting is ${salesCredit - salesDebit}, not ${EXPECTED_AMOUNT}; no changes made`
        );
    }

    const existingType = transaction.type
        ? normalizeImportedTransactionType(transaction.type)
        : null;
    const currentLedgers = [...new Set(salesEntries.map(entry => entry.ledger.name))];
    console.log(JSON.stringify({
        transactionId: transaction.id,
        transactionNo: transaction.transactionNo,
        amount: money(transaction.amount),
        receiptVoucher: receiptVouchers[0],
        sale: {
            id: sale.id,
            invoiceNo: sale.invoiceNo,
            voucher: saleVouchers[0],
            status: sale.status
        },
        existingTransactionType: existingType,
        currentSalesLedgers: currentLedgers,
        targetType: SCRAP_DRUMS,
        action: apply ? "classify-linked-sale" : "would-classify-linked-sale"
    }, null, 2));

    if (!apply) {
        console.log("Dry run only. Re-run with --apply to classify the linked sale.");
        return;
    }

    await prisma.$transaction(async tx => {
        await tx.transaction.update({
            where: { id: transaction.id },
            data: { type: SCRAP_DRUMS }
        });
        await LedgerService.assignSaleToImportedType(tx, sale.id, SCRAP_DRUMS);
    }, {
        maxWait: 120_000,
        timeout: 120_000
    });

    console.log(
        `Repaired ${transaction.transactionNo}: linked sale ${sale.invoiceNo} is now classified as ${SCRAP_DRUMS}.`
    );
    console.log(
        "The RECEIPT voucher and its M.N. Traders customer entry were not replaced or duplicated."
    );
}

main()
    .catch(error => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
