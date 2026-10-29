import "dotenv/config";
import { JournalStatus, PaymentMode } from "@prisma/client";
import { prisma } from "../config/db";

const apply = process.argv.includes("--apply");

const ORPHANS = [
    { voucherId: "2594c2e0-0f30-46f7-abdb-f9c290f3be01", voucherNo: "289", amount: 213527.40, ledgerId: "03f0fd66-3ebe-4893-8685-e20ce52a8889", account: "Interest on Term Loan Yes Bank" },
    { voucherId: "aa38fac6-bc95-428f-826c-caa29f893c0a", voucherNo: "1", amount: 161986.30, ledgerId: "03f0fd66-3ebe-4893-8685-e20ce52a8889", account: "Interest on Term Loan Yes Bank" },
    { voucherId: "46c8ff9b-b68f-4518-8f8e-4daafed4d82b", voucherNo: "3089", amount: 2, ledgerId: "e1e6491f-1504-4aed-a738-68e8adae7503", account: "R/OFF" }
];

async function main() {
    const actor = await prisma.user.findFirst({ where: { email: "admin@ashtavinayaka.com" }, select: { id: true } });
    if (!actor) throw new Error("admin missing");
    const inspected = [];
    for (const row of ORPHANS) {
        const voucher = await prisma.voucher.findUnique({
            where: { id: row.voucherId },
            select: {
                id: true,
                voucherNo: true,
                voucherType: true,
                voucherDate: true,
                branchId: true,
                journals: { select: { id: true } },
                entries: { select: { ledgerId: true, amount: true, entryType: true } }
            }
        });
        const head = await prisma.journalHead.findFirst({
            where: { ledgerId: row.ledgerId, name: { equals: row.account, mode: "insensitive" } }
        });
        inspected.push({
            ...row,
            found: Boolean(voucher),
            type: voucher?.voucherType,
            date: voucher?.voucherDate,
            branchId: voucher?.branchId,
            journalCount: voucher?.journals.length || 0,
            headId: head?.id || null
        });
    }
    console.log(JSON.stringify({ dryRun: !apply, inspected }, null, 2));
    if (!apply) return;
    if (inspected.some(row => !row.found || row.journalCount > 0 || !row.headId || !row.branchId || !row.date)) {
        throw new Error("Refusing to attach journals; inspect failed");
    }
    const created = [];
    for (const row of inspected) {
        const existing = await prisma.journal.findUnique({
            where: { importKey: `IE-PDF-ATTACH-${row.voucherNo}-${row.voucherId.slice(0, 8)}` }
        });
        if (existing) {
            created.push({ voucherNo: row.voucherNo, status: "skipped", journalId: existing.id });
            continue;
        }
        const journal = await prisma.journal.create({
            data: {
                branchId: row.branchId!,
                journalHeadId: row.headId!,
                importKey: `IE-PDF-ATTACH-${row.voucherNo}-${row.voucherId.slice(0, 8)}`,
                voucherNo: row.voucherNo,
                sourceSheet: "Indirect Expenses PDF",
                amount: row.amount,
                paymentMode: PaymentMode.OFFLINE,
                remarks: `Attach approved journal so Trial Balance includes existing IE voucher ${row.voucherNo}`,
                journalDate: row.date!,
                status: JournalStatus.APPROVED,
                voucherId: row.voucherId,
                createdById: actor.id,
                approvedById: actor.id,
                approvedAt: new Date()
            }
        });
        created.push({ voucherNo: row.voucherNo, status: "created", journalId: journal.id, amount: row.amount });
    }
    console.log(JSON.stringify({ created }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
