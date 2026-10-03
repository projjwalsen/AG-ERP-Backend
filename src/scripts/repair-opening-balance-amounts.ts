import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { EntryType, JournalDirection, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";
import { parseTallyOpeningBalanceTree } from "../modules/import/opening-balance-journal-import.service";

/**
 * Reconciles opening-balance amounts without flattening the Trial Balance
 * hierarchy.
 *
 * Preview:
 *   npm run repair:opening-balance-amounts -- --file="C:\\path\\opening.xlsx" --branch=<id>
 * Apply:
 *   ... --apply
 *
 * Only an existing opening posting with the exact full hierarchy path is
 * eligible for update. Exact debit/credit matches are skipped. Missing or
 * ambiguous paths are reported and never guessed by leaf name alone.
 */

type OpeningLeaf = {
    row: number;
    name: string;
    debit: number;
    credit: number;
    openingDate?: Date;
    parent?: OpeningLeaf;
};

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

const money = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;

const nodePath = (node: OpeningLeaf | undefined) => {
    const parts: string[] = [];
    for (let current = node; current; current = current.parent) parts.unshift(current.name);
    return parts.map(normalize).join(" > ");
};

const pathFromRemark = (value: unknown) => {
    const text = String(value || "").replace(/^Opening balance import:\s*/i, "");
    return normalize(text.split("|")[0]);
};

const sameAmounts = (journal: any, voucher: any, debit: number, credit: number) =>
    money(voucher?.totalDebit) === money(debit) &&
    money(voucher?.totalCredit) === money(credit) &&
    money(journal.amount) === money(debit || credit) &&
    journal.direction === (debit > 0 ? JournalDirection.OUTWARD : JournalDirection.INWARD);

async function main() {
    if (!branchId) throw new Error("--branch=<branch id> is required");
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, isActive: true } });
    if (!branch?.isActive) throw new Error(`Branch not found or inactive: ${branchId}`);

    const parsed: any = await parseTallyOpeningBalanceTree(await fs.readFile(fileName));
    const leaves = parsed.leaves as OpeningLeaf[];
    const heads = await prisma.journalHead.findMany({ select: { id: true, name: true, parentId: true, ledgerId: true } });
    const headById = new Map(heads.map(head => [head.id, head]));
    const headPath = (id: string | null | undefined) => {
        const parts: string[] = [];
        let current = id ? headById.get(id) : undefined;
        const visited = new Set<string>();
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
        include: {
            journalHead: true,
            voucher: { include: { entries: true } }
        }
    });

    const byPath = new Map<string, any[]>();
    for (const journal of journals) {
        const paths = new Set<string>([
            pathFromRemark(journal.remarks),
            pathFromRemark(journal.voucher?.narration),
            headPath(journal.journalHeadId)
        ].filter(Boolean));
        for (const key of paths) {
            const list = byPath.get(key) || [];
            list.push(journal);
            byPath.set(key, list);
        }
    }

    const updates: Array<{ leaf: OpeningLeaf; path: string; journal: any; debit: number; credit: number }> = [];
    const skipped: string[] = [];
    const missing: string[] = [];
    const ambiguous: string[] = [];
    const seen = new Set<string>();

    for (const leaf of leaves) {
        const debit = money(leaf.debit);
        const credit = money(leaf.credit);
        const fullPath = nodePath(leaf);
        if (!debit && !credit) continue;
        if (seen.has(fullPath)) {
            ambiguous.push(`Workbook duplicate path row ${leaf.row}: ${fullPath}`);
            continue;
        }
        seen.add(fullPath);
        const matches = [...new Set(byPath.get(fullPath) || [])];
        if (matches.length === 0) {
            missing.push(`row ${leaf.row}: ${fullPath} | Dr ${debit.toFixed(2)} | Cr ${credit.toFixed(2)}`);
            continue;
        }
        const mismatched = matches.filter(journal =>
            !sameAmounts(journal, journal.voucher, debit, credit)
        );
        if (mismatched.length === 0) {
            skipped.push(fullPath);
            continue;
        }
        if (mismatched.length > 1) {
            ambiguous.push(`row ${leaf.row}: ${fullPath} (${matches.length} database postings; ${mismatched.length} mismatched)`);
            continue;
        }
        // If there is one bad duplicate alongside exact copies, repair only
        // the bad copy. Exact copies remain untouched by design.
        updates.push({ leaf, path: fullPath, journal: mismatched[0], debit, credit });
    }

    console.log(JSON.stringify({
        file: fileName,
        branchId,
        workbookLeafRows: leaves.length,
        databaseOpeningPostings: journals.length,
        exactMatchesSkipped: skipped.length,
        mismatchesToReplace: updates.length,
        missingFullPaths: missing.length,
        ambiguousFullPaths: ambiguous.length,
        apply
    }, null, 2));
    if (missing.length) console.log("\nMISSING FULL PATHS\n" + missing.join("\n"));
    if (ambiguous.length) console.log("\nAMBIGUOUS FULL PATHS\n" + ambiguous.join("\n"));
    if (!apply) {
        console.log("\nPreview only. Re-run with --apply to replace mismatched amounts.");
        return;
    }

    const ledgerIds = new Set<string>();
    await prisma.$transaction(async tx => {
        for (const item of updates) {
            const { journal, debit, credit, path: fullPath, leaf } = item;
            const amount = debit || credit;
            const direction = debit > 0 ? JournalDirection.OUTWARD : JournalDirection.INWARD;
            const entryType = debit > 0 ? EntryType.DEBIT : EntryType.CREDIT;
            ledgerIds.add(journal.journalHead.ledgerId);
            await tx.journal.update({
                where: { id: journal.id },
                data: {
                    amount,
                    direction,
                    journalDate: leaf.openingDate || journal.journalDate,
                    remarks: `Opening balance import: ${fullPath}`
                }
            });
            if (journal.voucherId) {
                await tx.voucher.update({
                    where: { id: journal.voucherId },
                    data: {
                        totalDebit: debit,
                        totalCredit: credit,
                        voucherDate: leaf.openingDate || journal.voucher.voucherDate,
                        narration: `Opening balance import: ${fullPath}`
                    }
                });
                await tx.ledgerEntry.updateMany({
                    where: { voucherId: journal.voucherId },
                    data: { amount, entryType, narration: `Opening balance: ${leaf.name}` }
                });
            }
        }
    });
    for (const ledgerId of ledgerIds) await LedgerService.syncCachedBalance(prisma, ledgerId);
    console.log(`Applied ${updates.length} opening-balance amount replacements; skipped ${skipped.length} exact matches.`);
}

main()
    .catch(error => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
