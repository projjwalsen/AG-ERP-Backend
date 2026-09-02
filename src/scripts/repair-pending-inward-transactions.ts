import "dotenv/config";
import {
    TransactionDirection,
    TransactionStatus,
    SettlementType
} from "@prisma/client";
import { prisma } from "../config/db";
import { TransactionService } from "../modules/transaction/transac.service";

/**
 * Repairs pending inward invoice settlements by using the normal transaction
 * approval path. This keeps settlement allocations, bank/customer vouchers,
 * cached balances, and Trial Balance movements consistent.
 *
 * Dry run (default; imported inward transactions only):
 *   npm run repair:pending-inward-transactions
 *
 * Restrict to one branch:
 *   npm run repair:pending-inward-transactions -- --branch <uuid>
 *
 * Include non-imported pending inward invoice settlements:
 *   npm run repair:pending-inward-transactions -- --all --apply
 *
 * Apply imported repairs:
 *   npm run repair:pending-inward-transactions -- --apply
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeAll = args.includes("--all");
const branchIndex = args.indexOf("--branch");
const branchId = branchIndex >= 0 ? args[branchIndex + 1] : undefined;

const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

async function main() {
    if (branchIndex >= 0 && !branchId) {
        throw new Error("--branch requires a branch UUID");
    }

    const pending = await prisma.transaction.findMany({
        where: {
            status: TransactionStatus.PENDING,
            direction: TransactionDirection.INWARD,
            settlementType: SettlementType.INVOICE_TO_INVOICE,
            saleId: { not: null },
            debitCreditNoteId: null,
            ...(branchId ? { branchId } : {}),
            ...(!includeAll
                ? {
                    OR: [
                        { type: { not: null } },
                        { importKey: { not: null } }
                    ]
                }
                : {})
        },
        include: {
            agency: { select: { name: true } },
            sale: { select: { invoiceNo: true } },
            bankAccount: { select: { bankName: true } }
        },
        orderBy: [
            { transactionDate: "asc" },
            { createdAt: "asc" }
        ]
    });

    console.log(`Found ${pending.length} pending inward transaction(s).`);

    if (pending.length === 0) return;

    for (const transaction of pending) {
        console.log(JSON.stringify({
            id: transaction.id,
            transactionNo: transaction.transactionNo,
            invoiceNo: transaction.sale?.invoiceNo || null,
            customer: transaction.agency?.name || null,
            branchId: transaction.branchId,
            amount: money(transaction.amount),
            type: transaction.type || null,
            bank: transaction.bankAccount?.bankName || null,
            importKey: transaction.importKey || null,
            action: apply ? "approve" : "would-approve"
        }));
    }

    if (!apply) {
        console.log("Dry run only. Re-run with --apply to approve these transactions.");
        return;
    }

    const approver = await prisma.user.findFirst({
        where: {
            isActive: true,
            status: "ACTIVE",
            userRoles: {
                some: {
                    role: {
                        isActive: true,
                        rolePermissions: {
                            some: {
                                permission: {
                                    key: "TRANSACTION:APPROVE",
                                    isActive: true
                                }
                            }
                        }
                    }
                }
            }
        },
        select: {
            id: true,
            branchId: true,
            branchAccessType: true
        }
    });

    if (!approver) {
        throw new Error(
            "No active user with TRANSACTION:APPROVE permission was found"
        );
    }

    let approved = 0;
    const failures: Array<{ transactionNo: string; error: string }> = [];

    for (const transaction of pending) {
        try {
            await TransactionService.approveTransaction(
                approver,
                transaction.id,
                { allowImportPartialSettlement: true }
            );
            approved += 1;
            console.log(`APPROVED ${transaction.transactionNo}`);
        } catch (error: any) {
            const message = error?.message || String(error);
            failures.push({
                transactionNo: transaction.transactionNo,
                error: message
            });
            console.error(`FAILED ${transaction.transactionNo}: ${message}`);
        }
    }

    console.log(JSON.stringify({
        found: pending.length,
        approved,
        failed: failures.length,
        failures
    }, null, 2));

    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main()
    .catch(error => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
