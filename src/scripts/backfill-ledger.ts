// scripts/accounting-sync.ts


import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

async function syncSales() {
    const sales = await prisma.sale.findMany({
        where: {
            status: "APPROVED"
        },
        select: {
            id: true,
            invoiceNo: true
        }
    });

    console.log(`Sales Found: ${sales.length}`);

    for (const sale of sales) {

        const exists =
            await prisma.voucher.findFirst({
                where: {
                    sourceId: sale.id,
                    voucherType: VoucherType.SALE
                }
            });

        if (exists) {
            continue;
        }

        await prisma.$transaction(async tx => {
            await LedgerService.postSaleApproval(
                tx,
                sale.id
            );
        });

        console.log(`✓ Sale ${sale.invoiceNo}`);
    }
}

async function syncPurchases() {

    const purchases =
        await prisma.purchase.findMany({
            where: {
                status: "APPROVED"
            },
            select: {
                id: true,
                invoiceNo: true
            }
        });

    console.log(`Purchases Found: ${purchases.length}`);

    for (const purchase of purchases) {

        const exists =
            await prisma.voucher.findFirst({
                where: {
                    sourceId: purchase.id,
                    voucherType: VoucherType.PURCHASE
                }
            });

        if (exists) {
            continue;
        }

        await prisma.$transaction(async tx => {
            await LedgerService.postPurchaseApproval(
                tx,
                purchase.id
            );
        });

        console.log(`✓ Purchase ${purchase.invoiceNo}`);
    }
}

async function syncTransactions() {

    const transactions =
        await prisma.transaction.findMany({
            where: {
                status: "APPROVED"
            },
            select: {
                id: true,
                transactionNo: true
            }
        });

    console.log(`Transactions Found: ${transactions.length}`);

    for (const transaction of transactions) {

        const exists =
            await prisma.voucher.findFirst({
                where: {
                    sourceId: transaction.id
                }
            });

        if (exists) {
            continue;
        }

        await prisma.$transaction(async tx => {
            await LedgerService.postTransactionApproval(
                tx,
                transaction.id
            );
        });

        console.log(`✓ Transaction ${transaction.transactionNo}`);
    }
}

async function rebuildAccounting() {

    console.log("Deleting Ledger Entries...");

    await prisma.ledgerEntry.deleteMany();

    console.log("Deleting Vouchers...");

    await prisma.voucher.deleteMany();

    console.log("Rebuilding Accounting...");
}

async function run() {

    const rebuild =
        process.argv.includes("--rebuild");

    console.log("");
    console.log("================================");
    console.log("ACCOUNTING SYNC");
    console.log("================================");
    console.log("");

    await LedgerService.ensureDefaultLedgerGroups(
        prisma
    );

    if (rebuild) {
        await rebuildAccounting();
    }

    await syncSales();

    await syncPurchases();

    await syncTransactions();

    console.log("");
    console.log("================================");
    console.log("ACCOUNTING COMPLETE");
    console.log("================================");
    console.log("");
}

run()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });