import "dotenv/config";
import { EntryType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const n = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const compact = (value: unknown) => n(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();
const money = (value: number) => Number(value.toFixed(2));
const accountAlias = (value: unknown) => {
    const key = compact(value);
    if (["ROFF", "ROUNDOFF", "ROUNDOFFACCOUNT", "AMOUNTROFF"].includes(key)) return "ROUNDOFF";
    return key;
};
const FY_START = new Date("2025-03-31T18:30:00.000Z");
const FY_END = new Date("2026-03-31T18:29:59.999Z");
const TALLY = 183365186.41;
const apply = process.argv.includes("--apply");

async function main() {
    const groups = await prisma.ledgerGroup.findMany({ select: { id: true, name: true, parentId: true } });
    const roots = groups.filter(g => ["indirect expense", "indirect expenses"].includes(n(g.name).toLowerCase()));
    const ids = new Set(roots.map(g => g.id));
    let growing = true;
    while (growing) {
        growing = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); growing = true; }
    }
    const ledgers = await prisma.ledger.findMany({ where: { groupId: { in: [...ids] } }, select: { id: true, name: true } });
    const ledgerName = new Map(ledgers.map(l => [l.id, l.name]));
    const entries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ledgers.map(l => l.id) }, voucher: { voucherDate: { gte: FY_START, lte: FY_END } } },
        select: {
            id: true,
            ledgerId: true,
            entryType: true,
            amount: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    createdAt: true,
                    journals: { select: { id: true, sourceSheet: true } },
                    transaction: { select: { id: true }, take: 1 },
                    debitCreditNotes: { select: { id: true }, take: 1 },
                    manufactures: { select: { id: true }, take: 1 },
                    entries: { select: { id: true } }
                }
            }
        }
    });
    const rows = entries.map(e => ({
        ledgerId: e.ledgerId,
        voucherId: e.voucher.id,
        voucherNo: n(e.voucher.voucherNo),
        account: ledgerName.get(e.ledgerId) || "",
        signed: e.entryType === EntryType.DEBIT ? Number(e.amount) : -Number(e.amount),
        createdAt: e.voucher.createdAt,
        sourceSheet: e.voucher.journals[0]?.sourceSheet || "",
        journalIds: e.voucher.journals.map(j => j.id),
        hasOtherLinks: e.voucher.transaction.length + e.voucher.debitCreditNotes.length + e.voucher.manufactures.length > 0,
        entryCount: e.voucher.entries.length,
        key: [compact(e.voucher.voucherNo), accountAlias(ledgerName.get(e.ledgerId) || ""), e.entryType, Number(e.amount).toFixed(2)].join("|")
    }));
    const byKey = new Map<string, typeof rows>();
    for (const row of rows) {
        const list = byKey.get(row.key) || [];
        list.push(row);
        byKey.set(row.key, list);
    }
    const extras = [...byKey.values()].flatMap(list => {
        const unique = new Map<string, typeof rows[0]>();
        for (const row of list) if (!unique.has(row.voucherId)) unique.set(row.voucherId, row);
        if (unique.size < 2) return [];
        const copies = [...unique.values()].sort((a, b) => {
            const aPdf = a.sourceSheet === "Indirect Expenses PDF" ? 1 : 0;
            const bPdf = b.sourceSheet === "Indirect Expenses PDF" ? 1 : 0;
            if (aPdf !== bPdf) return aPdf - bPdf;
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
        return copies.slice(1).filter(row =>
            row.sourceSheet === "Indirect Expenses PDF" &&
            !row.hasOtherLinks &&
            row.entryCount === 1
        );
    });
    const extraIds = [...new Set(extras.map(r => r.voucherId))];
    const extraNet = money(extras.reduce((s, r) => s + r.signed, 0));
    const beforeNet = money(rows.reduce((s, r) => s + r.signed, 0));
    console.log(JSON.stringify({
        dryRun: !apply,
        beforeNet,
        tally: TALLY,
        extraCopies: extraIds.length,
        extraNet,
        afterNetIfDeleted: money(beforeNet - extraNet)
    }, null, 2));
    if (!apply) return;

    const touchedLedgers = new Set<string>();
    let deleted = 0;
    for (const extra of extras) {
        for (const journalId of extra.journalIds) {
            await prisma.journal.delete({ where: { id: journalId } }).catch(() => undefined);
        }
        await prisma.voucher.delete({ where: { id: extra.voucherId } });
        touchedLedgers.add(extra.ledgerId);
        deleted += 1;
        if (deleted % 50 === 0) console.log(JSON.stringify({ deleted, of: extraIds.length }));
    }
    for (const ledgerId of touchedLedgers) await LedgerService.syncCachedBalance(prisma, ledgerId);
    const afterEntries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ledgers.map(l => l.id) }, voucher: { voucherDate: { gte: FY_START, lte: FY_END } } },
        select: { amount: true, entryType: true, ledger: { select: { name: true } } }
    });
    const afterNet = money(afterEntries.reduce((s, e) => s + (e.entryType === EntryType.DEBIT ? Number(e.amount) : -Number(e.amount)), 0));
    const roundOff = money(afterEntries
        .filter(e => accountAlias(e.ledger.name) === "ROUNDOFF")
        .reduce((s, e) => s + (e.entryType === EntryType.DEBIT ? Number(e.amount) : -Number(e.amount)), 0));
    console.log(JSON.stringify({
        deleted,
        afterNet,
        tally: TALLY,
        gap: money(afterNet - TALLY),
        roundOffNet: roundOff
    }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
