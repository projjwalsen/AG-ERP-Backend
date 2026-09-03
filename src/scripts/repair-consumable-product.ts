import "dotenv/config";
import {
    EntryType,
    JournalHeadType,
    LedgerNature,
    LedgerType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

/**
 * Places Drum and Chemical Purchase under:
 *
 *   Expenses -> Direct Expense -> Consumable Product
 *
 * Drum is a credit-side journal head with a requested cumulative credit of
 * 20,160. Chemical Purchase is a debit-side account with a requested
 * cumulative debit of 252,486. Existing ledger entries are reused. If Drum
 * does not exist, its requested amount is stored as an opening credit because
 * no source voucher/counter-entry was supplied.
 *
 * Dry run:
 *   npm run repair:consumable-product
 * Apply:
 *   npm run repair:consumable-product -- --apply
 */

const DRUM_NAME = "Drum";
const DRUM_CODE = "DRUM";
const EXPECTED_DRUM_CREDIT = 20160;
const CHEMICAL_NAME = "CHEMICAL PURCHASE";
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

const readEntryTotals = async (client: any, ledgerId: string) => {
    const entries = await client.ledgerEntry.findMany({
        where: { ledgerId },
        select: { entryType: true, amount: true }
    });
    return entries.reduce(
        (total: { debit: number; credit: number }, entry: { entryType: EntryType; amount: unknown }) => {
            total[entry.entryType === EntryType.DEBIT ? "debit" : "credit"] +=
                money(entry.amount);
            return total;
        },
        { debit: 0, credit: 0 }
    );
};

async function main() {
    const result = await prisma.$transaction(async tx => {
        await LedgerService.ensureDefaultLedgerGroups(tx);

        const directExpense = await tx.ledgerGroup.findUnique({
            where: { code: "DIRECT_EXPENSE" }
        });
        if (!directExpense) {
            throw new Error("DIRECT_EXPENSE ledger group was not found");
        }

        const consumableProduct = await tx.ledgerGroup.upsert({
            where: { code: GROUP_CODE },
            update: {
                name: GROUP_NAME,
                parentId: directExpense.id,
                nature: LedgerNature.DEBIT
            },
            create: {
                code: GROUP_CODE,
                name: GROUP_NAME,
                parentId: directExpense.id,
                nature: LedgerNature.DEBIT
            }
        });

        const allLedgers = await tx.ledger.findMany({
            select: {
                id: true,
                code: true,
                name: true,
                category: true,
                openingDebit: true,
                openingCredit: true
            }
        });

        const drumCandidates = allLedgers.filter(ledger => {
            const name = withoutBranchSuffix(normalized(ledger.name));
            return name === "DRUM" || name === "DRUMS";
        });
        if (drumCandidates.length > 1) {
            throw new Error(
                `More than one Drum ledger exists: ${drumCandidates.map(item => item.id).join(", ")}`
            );
        }

        let drum = drumCandidates[0];
        let drumCreated = false;
        if (!drum) {
            drum = await tx.ledger.create({
                data: {
                    code: DRUM_CODE,
                    name: DRUM_NAME,
                    category: LedgerType.JOURNAL,
                    groupId: consumableProduct.id,
                    nature: LedgerNature.CREDIT,
                    openingCredit: EXPECTED_DRUM_CREDIT,
                    currentBalance: -EXPECTED_DRUM_CREDIT,
                    isActive: true
                }
            });
            drumCreated = true;
        }

        const chemicalCandidates = allLedgers.filter(ledger =>
            withoutBranchSuffix(normalized(ledger.name)) === CHEMICAL_NAME
        );
        if (chemicalCandidates.length > 1) {
            throw new Error(
                `More than one Chemical Purchase ledger exists: ${chemicalCandidates.map(item => item.id).join(", ")}`
            );
        }

        let chemical = chemicalCandidates[0];
        let chemicalCreated = false;
        if (!chemical) {
            chemical = await tx.ledger.create({
                data: {
                    code: "CHEMICAL-PURCHASE",
                    name: CHEMICAL_NAME,
                    category: LedgerType.JOURNAL,
                    groupId: consumableProduct.id,
                    nature: LedgerNature.DEBIT,
                    openingDebit: EXPECTED_CHEMICAL_DEBIT,
                    currentBalance: EXPECTED_CHEMICAL_DEBIT,
                    isActive: true
                }
            });
            chemicalCreated = true;
        }

        const drumEntries = drumCreated
            ? { debit: 0, credit: 0 }
            : await readEntryTotals(tx, drum.id);
        const chemicalEntries = chemicalCreated
            ? { debit: 0, credit: 0 }
            : await readEntryTotals(tx, chemical.id);
        const drumDebit = money(Number(drum.openingDebit || 0) + drumEntries.debit);
        const drumCredit = money(Number(drum.openingCredit || 0) + drumEntries.credit);
        const chemicalDebit = money(Number(chemical.openingDebit || 0) + chemicalEntries.debit);
        const chemicalCredit = money(Number(chemical.openingCredit || 0) + chemicalEntries.credit);

        const drumIsEmpty = drumDebit === 0 && drumCredit === 0;
        if (!drumIsEmpty && (drumDebit !== 0 || drumCredit !== EXPECTED_DRUM_CREDIT)) {
            throw new Error(
                `Drum balance mismatch: expected Debit 0 / Credit ${EXPECTED_DRUM_CREDIT}, ` +
                `found Debit ${drumDebit} / Credit ${drumCredit}`
            );
        }
        const chemicalIsEmpty = chemicalDebit === 0 && chemicalCredit === 0;
        if (!chemicalIsEmpty && (chemicalDebit !== EXPECTED_CHEMICAL_DEBIT || chemicalCredit !== 0)) {
            throw new Error(
                `Chemical Purchase balance mismatch: expected Debit ${EXPECTED_CHEMICAL_DEBIT}, ` +
                `found Debit ${chemicalDebit}`
            );
        }

        await tx.ledger.update({
            where: { id: drum.id },
            data: {
                name: DRUM_NAME,
                category: LedgerType.JOURNAL,
                groupId: consumableProduct.id,
                nature: LedgerNature.CREDIT,
                isActive: true,
                ...(drumIsEmpty
                    ? { openingCredit: EXPECTED_DRUM_CREDIT }
                    : {})
            }
        });
        await tx.ledger.update({
            where: { id: chemical.id },
            data: {
                name: CHEMICAL_NAME,
                category: LedgerType.JOURNAL,
                groupId: consumableProduct.id,
                nature: LedgerNature.DEBIT,
                isActive: true,
                ...(chemicalIsEmpty
                    ? { openingDebit: EXPECTED_CHEMICAL_DEBIT }
                    : {})
            }
        });

        const drumHeads = await tx.journalHead.findMany({
            where: { name: { equals: DRUM_NAME, mode: "insensitive" } }
        });
        if (drumHeads.length > 1) {
            throw new Error(`More than one JournalHead uses the name ${DRUM_NAME}`);
        }
        const drumHead = drumHeads[0]
            ? await tx.journalHead.update({
                where: { id: drumHeads[0].id },
                data: {
                    name: DRUM_NAME,
                    type: JournalHeadType.INWARD,
                    ledgerId: drum.id,
                    isActive: true
                }
            })
            : await tx.journalHead.create({
                data: {
                    name: DRUM_NAME,
                    type: JournalHeadType.INWARD,
                    ledgerId: drum.id
                }
            });

        await LedgerService.syncCachedBalance(tx, drum.id);
        await LedgerService.syncCachedBalance(tx, chemical.id);

        return {
            group: consumableProduct,
            drum,
            chemical,
            drumHead,
            drumCreated,
            chemicalCreated,
            drumDebit: drumIsEmpty ? 0 : drumDebit,
            drumCredit: drumIsEmpty ? EXPECTED_DRUM_CREDIT : drumCredit,
            chemicalDebit: chemicalIsEmpty ? EXPECTED_CHEMICAL_DEBIT : chemicalDebit,
            chemicalCredit
        };
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify({
        action: apply ? "applied" : "would-apply",
        group: "Consumable Product -> Direct Expense",
        journalHead: {
            id: result.drumHead.id,
            name: result.drumHead.name,
            type: result.drumHead.type
        },
        ledgers: [
            {
                id: result.drum.id,
                name: result.drum.name,
                debit: 0,
                credit: result.drumCredit,
                created: result.drumCreated
            },
            {
                id: result.chemical.id,
                name: result.chemical.name,
                debit: result.chemicalDebit,
                credit: result.chemicalCredit,
                created: result.chemicalCreated
            }
        ],
        cumulative: {
            debit: result.chemicalDebit,
            credit: result.drumCredit,
            closingDebit: money(result.chemicalDebit - result.drumCredit)
        },
        note: "Drum and Chemical Purchase are presentation balances under Consumable Product; no journal voucher was created."
    }, null, 2));

    if (!apply) {
        console.log("Dry run only. Re-run with --apply to save these changes.");
    }
}

if (apply) {
    main()
        .catch(error => {
            console.error(error?.message || error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
} else {
    console.log(
        "Dry run is non-mutating. Re-run with --apply to create/update the Drum and Chemical Purchase ledgers."
    );
    prisma.$disconnect();
}
