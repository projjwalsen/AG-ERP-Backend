import "dotenv/config";
import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as XLSX from "xlsx";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR_ID = "c7feaec8-d19f-480b-8bf3-036745415849";
const ROOTS: Record<string, string> = {
    "Sundry Creditors": "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
    "Advance From S. Debtors": "6cfbfae5-9fb5-486b-a317-33d4ab097601"
};
const FILES: Array<[string, string]> = [
    ["Sundry Creditors", "C:/Users/razon/Downloads/Sundry_Creditors_Opening_Balance.xlsx"],
    ["Advance From S. Debtors", "C:/Users/razon/Downloads/Advance_From_S_Deb_Opening_Balance.xlsx"]
];
const OPENING_DATE = new Date("2025-04-01T00:00:00.000Z");
const apply = process.argv.includes("--apply");

const norm = (value: unknown) =>
    String(value ?? "")
        .normalize("NFKD")
        .replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();
const cents = (value: unknown) =>
    Math.round(Number(String(value ?? "0").replace(/[,?\s]/g, "").replace(/[^0-9.-]/g, "")) * 100) || 0;
const money = (value: number) => Number((value / 100).toFixed(2));
const sourceKey = (head: string, name: string) =>
    `OPENING_BALANCE:${BRANCH_ID}:${createHash("sha1").update(`${head}|${norm(name)}`.toUpperCase()).digest("hex").slice(0, 32)}`;

async function refreshLedgers(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 200) {
        const chunk = unique.slice(i, i + 200);
        const inList = chunk.map(id => `'${id}'`).join(",");
        await prisma.$executeRawUnsafe(`
            WITH ledgers AS (
                SELECT l.id,
                    CASE WHEN l."openingDebit" <> 0 OR l."openingCredit" <> 0
                        THEN l."openingDebit" - l."openingCredit"
                        ELSE CASE WHEN l.nature = 'CREDIT' THEN -l."openingBalance" ELSE l."openingBalance" END
                    END AS opening
                FROM "Ledger" l
                WHERE l.id IN (${inList})
            ),
            entries AS (
                SELECT e."ledgerId",
                    SUM(CASE WHEN e."entryType" = 'DEBIT' THEN e.amount ELSE -e.amount END) AS net
                FROM "LedgerEntry" e
                WHERE e."ledgerId" IN (${inList})
                GROUP BY e."ledgerId"
            ),
            journals AS (
                SELECT jh."ledgerId",
                    SUM(CASE WHEN COALESCE(j.direction::text, jh.type::text) = 'INWARD' THEN j.amount ELSE -j.amount END) AS net
                FROM "Journal" j
                JOIN "JournalHead" jh ON jh.id = j."journalHeadId"
                WHERE j.status = 'APPROVED' AND j."voucherId" IS NULL AND jh."ledgerId" IN (${inList})
                GROUP BY jh."ledgerId"
            )
            UPDATE "Ledger" l
            SET "currentBalance" = ledgers.opening + COALESCE(entries.net, 0) + COALESCE(journals.net, 0),
                "updatedAt" = NOW()
            FROM ledgers
            LEFT JOIN entries ON entries."ledgerId" = ledgers.id
            LEFT JOIN journals ON journals."ledgerId" = ledgers.id
            WHERE l.id = ledgers.id
        `);
    }
}

