import "dotenv/config";
import { JournalHeadType, Prisma } from "@prisma/client";
import { prisma } from "../config/db";

const TARGET_AMOUNT = new Prisma.Decimal("70312.50");
const TARGET_NAME = "AIRCONDITIONEROFFICE";
const apply = process.argv.includes("--apply");

function normalize(value: unknown) {
    return String(value || "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase();
}

function money(value: unknown) {
    return Number(Number(value || 0).toFixed(2));
}

async function main() {
    const journals = await prisma.journal.findMany({
        where: {
            amount: TARGET_AMOUNT,
            journalHead: {
                type: JournalHeadType.INWARD
            }
        },
        include: {
            journalHead: {
                include: {
                    ledger: {
                        include: { group: true }
                    }
                }
            },
            voucher: {
                include: {
                    entries: {
                        include: { ledger: true }
                    }
                }
            }
        },
        orderBy: [
            { createdAt: "asc" },
            { id: "asc" }
        ]
    });

    const matches = journals.filter(journal =>
        normalize(journal.journalHead.name) === TARGET_NAME ||
        normalize(journal.journalHead.ledger.name) === TARGET_NAME
    );

    if (matches.length !== 2) {
        throw new Error(
            `Expected exactly two matching INWARD AirConditioner Office journals for ` +
            `INR ${money(TARGET_AMOUNT)}; found ${matches.length}. ` +
            "The script refuses to delete anything unless the duplicate pair is unambiguous."
        );
    }

    const keep = matches[0];
    const remove = matches[1];

    const preview = {
        amount: money(TARGET_AMOUNT),
        keep: {
            journalId: keep.id,
            journalHead: keep.journalHead.name,
            ledger: keep.journalHead.ledger.name,
            status: keep.status,
            createdAt: keep.createdAt,
            voucherId: keep.voucherId,
            voucherNo: keep.voucher?.voucherNo || null
        },
        remove: {
            journalId: remove.id,
            journalHead: remove.journalHead.name,
            ledger: remove.journalHead.ledger.name,
            status: remove.status,
            createdAt: remove.createdAt,
            voucherId: remove.voucherId,
            voucherNo: remove.voucher?.voucherNo || null,
            ledgerEntries: remove.voucher?.entries.map(entry => ({
                id: entry.id,
                ledger: entry.ledger.name,
                entryType: entry.entryType,
                amount: money(entry.amount)
            })) || []
        },
        action: apply ? "delete-newer-duplicate" : "would-delete-newer-duplicate",
        dryRun: !apply
    };

    if (!apply) {
        console.log(JSON.stringify(preview, null, 2));
        console.log(
            "Dry run only. Re-run with --apply after verifying the journal and voucher IDs."
        );
        return;
    }

    await prisma.$transaction(async tx => {
        const current = await tx.journal.findUnique({
            where: { id: remove.id },
            select: { id: true, voucherId: true }
        });

        if (!current) {
            throw new Error(`Journal ${remove.id} no longer exists`);
        }

        await tx.journal.delete({ where: { id: current.id } });

        if (!current.voucherId) return;

        const voucherReferences = await tx.voucher.findUnique({
            where: { id: current.voucherId },
            select: {
                journals: { select: { id: true }, take: 1 },
                transaction: { select: { id: true }, take: 1 },
                debitCreditNotes: { select: { id: true }, take: 1 },
                manufactures: { select: { id: true }, take: 1 }
            }
        });

        // Only remove the voucher and its LedgerEntry rows when this voucher
        // is exclusive to the duplicate Journal. Never damage a shared source.
        if (
            voucherReferences &&
            voucherReferences.journals.length === 0 &&
            voucherReferences.transaction.length === 0 &&
            voucherReferences.debitCreditNotes.length === 0 &&
            voucherReferences.manufactures.length === 0
        ) {
            await tx.ledgerEntry.deleteMany({
                where: { voucherId: current.voucherId }
            });
            await tx.voucher.delete({
                where: { id: current.voucherId }
            });
        }
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify({
        ...preview,
        deletedJournalId: remove.id,
        deletedVoucherId: remove.voucherId || null,
        dryRun: false
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
