import "dotenv/config";
import {
    TransactionStatus
} from "@prisma/client";
import { prisma } from "../config/db";
import { TransactionService } from "../modules/transaction/transac.service";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const transactionId = valueAfter("--transaction-id");
const transactionNo = valueAfter("--transaction-no");

// Stable business-date window: 2026-09-03 through 2026-09-04 in Asia/Kolkata.
const dayStart = new Date("2026-09-02T18:30:00.000Z");
const dayEnd = new Date("2026-09-03T18:30:00.000Z");

function valueAfter(flag: string) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function money(value: unknown) {
    return Number(Number(value || 0).toFixed(2));
}

async function main() {
    if (args.includes("--help")) {
        console.log(
            "Dry run: npm run repair:approved-transaction\n" +
            "Apply:   npm run repair:approved-transaction -- --apply\n" +
            "Confirm: npm run repair:approved-transaction -- --transaction-id <uuid> --apply"
        );
        return;
    }

    const matches = await prisma.transaction.findMany({
        where: {
            status: TransactionStatus.PENDING,
            transactionDate: { gte: dayStart, lt: dayEnd },
            ...(transactionId ? { id: transactionId } : {}),
            ...(transactionNo ? { transactionNo } : {})
        },
        include: {
            agency: { select: { name: true } },
            thirdPartyAgency: { select: { name: true } },
            bankAccount: { select: { bankName: true } },
            allocations: { select: { id: true } },
            voucher: { select: { id: true, voucherNo: true, voucherType: true } }
        },
        orderBy: { updatedAt: "asc" }
    });

    if (matches.length !== 1) {
        throw new Error(
            `Expected exactly one PENDING transaction in the requested window; found ${matches.length}. ` +
            "Use --transaction-id or --transaction-no to confirm the target."
        );
    }

    const transaction = matches[0];
    console.log(JSON.stringify({
        id: transaction.id,
        transactionNo: transaction.transactionNo,
        status: transaction.status,
        amount: money(transaction.amount),
        direction: transaction.direction,
        settlementType: transaction.settlementType,
        agency: transaction.agency?.name || null,
        thirdPartyAgency: transaction.thirdPartyAgency?.name || null,
        bank: transaction.bankAccount?.bankName || null,
        allocations: transaction.allocations.length,
        vouchers: transaction.voucher,
        action: apply ? "approve" : "would-approve"
    }, null, 2));

    if (!apply) {
        console.log("Dry run only. Re-run with --apply to approve this transaction.");
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
        select: { id: true, branchId: true, branchAccessType: true }
    });

    if (!approver) {
        throw new Error("No active user with TRANSACTION:APPROVE permission was found");
    }

    const repaired = await TransactionService.approveTransaction(
        approver,
        transaction.id,
        { allowImportOverSettlement: true, allowImportPartialSettlement: true }
    );

    console.log(`Approved ${repaired?.transactionNo || transaction.transactionNo}`);
}

main()
    .catch(error => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });