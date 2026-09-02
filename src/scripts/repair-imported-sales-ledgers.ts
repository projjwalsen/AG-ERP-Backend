import "dotenv/config";
import { TransactionDirection, TransactionStatus } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";
import { normalizeImportedTransactionType } from "../modules/import/transaction-import.utils";

/**
 * Backfills Type-based sales ledgers for imported inward receipts that were
 * approved before automatic sales-ledger classification was enabled.
 *
 * Dry run (default):
 *   npm run repair:imported-sales-ledgers
 *
 * Apply:
 *   npm run repair:imported-sales-ledgers -- --apply
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const branchIndex = args.indexOf("--branch");
const branchId = branchIndex >= 0 ? args[branchIndex + 1] : undefined;

async function main() {
    if (branchIndex >= 0 && !branchId) {
        throw new Error("--branch requires a branch UUID");
    }

    const transactions = await prisma.transaction.findMany({
        where: {
            status: TransactionStatus.APPROVED,
            direction: TransactionDirection.INWARD,
            saleId: { not: null },
            type: { not: null },
            ...(branchId ? { branchId } : {})
        },
        select: {
            id: true,
            saleId: true,
            type: true,
            transactionNo: true,
            sale: { select: { invoiceNo: true } }
        },
        orderBy: { createdAt: "asc" }
    });

    const bySale = new Map<string, {
        saleId: string;
        invoiceNo: string;
        type: string;
        transactionNos: string[];
    }>();

    for (const transaction of transactions) {
        if (!transaction.saleId || !transaction.sale) continue;

        const type = normalizeImportedTransactionType(transaction.type);
        if (!type) continue;

        const current = bySale.get(transaction.saleId);
        if (!current) {
            bySale.set(transaction.saleId, {
                saleId: transaction.saleId,
                invoiceNo: transaction.sale.invoiceNo,
                type,
                transactionNos: [transaction.transactionNo]
            });
            continue;
        }

        current.transactionNos.push(transaction.transactionNo);
        if (current.type !== type) {
            throw new Error(
                `Sale ${current.invoiceNo} has conflicting imported Types: ${current.type} and ${type}`
            );
        }
    }

    const candidates = [...bySale.values()];
    console.log(`Found ${candidates.length} imported sale(s) to classify.`);

    for (const candidate of candidates) {
        console.log(JSON.stringify({
            invoiceNo: candidate.invoiceNo,
            type: candidate.type,
            transactions: candidate.transactionNos,
            action: apply ? "classify" : "would-classify"
        }));
    }

    if (!apply) {
        console.log("Dry run only. Re-run with --apply to classify these sales.");
        return;
    }

    let classified = 0;
    const failures: Array<{ invoiceNo: string; error: string }> = [];

    for (const candidate of candidates) {
        try {
            await prisma.$transaction(async tx => {
                await LedgerService.assignSaleToImportedType(
                    tx,
                    candidate.saleId,
                    candidate.type
                );
            });
            classified += 1;
            console.log(`CLASSIFIED ${candidate.invoiceNo} AS ${candidate.type}`);
        } catch (error: any) {
            const message = error?.message || String(error);
            failures.push({ invoiceNo: candidate.invoiceNo, error: message });
            console.error(`FAILED ${candidate.invoiceNo}: ${message}`);
        }
    }

    console.log(JSON.stringify({
        found: candidates.length,
        classified,
        failed: failures.length,
        failures
    }, null, 2));

    if (failures.length > 0) process.exitCode = 1;
}

main()
    .catch(error => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