(async () => {
    const source: any[] = [];
    for (const [head, path] of FILES) {
        const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(path).Sheets["Opening Balances"], {
            header: 1, defval: null, raw: false
        });
        for (let i = 4; i < rows.length; i++) {
            const r = rows[i];
            if (!r?.[1]) continue;
            const debit = cents(r[5]);
            const credit = cents(r[6]);
            source.push({
                head,
                row: i + 1,
                agency: String(r[1]).trim(),
                agencyNorm: norm(r[1]),
                side: debit ? "DEBIT" : "CREDIT",
                cents: Math.max(debit, credit),
                amount: Math.max(debit, credit) / 100
            });
        }
    }

    const groups = await prisma.ledgerGroup.findMany();
    const descendants = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) {
                if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                    ids.add(g.id);
                    changed = true;
                }
            }
        }
        return ids;
    };
    const scopes = new Map(Object.entries(ROOTS).map(([head, id]) => [head, descendants(id)]));
    const allScopeIds = [...new Set([...scopes.values()].flatMap(s => [...s]))];
    const ledgers = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: { in: allScopeIds } },
        select: { id: true, name: true, groupId: true, nature: true }
    });
    const counts = await prisma.ledgerEntry.groupBy({
        by: ["ledgerId"],
        where: { ledgerId: { in: ledgers.map(l => l.id) } },
        _count: { id: true }
    });
    const countMap = new Map(counts.map(c => [c.ledgerId, c._count.id]));
    const sameName = (head: string, name: string) =>
        ledgers
            .filter(l => scopes.get(head)?.has(l.groupId) && norm(l.name) === norm(name))
            .sort((a, b) => Number(countMap.get(b.id) || 0) - Number(countMap.get(a.id) || 0));
    const pick = (head: string, name: string) => sameName(head, name)[0] || null;

    const openings = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgers.map(l => l.id) },
            voucher: { voucherType: "OPENING_BALANCE" }
        },
        include: { voucher: { include: { journals: true } }, ledger: true }
    });
    const openingsByLedger = new Map<string, typeof openings>();
    for (const e of openings) {
        const arr = openingsByLedger.get(e.ledgerId) || [];
        arr.push(e);
        openingsByLedger.set(e.ledgerId, arr);
    }

    const keepEntryIds = new Set<string>();
    const create: any[] = [];
    const update: any[] = [];
    const relink: any[] = [];
    const missingLedger: any[] = [];
    const matched: any[] = [];

    for (const row of source) {
        const aliases = sameName(row.head, row.agency);
        const ledger = aliases[0];
        if (!ledger) {
            missingLedger.push(row);
            continue;
        }
        const existingOnCanonical = (openingsByLedger.get(ledger.id) || []).filter(e => !keepEntryIds.has(e.id));
        const exactCanonical = existingOnCanonical.find(e => e.entryType === row.side && cents(e.amount) === row.cents);
        if (exactCanonical) {
            keepEntryIds.add(exactCanonical.id);
            matched.push({ row, ledgerId: ledger.id, entryId: exactCanonical.id });
            continue;
        }
        const aliasExisting = aliases.flatMap(l => (openingsByLedger.get(l.id) || []).filter(e => !keepEntryIds.has(e.id)));
        const exactAlias = aliasExisting.find(e => e.entryType === row.side && cents(e.amount) === row.cents);
        if (exactAlias) {
            keepEntryIds.add(exactAlias.id);
            if (exactAlias.ledgerId !== ledger.id) {
                relink.push({
                    row,
                    entryId: exactAlias.id,
                    voucherId: exactAlias.voucherId,
                    oldLedgerId: exactAlias.ledgerId,
                    oldLedgerName: exactAlias.ledger.name,
                    targetLedgerId: ledger.id,
                    targetLedgerName: ledger.name
                });
            } else {
                matched.push({ row, ledgerId: ledger.id, entryId: exactAlias.id });
            }
            continue;
        }
        const candidate = existingOnCanonical[0] || aliasExisting[0];
        if (candidate) {
            keepEntryIds.add(candidate.id);
            update.push({
                row,
                ledgerId: ledger.id,
                ledgerName: ledger.name,
                entryId: candidate.id,
                voucherId: candidate.voucherId,
                journalId: candidate.voucher.journals[0]?.id || null,
                oldLedgerId: candidate.ledgerId,
                oldSide: candidate.entryType,
                oldAmount: cents(candidate.amount) / 100
            });
        } else {
            create.push({ row, ledgerId: ledger.id, ledgerName: ledger.name });
        }
    }

    const extras = openings.filter(e => !keepEntryIds.has(e.id)).map(e => ({
        entryId: e.id,
        voucherId: e.voucherId,
        ledgerId: e.ledgerId,
        ledger: e.ledger.name,
        side: e.entryType,
        amount: cents(e.amount) / 100,
        no: e.voucher.voucherNo,
        journalIds: e.voucher.journals.map(j => j.id)
    }));

    const stats = {
        apply,
        sourceRows: source.length,
        matched: matched.length,
        relink: relink.length,
        update: update.length,
        create: create.length,
        extras: extras.length,
        missingLedger: missingLedger.length,
        missingLedgerNames: missingLedger.map(r => r.agency),
        extraAmount: extras.reduce((s, x) => s + (x.side === "CREDIT" ? x.amount : -x.amount), 0),
        createSample: create,
        relinkSample: relink,
        extraLedgers: [...new Set(extras.map(x => x.ledger))]
    };
    fs.writeFileSync(".tmp-liability-openings-plan.json", JSON.stringify({ stats, create, update, relink, extras, missingLedger }, null, 2));
    console.log(JSON.stringify(stats, null, 2));
    if (!apply) {
        await prisma.$disconnect();
        return;
    }
    if (missingLedger.length) throw new Error(`Missing ledgers: ${missingLedger.map(r => r.agency).join(", ")}`);

    const actor = await prisma.user.findUnique({ where: { id: ACTOR_ID }, select: { id: true } });
    if (!actor) throw new Error("Opening-balance actor user was not found");

    const affected = new Set<string>();
    for (const item of relink) {
        await prisma.ledgerEntry.update({
            where: { id: item.entryId },
            data: { ledgerId: item.targetLedgerId }
        });
        affected.add(item.oldLedgerId);
        affected.add(item.targetLedgerId);
    }
    for (const item of update) {
        const debit = item.row.side === "DEBIT" ? item.row.amount : 0;
        const credit = item.row.side === "CREDIT" ? item.row.amount : 0;
        await prisma.ledgerEntry.update({
            where: { id: item.entryId },
            data: {
                ledgerId: item.ledgerId,
                entryType: item.row.side,
                amount: item.row.amount
            }
        });
        if (item.oldLedgerId) affected.add(item.oldLedgerId);
        await prisma.voucher.update({
            where: { id: item.voucherId },
            data: { totalDebit: debit, totalCredit: credit }
        });
        if (item.journalId) {
            await prisma.journal.update({
                where: { id: item.journalId },
                data: {
                    amount: item.row.amount,
                    direction: item.row.side === "DEBIT" ? "OUTWARD" : "INWARD"
                }
            });
        }
        affected.add(item.ledgerId);
    }

    const extraVoucherIds = [...new Set(extras.map(x => x.voucherId))];
    if (extraVoucherIds.length) {
        await prisma.journal.updateMany({ where: { voucherId: { in: extraVoucherIds } }, data: { voucherId: null } });
        await prisma.journal.deleteMany({
            where: {
                id: { in: extras.flatMap(x => x.journalIds) },
                importKey: { startsWith: "OPENING_BALANCE:" }
            }
        });
        await prisma.voucher.deleteMany({ where: { id: { in: extraVoucherIds } } });
        extras.forEach(x => affected.add(x.ledgerId));
    }

    for (const item of create) {
        let head = await prisma.journalHead.findFirst({
            where: { ledgerId: item.ledgerId },
            orderBy: { createdAt: "asc" }
        });
        if (!head) {
            head = await prisma.journalHead.create({
                data: { name: item.row.agency, ledgerId: item.ledgerId, isActive: true }
            });
        }
        let category = await prisma.journalCategory.findFirst({
            where: { journalHeadId: head.id, name: { equals: item.row.agency, mode: "insensitive" } }
        });
        if (!category) {
            category = await prisma.journalCategory.create({
                data: { name: item.row.agency, journalHeadId: head.id, isActive: true }
            });
        }
        const importKey = sourceKey(item.row.head, item.row.agency);
        const existingKey = await prisma.journal.findUnique({ where: { importKey } });
        const key = existingKey ? `${importKey}:${randomUUID().slice(0, 8)}` : importKey;
        const journal = await prisma.journal.create({
            data: {
                branchId: BRANCH_ID,
                journalHeadId: head.id,
                categoryId: category.id,
                importKey: key,
                amount: item.row.amount,
                direction: item.row.side === "DEBIT" ? "OUTWARD" : "INWARD",
                paymentMode: "OFFLINE",
                remarks: `Opening balance import: Current Liabilities > ${item.row.head} > ${item.row.agency}`,
                journalDate: OPENING_DATE,
                status: "APPROVED",
                createdById: ACTOR_ID,
                approvedById: ACTOR_ID,
                approvedAt: new Date()
            }
        });
        const debit = item.row.side === "DEBIT" ? item.row.amount : 0;
        const credit = item.row.side === "CREDIT" ? item.row.amount : 0;
        const voucher = await prisma.voucher.create({
            data: {
                voucherNo: `OPN-${journal.id.slice(0, 8).toUpperCase()}`,
                voucherType: "OPENING_BALANCE",
                sourceId: journal.id,
                branchId: BRANCH_ID,
                narration: `Opening balance import: Current Liabilities > ${item.row.head} > ${item.row.agency}`,
                voucherDate: OPENING_DATE,
                totalDebit: debit,
                totalCredit: credit,
                entries: {
                    create: {
                        ledgerId: item.ledgerId,
                        branchId: BRANCH_ID,
                        entryType: item.row.side,
                        amount: item.row.amount,
                        narration: `Opening balance: ${item.row.agency}`
                    }
                }
            }
        });
        await prisma.journal.update({ where: { id: journal.id }, data: { voucherId: voucher.id } });
        affected.add(item.ledgerId);
    }

    await refreshLedgers([...affected]);
    console.log(JSON.stringify({ applied: true, relinked: relink.length, updated: update.length, created: create.length, deletedExtras: extraVoucherIds.length, affectedLedgers: affected.size }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
