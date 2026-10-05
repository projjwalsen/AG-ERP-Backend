import "dotenv/config";
import { EntryType, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const AGENCY_ID = "22b5cba3-e2db-4aa4-98bd-51153c52fd80";
const LEDGER_ID = "7d033ea3-2b79-4138-86bd-4a9a40d643d8";
const INVOICE_NO = "APM/G2526/0429";
const AMOUNT = 543_602;

async function main() {
    const result = await prisma.$transaction(async tx => {
        const [agency, targetLedger, sale] = await Promise.all([
            tx.agency.findUnique({ where: { id: AGENCY_ID }, select: { id: true, name: true } }),
            tx.ledger.findUnique({ where: { id: LEDGER_ID }, select: { id: true, name: true, category: true, branchId: true, agencyId: true } }),
            tx.sale.findUnique({ where: { invoiceNo: INVOICE_NO }, select: { id: true, agencyId: true, branchId: true, grandTotal: true, status: true, agency: { select: { name: true } } } })
        ]);
        if (!agency || agency.name !== "SWARAJYA INFRAPROJECT PRIVATE LIMITED DRS" ||
            !targetLedger || targetLedger.agencyId !== agency.id || targetLedger.branchId !== BRANCH_ID || targetLedger.category !== "CUSTOMER" ||
            !sale || sale.branchId !== BRANCH_ID || Number(sale.grandTotal) !== AMOUNT || sale.status !== "APPROVED") {
            throw new Error("Agency, debtor ledger, or approved sale validation failed; nothing was changed.");
        }

        const vouchers = await tx.voucher.findMany({
            where: { sourceId: sale.id, branchId: BRANCH_ID, voucherType: VoucherType.SALE },
            include: { entries: { include: { ledger: { select: { id: true, name: true, category: true } } } } }
        });
        if (vouchers.length !== 1) throw new Error(`Expected exactly one SALE voucher for ${INVOICE_NO}; found ${vouchers.length}. Nothing was changed.`);
        const voucher = vouchers[0];
        const targetPosting = voucher.entries.filter(entry => entry.ledgerId === LEDGER_ID && entry.entryType === EntryType.DEBIT && Number(entry.amount) === AMOUNT);
        if (targetPosting.length === 1) return { action: "already-linked", voucherNo: voucher.voucherNo, agency: agency.name, ledger: targetLedger.name };
        if (targetPosting.length > 1) throw new Error("Multiple target debtor postings already exist; nothing was changed.");

        const candidateEntries = voucher.entries.filter(entry =>
            entry.entryType === EntryType.DEBIT && Number(entry.amount) === AMOUNT && entry.ledger.category === "CUSTOMER"
        );
        if (candidateEntries.length !== 1) throw new Error(`Expected one matching customer debit posting; found ${candidateEntries.length}. Nothing was changed.`);

        const posting = candidateEntries[0];
        await tx.ledgerEntry.update({ where: { id: posting.id }, data: { ledgerId: LEDGER_ID } });
        await Promise.all([
            LedgerService.syncCachedBalance(tx, posting.ledgerId),
            LedgerService.syncCachedBalance(tx, LEDGER_ID)
        ]);
        return {
            action: "linked",
            voucherNo: voucher.voucherNo,
            invoiceNo: INVOICE_NO,
            date: voucher.voucherDate,
            amount: AMOUNT,
            fromLedger: posting.ledger.name,
            toLedger: targetLedger.name,
            saleAgency: sale.agency.name,
            targetAgency: agency.name
        };
    }, { maxWait: 60_000, timeout: 5 * 60_000 });
    console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
