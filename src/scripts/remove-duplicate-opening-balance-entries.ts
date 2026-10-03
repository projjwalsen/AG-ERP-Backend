import "dotenv/config";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

/**
 * Finds and removes exact duplicate financial opening-balance postings.
 *
 * Preview (default):
 *   npm run remove:duplicate-opening-balances
 *
 * Apply:
 *   npm run remove:duplicate-opening-balances -- --apply
 *
 * Only journals linked to an OPENING_BALANCE voucher are considered. The
 * oldest row in each duplicate group is retained; its duplicate journal,
 * voucher, and voucher ledger entries are removed. No product movements,
 * ledger master opening fields, or non-opening vouchers are changed.
 */

const apply = process.argv.includes("--apply");

const normalize = (value: unknown) => String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

const openingPath = (value: unknown) => normalize(value)
    .replace(/^OPENING BALANCE IMPORT:\s*/, "")
    .split("|")[0]
    .trim();

type OpeningJournal = Awaited<ReturnType<typeof loadOpeningJournals>>[number];

async function loadOpeningJournals() {
    return prisma.journal.findMany({
        where: {
            voucher: { is: { voucherType: VoucherType.OPENING_BALANCE } }
        },
        include: {
            journalHead: { select: { ledgerId: true } },
            voucher: { include: { entries: { select: { ledgerId: true } } } }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
}

function duplicateKey(journal: OpeningJournal) {
    // The full imported account path plus the target ledger identify the
    // opening posting. Category names and dates are intentionally excluded:
    // older imports used different category names, and the same date can be
    // represented on either side of UTC depending on how it was imported.
    return [
        journal.branchId,
        journal.voucher?.entries[0]?.ledgerId || journal.journalHead.ledgerId,
        openingPath(journal.remarks),
        money(journal.amount),
        journal.direction || "",
        journal.voucher?.totalDebit ? money(journal.voucher.totalDebit) : 0,
        journal.voucher?.totalCredit ? money(journal.voucher.totalCredit) : 0
    ].join("|");
}

async function main() {
    const journals = await loadOpeningJournals();
    const groups = new Map<string, OpeningJournal[]>();
    for (const journal of journals) {
        const key = duplicateKey(journal);
        const group = groups.get(key) || [];
        group.push(journal);
        groups.set(key, group);
    }

    const duplicateGroups = [...groups.values()].filter(group => group.length > 1);
    const duplicates = duplicateGroups.flatMap(group => group.slice(1));
    const affectedLedgerIds = new Set<string>();
    for (const journal of duplicates) {
        affectedLedgerIds.add(journal.journalHead.ledgerId);
        for (const entry of journal.voucher?.entries || []) affectedLedgerIds.add(entry.ledgerId);
    }

    console.log(JSON.stringify({
        openingBalanceJournals: journals.length,
        duplicateGroups: duplicateGroups.length,
        duplicateJournals: duplicates.length,
        affectedLedgers: affectedLedgerIds.size,
        apply
    }, null, 2));

    for (const group of duplicateGroups) {
        const [keep, ...remove] = group;
        console.log(JSON.stringify({
            keep: { journalId: keep.id, voucherId: keep.voucherId, createdAt: keep.createdAt },
            remove: remove.map(journal => ({ journalId: journal.id, voucherId: journal.voucherId, createdAt: journal.createdAt })),
            remarks: keep.remarks,
            amount: money(keep.amount),
            direction: keep.direction
        }));
    }

    if (!apply) {
        console.log("Preview only. No database rows were changed. Re-run with --apply to delete the duplicate rows.");
        return;
    }

    await prisma.$transaction(async tx => {
        for (const journal of duplicates) {
            // Journal -> Voucher is not cascade-delete in the schema, so
            // unlink the journal before deleting its opening voucher.
            if (journal.voucherId) {
                await tx.journal.update({ where: { id: journal.id }, data: { voucherId: null } });
                await tx.ledgerEntry.deleteMany({ where: { voucherId: journal.voucherId } });
                await tx.voucher.delete({ where: { id: journal.voucherId } });
            }
            await tx.journal.delete({ where: { id: journal.id } });
        }

        for (const ledgerId of affectedLedgerIds) {
            await LedgerService.syncCachedBalance(tx, ledgerId);
        }
    });

    console.log(`Deleted ${duplicates.length} duplicate opening-balance journal(s) in ${duplicateGroups.length} group(s).`);
}

main()
    .catch(error => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
