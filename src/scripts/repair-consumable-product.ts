import "dotenv/config";
import { EntryType, LedgerNature, LedgerType } from "@prisma/client";
import { prisma } from "../config/db";

/**
 * Groups the existing DRUM and CHEMICAL PURCHASE ledgers under the
 * CONSUMABLE_PRODUCT Trial Balance header.
 *
 * This script does not create artificial debit/credit postings. It validates
 * the existing cumulative ledger entries first, then only changes the ledger
 * group. The Trial Balance report supplies the cumulative header total.
 *
 * Dry run:
 *   npm run repair:consumable-product
 * Apply:
 *   npm run repair:consumable-product -- --apply
 */

const EXPECTED_DRUM_CREDIT = 20160;
const EXPECTED_CHEMICAL_DEBIT = 252486;
const GROUP_CODE = "CONSUMABLE_PRODUCT";
const GROUP_NAME = "Consumable Product";

const apply = process.argv.includes("--apply");

const money = (value: unknown) =>
    Math.round(Number(value || 0) * 100) / 100;

const normalized = (value: unknown) =>
    String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

const withoutBranchSuffix = (value: string) =>
    value.replace(/\s+-\s+[^-]+$/, "").trim();

async function main() {
    const ledgers = await prisma.ledger.findMany({
        where: { isActive: true },
        select: {
            id: true,
            code: true,
            name: true,
            category: true,
            groupId: true,
            group: { select: { code: true, name: true } }
        },
        orderBy: { name: "asc" }
    });

    const drumLedgers = ledgers.filter(ledger => {
        const name = withoutBranchSuffix(normalized(ledger.name));
        const code = normalized(ledger.code);
        return (name === "DRUM" || name === "DRUMS") &&
            ledger.category === LedgerType.SALES &&
            code.includes("DRUM");
    });
    const chemicalLedgers = ledgers.filter(ledger => {
        const name = withoutBranchSuffix(normalized(ledger.name));
        return name === "CHEMICAL PURCHASE" &&
            ledger.category === LedgerType.PURCHASE;
    });

    if (drumLedgers.length !== 1) {
        throw new Error(
            `Expected exactly one active DRUM sales ledger; found ${drumLedgers.length}: ` +
            drumLedgers.map(ledger => `${ledger.id} (${ledger.name})`).join(", ")
        );
    }
    if (chemicalLedgers.length !== 1) {
        throw new Error(
            `Expected exactly one active CHEMICAL PURCHASE ledger; found ${chemicalLedgers.length}: ` +
            chemicalLedgers.map(ledger => `${ledger.id} (${ledger.name})`).join(", ")
        );
    }

    const targetLedgers = [drumLedgers[0], chemicalLedgers[0]];
    const entries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: targetLedgers.map(ledger => ledger.id) } },
        select: { ledgerId: true, entryType: true, amount: true }
    });

    const totals = new Map<string, { debit: number; credit: number }>();
    for (const ledger of targetLedgers) {
        totals.set(ledger.id, { debit: 0, credit: 0 });
    }
    for (const entry of entries) {
        const total = totals.get(entry.ledgerId)!;
        total[entry.entryType === EntryType.DEBIT ? "debit" : "credit"] +=
            money(entry.amount);
    }

    const drumTotal = totals.get(drumLedgers[0].id)!;
    const chemicalTotal = totals.get(chemicalLedgers[0].id)!;
    if (
        money(drumTotal.debit) !== 0 ||
        money(drumTotal.credit) !== EXPECTED_DRUM_CREDIT
    ) {
        throw new Error(
            `DRUM ledger total mismatch: expected Debit 0 / Credit ${EXPECTED_DRUM_CREDIT}, ` +
            `found Debit ${money(drumTotal.debit)} / Credit ${money(drumTotal.credit)}`
        );
    }
    if (
        money(chemicalTotal.debit) !== EXPECTED_CHEMICAL_DEBIT ||
        money(chemicalTotal.credit) !== 0
    ) {
        throw new Error(
            `CHEMICAL PURCHASE ledger total mismatch: expected Debit ${EXPECTED_CHEMICAL_DEBIT} / Credit 0, ` +
            `found Debit ${money(chemicalTotal.debit)} / Credit ${money(chemicalTotal.credit)}`
        );
    }

    const result = {
        action: apply ? "move-ledgers-to-consumable-product" : "would-move-ledgers-to-consumable-product",
        group: GROUP_NAME,
        cumulative: {
            debit: EXPECTED_CHEMICAL_DEBIT,
            credit: EXPECTED_DRUM_CREDIT,
            closingDebit: EXPECTED_CHEMICAL_DEBIT - EXPECTED_DRUM_CREDIT
        },
        ledgers: targetLedgers.map(ledger => ({
            id: ledger.id,
            name: ledger.name,
            category: ledger.category,
            currentGroup: ledger.group,
            debit: totals.get(ledger.id)!.debit,
            credit: totals.get(ledger.id)!.credit
        }))
    };
    console.log(JSON.stringify(result, null, 2));

    if (!apply) {
        console.log("Dry run only. Re-run with --apply to move the ledgers.");
        return;
    }

    await prisma.$transaction(async tx => {
        const purchaseAccounts = await tx.ledgerGroup.findUnique({
            where: { code: "PURCHASE_ACCOUNTS" }
        });
        if (!purchaseAccounts) {
            throw new Error("PURCHASE_ACCOUNTS group does not exist");
        }

        const consumableGroup = await tx.ledgerGroup.upsert({
            where: { code: GROUP_CODE },
            update: {
                name: GROUP_NAME,
                parentId: purchaseAccounts.id,
                nature: LedgerNature.DEBIT
            },
            create: {
                code: GROUP_CODE,
                name: GROUP_NAME,
                parentId: purchaseAccounts.id,
                nature: LedgerNature.DEBIT
            }
        });

        await tx.ledger.updateMany({
            where: { id: { in: targetLedgers.map(ledger => ledger.id) } },
            data: { groupId: consumableGroup.id, isActive: true }
        });
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(
        `Moved DRUM and CHEMICAL PURCHASE under ${GROUP_NAME}. ` +
        `Cumulative Debit ${EXPECTED_CHEMICAL_DEBIT}, Credit ${EXPECTED_DRUM_CREDIT}, ` +
        `Closing Debit ${EXPECTED_CHEMICAL_DEBIT - EXPECTED_DRUM_CREDIT}.`
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
