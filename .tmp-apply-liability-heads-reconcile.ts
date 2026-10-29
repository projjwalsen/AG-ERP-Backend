import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, string> = {
    "Sundry Creditors": "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
    "Advance From S. Debtors": "6cfbfae5-9fb5-486b-a317-33d4ab097601"
};
const BANK_CC_ID = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const cents = (value: unknown) => Math.round(Number(value || 0) * 100) || 0;
const istDate = (date: string) => new Date(`${date}T00:00:00+05:30`);
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

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
    const plan = JSON.parse(fs.readFileSync(".tmp-reconcile-liability-heads-plan.json", "utf8"));
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

    const relink = plan.relink as any[];
    const creates = plan.create as any[];
    const extras = plan.unlink as any[];
    const skipped = plan.skipRelink as any[];

    const bank = await prisma.ledger.findUnique({ where: { id: BANK_CC_ID }, select: { id: true, name: true } });
    if (!bank || !/BANK OF MAHARASHTRA/i.test(bank.name)) {
        throw new Error("Configured BANK CC ledger id does not match BANK OF MAHARASHTRA- C/C");
    }

    const relinkEntries = [];
    for (let i = 0; i < relink.length; i += 250) {
        relinkEntries.push(
            ...await prisma.ledgerEntry.findMany({
                where: { id: { in: relink.slice(i, i + 250).map((x: any) => x.entryId) } },
                include: { voucher: true, ledger: true }
            })
        );
    }
    const relinkMap = new Map(relinkEntries.map(e => [e.id, e]));
    for (const row of relink) {
        const entry = relinkMap.get(row.entryId);
        const target = await prisma.ledger.findUnique({ where: { id: row.targetLedgerId }, select: { id: true, name: true, groupId: true } });
        if (!entry || !target) throw new Error(`Missing relink entry/target ${row.agency} ${row.no}`);
        if (entry.voucherId !== row.voucherId || entry.ledgerId !== row.oldLedgerId) {
            throw new Error(`Relink precondition changed ${row.agency} ${row.no}`);
        }
        if (entry.entryType !== row.side || cents(entry.amount) !== row.cents) {
            throw new Error(`Relink amount/side changed ${row.agency} ${row.no}`);
        }
        if (!scopes.get(row.head)?.has(target.groupId)) {
            throw new Error(`Target ledger outside ${row.head} for ${row.agency}`);
        }
    }

    const receiptFixes: any[] = [];
    for (const item of skipped) {
        const row = item.row;
        const voucher = await prisma.voucher.findFirst({
            where: {
                id: item.hits[0].voucherId,
                branchId: BRANCH_ID,
                voucherType: { in: ["RECEIPT", "BANK_RECEIPT"] }
            },
            include: { entries: { include: { ledger: true } } }
        });
        if (!voucher) throw new Error(`Skip voucher missing ${row.no}`);
        const credit = voucher.entries.find(e => e.entryType === "CREDIT" && cents(e.amount) === row.cents);
        const debit = voucher.entries.find(e => e.entryType === "DEBIT" && cents(e.amount) === row.cents);
        const party = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: [...scopes.get(row.head)!] } },
            select: { id: true, name: true, groupId: true }
        });
        const norm = (v: unknown) => String(v ?? "").normalize("NFKD").replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
        const targetLedger = party.find(l => norm(l.name) === row.agencyNorm);
        if (!credit || !debit || !targetLedger) {
            throw new Error(`Cannot rebuild receipt ${row.no} ${row.agency}`);
        }
        if (localDate(voucher.voucherDate) !== row.date) throw new Error(`Receipt date mismatch ${row.no}`);
        receiptFixes.push({
            row,
            voucherId: voucher.id,
            creditEntryId: credit.id,
            debitEntryId: debit.id,
            oldCreditLedgerId: credit.ledgerId,
            oldDebitLedgerId: debit.ledgerId,
            targetLedgerId: targetLedger.id,
            moveDebitToBank: row.particulars.toUpperCase().includes("BANK OF MAHARASHTRA")
        });
    }

    const extraVouchers = await prisma.voucher.findMany({
        where: { id: { in: extras.map((x: any) => x.voucherId) } },
        include: {
            entries: true,
            journals: true,
            transaction: true,
            debitCreditNotes: true,
            manufactures: true
        }
    });
    if (extraVouchers.length !== extras.length) throw new Error("An extra voucher disappeared");
    for (const voucher of extraVouchers) {
        if (voucher.transaction.length || voucher.debitCreditNotes.length || voucher.manufactures.length) {
            throw new Error(`Refusing to delete voucher ${voucher.voucherNo} with source documents`);
        }
        const extra = extras.find((x: any) => x.voucherId === voucher.id);
        const party = voucher.entries.find(e => e.id === extra.entryId);
        if (!party || party.ledgerId !== extra.ledgerId || cents(party.amount) !== extra.cents) {
            throw new Error(`Extra voucher precondition changed ${voucher.voucherNo}`);
        }
    }

    const preparedCreates = creates.map((row: any) => {
        const voucherId = randomUUID();
        const other = row.side === "DEBIT" ? "CREDIT" : "DEBIT";
        return {
            row,
            voucher: {
                id: voucherId,
                sourceId: `RECON-CL:${row.head}:${row.row}:${row.no}:${row.date}`,
                voucherNo: row.no,
                voucherType: row.voucherType,
                branchId: BRANCH_ID,
                narration: `Reconciled from ${row.head} workbook row ${row.row}; counterpart: ${row.particulars}`,
                voucherDate: istDate(row.date),
                totalDebit: row.amount,
                totalCredit: row.amount
            },
            entries: [
                {
                    id: randomUUID(),
                    voucherId,
                    ledgerId: row.partyId,
                    branchId: BRANCH_ID,
                    entryType: row.side,
                    amount: row.amount,
                    narration: `${row.agency} per workbook row ${row.row}`
                },
                {
                    id: randomUUID(),
                    voucherId,
                    ledgerId: row.contraId,
                    branchId: BRANCH_ID,
                    entryType: other,
                    amount: row.amount,
                    narration: row.particulars
                }
            ]
        };
    });
    for (const created of preparedCreates) {
        const clash = await prisma.voucher.findFirst({
            where: { sourceId: created.voucher.sourceId, voucherType: created.voucher.voucherType as any }
        });
        if (clash) throw new Error(`Create sourceId already exists ${created.voucher.sourceId}`);
    }

    const backup = {
        relink: relink.map((row: any) => ({
            entryId: row.entryId,
            voucherId: row.voucherId,
            oldLedgerId: row.oldLedgerId,
            targetLedgerId: row.targetLedgerId,
            no: row.no,
            agency: row.agency
        })),
        receiptFixes,
        deletes: extraVouchers.map(v => ({
            voucher: {
                id: v.id,
                voucherNo: v.voucherNo,
                voucherType: v.voucherType,
                voucherDate: v.voucherDate,
                narration: v.narration,
                sourceId: v.sourceId,
                totalDebit: v.totalDebit,
                totalCredit: v.totalCredit
            },
            entries: v.entries,
            journalIds: v.journals.map(j => j.id)
        })),
        creates: preparedCreates
    };
    fs.writeFileSync(".tmp-liability-heads-reconcile-backup.json", JSON.stringify(backup, null, 2));

    for (let i = 0; i < relink.length; i += 200) {
        const chunk = relink.slice(i, i + 200);
        const values = chunk.map((row: any) => `('${row.entryId}','${row.targetLedgerId}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }

    for (const fix of receiptFixes) {
        await prisma.ledgerEntry.update({
            where: { id: fix.creditEntryId },
            data: { ledgerId: fix.targetLedgerId }
        });
        if (fix.moveDebitToBank && fix.oldDebitLedgerId !== BANK_CC_ID) {
            await prisma.ledgerEntry.update({
                where: { id: fix.debitEntryId },
                data: { ledgerId: BANK_CC_ID }
            });
        }
    }

    if (preparedCreates.length) {
        await prisma.voucher.createMany({ data: preparedCreates.map(x => x.voucher as any) });
        await prisma.ledgerEntry.createMany({ data: preparedCreates.flatMap(x => x.entries) as any });
    }

    const deleteIds = extraVouchers.map(v => v.id);
    await prisma.journal.updateMany({ where: { voucherId: { in: deleteIds } }, data: { voucherId: null } });
    await prisma.voucher.deleteMany({ where: { id: { in: deleteIds } } });

    const affected = [
        ...relink.flatMap((row: any) => [row.oldLedgerId, row.targetLedgerId]),
        ...receiptFixes.flatMap((row: any) => [row.oldCreditLedgerId, row.oldDebitLedgerId, row.targetLedgerId, BANK_CC_ID]),
        ...preparedCreates.flatMap(x => [x.row.partyId, x.row.contraId]),
        ...extraVouchers.flatMap(v => v.entries.map(e => e.ledgerId))
    ];
    await refreshLedgers(affected);

    console.log(JSON.stringify({
        relinked: relink.length,
        receiptFixes: receiptFixes.length,
        created: preparedCreates.length,
        deletedDuplicates: deleteIds.length,
        affectedLedgers: new Set(affected).size
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
