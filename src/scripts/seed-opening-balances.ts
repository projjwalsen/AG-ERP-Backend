/**
 * Seed opening-balance journals from an indented Tally Trial Balance workbook.
 *
 * The script delegates to the same importer used by the UI. It detects both
 * Tally opening-column layouts, posts only non-zero leaf rows, reuses matching
 * branch ledgers, and creates missing journal heads, subheads, categories,
 * ledgers, and agency ledgers as needed. Re-running a workbook is safe and
 * reconciles older misread postings instead of adding a second amount.
 *
 * Preview (no writes):
 *   npm run seed:opening-balances -- --file "C:\\path\\TallyTrialBalance.xlsx" --branch "MAHARASHTRA"
 *
 * Apply:
 *   npm run seed:opening-balances -- --file "C:\\path\\TallyTrialBalance.xlsx" --branch "MAHARASHTRA" --apply
 *
 * Optional:
 *   --date 2025-04-01
 *   --user-email admin@example.com
 */
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "../config/db";
import {
    OpeningBalanceJournalImportService,
    parseTallyOpeningBalanceTree
} from "../modules/import/opening-balance-journal-import.service";

const flagValue = (flag: string) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
};

const filePath = flagValue("--file");
const branchQuery = flagValue("--branch");
const userEmail = flagValue("--user-email");
const requestedDate = flagValue("--date");
const apply = process.argv.includes("--apply");

const help = () => {
    console.log("Usage: npm run seed:opening-balances -- --file <trial-balance.xlsx> --branch <branch code/name/id> [--date YYYY-MM-DD] [--user-email email] [--apply]");
};

async function resolveBranch() {
    if (!branchQuery) throw new Error("--branch is required");

    const branch = await prisma.branch.findFirst({
        where: {
            isActive: true,
            OR: [
                { id: branchQuery },
                { code: { equals: branchQuery, mode: "insensitive" } },
                { name: { equals: branchQuery, mode: "insensitive" } }
            ]
        },
        select: { id: true, code: true, name: true }
    });
    if (!branch) throw new Error(`No active branch matches "${branchQuery}"`);
    return branch;
}

async function resolveActor(branchId: string) {
    const actor = await prisma.user.findFirst({
        where: {
            isActive: true,
            status: "ACTIVE",
            ...(userEmail
                ? { email: { equals: userEmail, mode: "insensitive" } }
                : {
                    OR: [
                        { branchAccessType: "ALL" },
                        { branchId }
                    ]
                })
        },
        select: { id: true, name: true, email: true, branchId: true, branchAccessType: true }
    });

    if (!actor) {
        throw new Error("No active user can be used to seed this branch. Provide --user-email for an active user with access.");
    }
    if (actor.branchAccessType !== "ALL" && actor.branchId !== branchId) {
        throw new Error(`User ${actor.email} does not have access to the selected branch`);
    }
    return actor;
}

function parseRequestedDate() {
    if (!requestedDate) return undefined;
    const date = new Date(`${requestedDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
        throw new Error("--date must be in YYYY-MM-DD format");
    }
    return date;
}

async function main() {
    if (!filePath || !branchQuery) {
        help();
        throw new Error("Both --file and --branch are required");
    }

    const [branch, buffer] = await Promise.all([
        resolveBranch(),
        readFile(filePath)
    ]);
    const { leaves, periodStart } = await parseTallyOpeningBalanceTree(buffer);

    console.log(`Workbook: ${path.basename(filePath)}`);
    console.log(`Branch: ${branch.name} (${branch.code})`);
    console.log(`Eligible non-zero leaf balances: ${leaves.length}`);
    console.table(leaves.slice(0, 10).map(leaf => ({
        row: leaf.row,
        particular: leaf.name,
        debit: leaf.debit,
        credit: leaf.credit
    })));

    if (!apply) {
        console.log("Preview only: no records were created. Add --apply to seed these balances.");
        return;
    }

    const actor = await resolveActor(branch.id);
    const summary = await OpeningBalanceJournalImportService.importWorkbook(
        actor,
        {
            buffer,
            originalname: path.basename(filePath),
            mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        } as any,
        branch.id,
        parseRequestedDate() || periodStart,
        progress => {
            if (progress.processed === progress.total || progress.processed % 25 === 0) {
                console.log(`[${progress.processed}/${progress.total}] created=${progress.success}, skipped=${progress.skipped}, failed=${progress.failed}`);
            }
        }
    );

    console.log("Opening-balance seed complete:", {
        created: summary.success,
        skipped: summary.skipped,
        failed: summary.failed
    });
    if (summary.errors.length > 0) {
        console.table(summary.errors);
        process.exitCode = 1;
    }
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
