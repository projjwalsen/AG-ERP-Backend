/**
 * Preview/repair an opening-balance Trial Balance import without flattening
 * the Excel hierarchy.
 *
 * Preview (no writes):
 *   npx tsx src/scripts/repair-opening-balance-journal-tree.ts --branch=<id>
 *
 * Apply the idempotent importer after reviewing the preview:
 *   npx tsx src/scripts/repair-opening-balance-journal-tree.ts --branch=<id> --apply
 *
 * The file can be overridden with --file=<absolute-or-relative-path>.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import {
    OpeningBalanceJournalImportService,
    parseTallyOpeningBalanceTree
} from "../modules/import/opening-balance-journal-import.service";

const DEFAULT_FILE = "C:/Users/RAZONOVA/Downloads/openingbalanceimportjournal.xlsx";
const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const money = (value: unknown) => Number(Number(value || 0).toFixed(2));
const sameName = (left: string, right: string) => normalize(left).toUpperCase() === normalize(right).toUpperCase();

type Node = {
    row: number;
    name: string;
    indent: number;
    debit: number;
    credit: number;
    parent?: Node;
    children: Node[];
};

const args = new Map(
    process.argv.slice(2).map(value => {
        const [key, ...rest] = value.replace(/^--/, "").split("=");
        return [key, rest.join("=") || "true"] as const;
    })
);

const fileName = path.resolve(String(args.get("file") || DEFAULT_FILE));
const requestedBranchId = args.get("branch");
const apply = args.has("apply");

const nodePath = (node: Node | undefined) => {
    const names: string[] = [];
    for (let current = node; current; current = current.parent) names.unshift(current.name);
    return names.join(" > ");
};

async function chooseBranch() {
    if (requestedBranchId) {
        const branch = await prisma.branch.findUnique({ where: { id: requestedBranchId } });
        if (!branch || !branch.isActive) throw new Error(`Branch not found or inactive: ${requestedBranchId}`);
        return branch;
    }
    const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    if (branches.length !== 1) {
        throw new Error(`Pass --branch=<id>; ${branches.length} active branches are configured.`);
    }
    return branches[0];
}

function buildStackHierarchy(parsed: any) {
    return parsed as { nodes: Node[]; leaves: Node[]; periodStart?: Date };
}

async function preview(branchId: string, parsed: { nodes: Node[]; leaves: Node[] }) {
    const [heads, categories, journals, ledgers] = await Promise.all([
        prisma.journalHead.findMany({
            select: { id: true, name: true, parentId: true, ledgerId: true }
        }),
        prisma.journalCategory.findMany({
            select: { id: true, name: true, journalHeadId: true }
        }),
        prisma.journal.findMany({
            where: {
                branchId,
                remarks: { startsWith: "Opening balance import:" },
                voucher: { is: { voucherType: VoucherType.OPENING_BALANCE } }
            },
            select: { id: true, amount: true, direction: true, importKey: true, remarks: true, journalHeadId: true }
        }),
        prisma.ledger.findMany({
            select: { id: true, name: true, branchId: true, group: { select: { name: true } } }
        })
    ]);

    const headByPath = new Map<string, typeof heads[number]>();
    const unresolved = [...heads];
    let progressed = true;
    while (unresolved.length && progressed) {
        progressed = false;
        for (let index = unresolved.length - 1; index >= 0; index--) {
            const head = unresolved[index];
            const parentPath = head.parentId ? [...headByPath.entries()].find(([, item]) => item.id === head.parentId)?.[0] : "";
            if (head.parentId && parentPath === undefined) continue;
            headByPath.set(parentPath ? `${parentPath} > ${head.name}` : head.name, head);
            unresolved.splice(index, 1);
            progressed = true;
        }
    }

    const categorySet = new Set(categories.map(item => `${item.journalHeadId}|${item.name.toUpperCase()}`));
    const ledgerMatches = (leaf: Node) => leaf.parent && ledgers.find(ledger =>
        sameName(ledger.name, leaf.name) &&
        sameName(ledger.group.name, leaf.parent.name) &&
        (ledger.branchId === branchId || ledger.branchId === null)
    );
    const missingHeads: string[] = [];
    const missingCategories: Array<{ row: number; path: string; headPath: string; category: string }> = [];
    const missingOpeningBalances: Array<{ row: number; path: string; debit: number; credit: number }> = [];
    const existingOpening = new Set(journals.map(journal => `${journal.remarks}|${money(journal.amount)}|${journal.direction}`));

    for (const node of parsed.nodes) {
        const hierarchyPath = nodePath(node);
        if (!headByPath.has(hierarchyPath)) missingHeads.push(hierarchyPath);
    }
    for (const leaf of parsed.leaves) {
        const targetHeadPath = ledgerMatches(leaf) ? nodePath(leaf) : nodePath(leaf.parent || leaf);
        const targetHead = headByPath.get(targetHeadPath);
        const category = leaf.parent ? leaf.name : "Opening Balance";
        if (!targetHead || !categorySet.has(`${targetHead.id}|${category.toUpperCase()}`)) {
            missingCategories.push({ row: leaf.row, path: nodePath(leaf), headPath: targetHeadPath, category });
        }
        const direction = leaf.debit > 0 ? "OUTWARD" : "INWARD";
        const amount = money(leaf.debit || leaf.credit);
        const remarkPrefix = `Opening balance import: ${nodePath(leaf)}`;
        const found = journals.some(journal =>
            String(journal.remarks || "").startsWith(remarkPrefix) &&
            money(journal.amount) === amount && journal.direction === direction
        );
        if (!found && amount !== 0) {
            missingOpeningBalances.push({ row: leaf.row, path: nodePath(leaf), debit: money(leaf.debit), credit: money(leaf.credit) });
        }
    }

    const uniqueMissingHeads = [...new Set(missingHeads)];
    console.log(`Workbook: ${fileName}`);
    console.log(`Branch: ${branchId}`);
    console.log(`Rows: ${parsed.nodes.length} hierarchy nodes, ${parsed.leaves.length} non-zero leaf balances`);
    console.log(`Missing journal heads/subheads: ${uniqueMissingHeads.length}`);
    console.log(`Missing categories: ${missingCategories.length}`);
    console.log(`Missing opening-balance postings: ${missingOpeningBalances.length}`);
    if (uniqueMissingHeads.length) console.log("\nMISSING HEADS\n" + uniqueMissingHeads.map(item => `- ${item}`).join("\n"));
    if (missingCategories.length) console.log("\nMISSING CATEGORIES\n" + missingCategories.map(item => `- row ${item.row}: ${item.headPath} > ${item.category}`).join("\n"));
    if (missingOpeningBalances.length) console.log("\nMISSING OPENING BALANCES\n" + missingOpeningBalances.map(item => `- row ${item.row}: ${item.path} | Dr ${item.debit.toFixed(2)} | Cr ${item.credit.toFixed(2)}`).join("\n"));
    return { missingHeads: uniqueMissingHeads.length, missingCategories: missingCategories.length, missingOpeningBalances: missingOpeningBalances.length };
}

async function main() {
    const branch = await chooseBranch();
    const buffer = await fs.readFile(fileName);
    const parsed = buildStackHierarchy(await parseTallyOpeningBalanceTree(buffer));
    const counts = await preview(branch.id, parsed);
    if (!apply) {
        console.log("\nPreview only. No database rows were changed. Re-run with --apply to repair these rows.");
        return;
    }

    const actor = await prisma.user.findFirst({
        where: { isActive: true, branchAccessType: "ALL" },
        orderBy: { createdAt: "asc" }
    });
    if (!actor) throw new Error("No active ALL-branch user is available for --apply.");
    const result = await OpeningBalanceJournalImportService.importWorkbook(
        actor,
        { buffer, originalname: path.basename(fileName) } as any,
        branch.id,
        parsed.periodStart
    );
    console.log(`\nApplied repair: created=${result.success}, already-present=${result.skipped}, failed=${result.failed}.`);
    if (result.errors.length) console.log(JSON.stringify(result.errors, null, 2));
    void counts;
}

main()
    .catch(error => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
