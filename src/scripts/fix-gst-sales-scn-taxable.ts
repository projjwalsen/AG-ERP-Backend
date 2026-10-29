import "dotenv/config";
import { EntryType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const apply = process.argv.includes("--apply");

const FIXES = [
    {
        noteNo: "SCN/M/2526/006",
        gstSalesEntryId: "6c372d87-8be4-4be0-a0a5-39101a70e136",
        customerEntryId: "673c67ec-6d29-4717-8305-d16ab4f3e8a5",
        voucherId: "66ec3fd3-10ca-4707-95af-88c07c3ae60d",
        from: 10572800,
        to: 8960000
    },
    {
        noteNo: "SCN/M/2526/007",
        gstSalesEntryId: "affb2fd1-bfb7-4b4e-863e-eedf1a7d49eb",
        customerEntryId: "6599a970-c8a5-4836-95eb-52af7db2284f",
        voucherId: "5984f1d6-6f83-4378-80cb-1fcc132ee245",
        from: 12083200,
        to: 10240000
    }
];

async function main() {
    const inspected = [];
    for (const row of FIXES) {
        const gst = await prisma.ledgerEntry.findUnique({
            where: { id: row.gstSalesEntryId },
            select: { id: true, amount: true, entryType: true, ledger: { select: { name: true, code: true } }, voucherId: true }
        });
        const customer = await prisma.ledgerEntry.findUnique({
            where: { id: row.customerEntryId },
            select: { id: true, amount: true, entryType: true, ledger: { select: { name: true } }, voucherId: true }
        });
        inspected.push({
            ...row,
            gstOk: gst?.voucherId === row.voucherId && Number(gst.amount) === row.from && gst.entryType === EntryType.DEBIT && gst.ledger.code?.startsWith("SALES-TYPE-GST_SALES"),
            customerOk: customer?.voucherId === row.voucherId && Number(customer.amount) === row.from && customer.entryType === EntryType.CREDIT,
            gstAmount: gst ? Number(gst.amount) : null,
            customerAmount: customer ? Number(customer.amount) : null
        });
    }
    console.log(JSON.stringify({ dryRun: !apply, inspected, addCredit: Number(FIXES.reduce((s, r) => s + (r.from - r.to), 0).toFixed(2)) }, null, 2));
    if (!apply) return;
    if (inspected.some(row => !row.gstOk || !row.customerOk)) throw new Error("Refusing to change unmatched SCN entries");

    const ledgerIds = new Set<string>();
    for (const row of FIXES) {
        const gst = await prisma.ledgerEntry.update({
            where: { id: row.gstSalesEntryId },
            data: { amount: row.to },
            select: { ledgerId: true }
        });
        const customer = await prisma.ledgerEntry.update({
            where: { id: row.customerEntryId },
            data: { amount: row.to },
            select: { ledgerId: true }
        });
        await prisma.voucher.update({
            where: { id: row.voucherId },
            data: { totalDebit: row.to, totalCredit: row.to }
        });
        ledgerIds.add(gst.ledgerId);
        ledgerIds.add(customer.ledgerId);
    }
    for (const ledgerId of ledgerIds) await LedgerService.syncCachedBalance(prisma, ledgerId);
    console.log(JSON.stringify({ updated: FIXES.map(r => r.noteNo) }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
