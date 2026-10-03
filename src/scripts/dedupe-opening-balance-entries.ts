import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";
import { parseTallyOpeningBalanceTree } from "../modules/import/opening-balance-journal-import.service";

/**
 * Removes duplicate opening-balance Journal/Voucher pairs using the complete
 * indented Trial Balance path as identity.
 *
 * Preview:
 *   npm run dedupe:opening-balances -- --file="C:\\path\\opening.xlsx" --branch=<id>
 * Apply:
 *   ... --apply
 */

type OpeningNode = { name: string; parent?: OpeningNode };
const DEFAULT_FILE = "C:/Users/RAZONOVA/Downloads/openingbalanceimportjournal.xlsx";
const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"] as const;
}));
const fileName = path.resolve(String(args.get("file") || DEFAULT_FILE));
const branchId = args.get("branch");
const apply = args.has("apply");

const normalize = (value: unknown) => String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const amount = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;

const pathFromNodes = (node: OpeningNode | undefined) => {
    const parts: string[] = [];
    for (let current = node; current; current = current.parent) parts.unshift(current.name);
    return parts.map(normalize).join(" > ");
};

const pathFromText = (value: unknown) => normalize(
    String(value || "")
        .replace(/^Opening balance import:\s*/i, "")
        .split("|")[0]
);

async function main() {
    if (!branchId) throw new Error("--branch=<branch id> is required");
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, isActive: true } });
    if (!branch?.isActive) throw new Error(`Branch not found or inactive: ${branchId}`);

    const parsed: any = await parseTallyOpeningBalanceTree(await fs.readFile(fileName));
    const workbookPaths = new Set<string>((parsed.leaves as OpeningNode[]).map(pathFromNodes));
    const heads = await prisma.journalHead.findMany({ select: { id: true, name: true, parentId: true } });
    const headById = new Map(heads.map(head => [head.id, head]));
    const headPath = (id: string | null | undefined) => {
        const parts: string[] = [];
        const visited = new Set<string>();
        let current = id ? headById.get(id) : undefined;
        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            parts.unshift(current.name);
            current = current.parentId ? headById.get(current.parentId) : undefined;
        }
        return parts.map(normalize).join(" > ");
    };

    const journals = await prisma.journal.findMany({
        where: {
            branchId,
            remarks: { startsWith: "Opening balance import:" },
            voucher: { is: { voucherType: VoucherType.OPENING_BALANCE } }
        },
        include: { journalHead: true, voucher: { include: { entries: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    const groups = new Map<string, any[]>();
    for (const journal of journals) {
        const remarkPath = pathFromText(journal.remarks);
        const voucherPath = pathFromText(journal.voucher?.narration);
        const fullPath = remarkPath || voucherPath || headPath(journal.journalHeadId);
        if (!workbookPaths.has(fullPath)) continue;
        const list = groups.get(fullPath) || [];
        list.push(journal);
        groups.set(fullPath, list);
    }

    const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
    const duplicateJournals = duplicateGroups.flatMap(([, rows]) => rows.slice(1));
    const canonical = duplicateGroups.map(([fullPath, rows]) => ({
        fullPath,
        keep: rows[0].id,
        delete: rows.slice(1).map(row => row.id),
        amounts: rows.map(row => ({
            journal: row.id,
            journalAmount: amount(row.amount),
            debit: amount(row.voucher?.totalDebit),
            credit: amount(row.voucher?.totalCredit)
        }))
    }));

    console.log(JSON.stringify({
        file: fileName,
        branchId,
        workbookLeafPaths: workbookPaths.size,
        openingPostingsFoundForWorkbook: [...groups.values()].reduce((sum, rows) => sum + rows.length, 0),
        duplicatePaths: duplicateGroups.length,
        duplicateJournalVoucherPairsToDelete: duplicateJournals.length,
        apply,
        groups: canonical
    }, null, 2));

    if (!apply) {
        console.log("Preview only. Re-run with --apply to delete duplicate Journal/Voucher pairs.");
        return;
    }

    const deleteIds = duplicateJournals.map(row => row.id);
    const deleteVoucherIds = duplicateJournals.map(row => row.voucherId).filter(Boolean) as string[];
    const affectedLedgerIds = [...new Set(
        duplicateJournals.flatMap(row => (row.voucher?.entries || []).map((entry: any) => entry.ledgerId))
    )];

    await prisma.$transaction(async tx => {
        await tx.journal.deleteMany({ where: { id: { in: deleteIds } } });
        if (deleteVoucherIds.length) {
            await tx.voucher.deleteMany({ where: { id: { in: deleteVoucherIds } } });
        }
    });
    for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(prisma, ledgerId);
    console.log(`Deleted ${duplicateJournals.length} duplicate opening Journal/Voucher pairs.`);
}

main()
    .catch(error => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
