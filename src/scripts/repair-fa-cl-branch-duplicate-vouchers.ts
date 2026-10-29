import "dotenv/config";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const apply = process.argv.includes("--apply");
const OFFICE_LEDGER_ID = "0bcfcb7d-4ea3-4518-aa72-8b6c1c332cdf";
const EXTRA_OFFICE_VOUCHER_NO = "252600485/NX/PAN";
const EXTRA_OFFICE_AMOUNT = 70312.5;

const n = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const indiaDate = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
}).format(d);

async function groupTree(names: string[]) {
    const groups = await prisma.ledgerGroup.findMany({
        select: { id: true, name: true, parentId: true }
    });
    const roots = groups.filter(g => names.includes(n(g.name).toLowerCase()));
    const ids = new Set(roots.map(g => g.id));
    let growing = true;
    while (growing) {
        growing = false;
        for (const g of groups) {
            if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                ids.add(g.id);
                growing = true;
            }
        }
    }
    return { ids, groups };
}

async function safeDeleteJournal(tx: typeof prisma, journalId: string, voucherId: string | null) {
    await tx.journal.delete({ where: { id: journalId } });
    if (!voucherId) return;
    const refs = await tx.voucher.findUnique({
        where: { id: voucherId },
        select: {
            journals: { select: { id: true }, take: 1 },
            transaction: { select: { id: true }, take: 1 },
            debitCreditNotes: { select: { id: true }, take: 1 },
            manufactures: { select: { id: true }, take: 1 }
        }
    });
    if (
        refs &&
        refs.journals.length === 0 &&
        refs.transaction.length === 0 &&
        refs.debitCreditNotes.length === 0 &&
        refs.manufactures.length === 0
    ) {
        await tx.ledgerEntry.deleteMany({ where: { voucherId } });
        await tx.voucher.delete({ where: { id: voucherId } });
    }
}

async function main() {
    const { ids } = await groupTree([
        "fixed assets",
        "current liabilities",
        "branch / divisions",
        "branch/divisions",
        "branch / division"
    ]);
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: {
            id: true,
            name: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    });
    const ledgerIds = ledgers.map(l => l.id);
    const pathOf = (id: string) => {
        const l = ledgers.find(x => x.id === id);
        return [l?.group.parent?.name, l?.group.name, l?.name].filter(Boolean).join(" / ");
    };

    const openings = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgerIds },
            voucher: { voucherType: VoucherType.OPENING_BALANCE }
        },
        select: {
            id: true,
            ledgerId: true,
            amount: true,
            entryType: true,
            createdAt: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    voucherDate: true,
                    journals: { select: { id: true, createdAt: true } },
                    transaction: { select: { id: true }, take: 1 },
                    debitCreditNotes: { select: { id: true }, take: 1 },
                    manufactures: { select: { id: true }, take: 1 },
                    entries: { select: { id: true } }
                }
            }
        },
        orderBy: { createdAt: "asc" }
    });

    const openingGroups = new Map<string, typeof openings>();
    for (const row of openings) {
        const key = [
            row.ledgerId,
            indiaDate(row.voucher.voucherDate),
            row.entryType,
            money(row.amount).toFixed(2)
        ].join("|");
        openingGroups.set(key, [...(openingGroups.get(key) || []), row]);
    }

    const openingDeletes: Array<{
        path: string;
        amount: number;
        keepVoucherNo: string;
        dropVoucherNo: string;
        journalId: string;
        voucherId: string;
        ledgerId: string;
    }> = [];

    for (const list of openingGroups.values()) {
        if (list.length < 2) continue;
        const ranked = [...list].sort((a, b) => {
            const aIstMidnight = a.voucher.voucherDate.toISOString() === "2025-03-31T18:30:00.000Z" ? 0 : 1;
            const bIstMidnight = b.voucher.voucherDate.toISOString() === "2025-03-31T18:30:00.000Z" ? 0 : 1;
            if (aIstMidnight !== bIstMidnight) return aIstMidnight - bIstMidnight;
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
        const keep = ranked[0];
        for (const drop of ranked.slice(1)) {
            if (drop.voucher.transaction.length || drop.voucher.debitCreditNotes.length || drop.voucher.manufactures.length) {
                throw new Error(`Opening ${drop.voucher.voucherNo} is linked to a source document`);
            }
            if (drop.voucher.entries.length !== 1) {
                throw new Error(`Opening ${drop.voucher.voucherNo} has ${drop.voucher.entries.length} entries`);
            }
            const journalId = drop.voucher.journals[0]?.id;
            if (!journalId) throw new Error(`Opening ${drop.voucher.voucherNo} has no journal`);
            openingDeletes.push({
                path: pathOf(drop.ledgerId),
                amount: money(drop.amount),
                keepVoucherNo: keep.voucher.voucherNo,
                dropVoucherNo: drop.voucher.voucherNo,
                journalId,
                voucherId: drop.voucher.id,
                ledgerId: drop.ledgerId
            });
        }
    }

    const officeExtra = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: OFFICE_LEDGER_ID,
            amount: EXTRA_OFFICE_AMOUNT,
            voucher: { voucherNo: EXTRA_OFFICE_VOUCHER_NO, voucherType: VoucherType.JOURNAL }
        },
        select: {
            id: true,
            ledgerId: true,
            amount: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    journals: { select: { id: true, sourceSheet: true } },
                    transaction: { select: { id: true }, take: 1 },
                    debitCreditNotes: { select: { id: true }, take: 1 },
                    manufactures: { select: { id: true }, take: 1 },
                    entries: { select: { id: true } }
                }
            }
        }
    });
    if (!officeExtra) throw new Error("Air Conditioner - Office extra journal 252600485/NX/PAN 70312.50 was not found");
    if (
        officeExtra.voucher.transaction.length ||
        officeExtra.voucher.debitCreditNotes.length ||
        officeExtra.voucher.manufactures.length ||
        officeExtra.voucher.entries.length !== 1 ||
        !officeExtra.voucher.journals[0]
    ) {
        throw new Error("Air Conditioner - Office extra journal is not a safe exclusive one-sided journal");
    }

    const journalEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgerIds },
            voucher: { voucherType: VoucherType.JOURNAL }
        },
        select: {
            id: true,
            ledgerId: true,
            amount: true,
            entryType: true,
            createdAt: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    voucherDate: true,
                    journals: { select: { id: true, sourceSheet: true, createdAt: true } },
                    transaction: { select: { id: true }, take: 1 },
                    debitCreditNotes: { select: { id: true }, take: 1 },
                    manufactures: { select: { id: true }, take: 1 },
                    entries: { select: { id: true } }
                }
            }
        },
        orderBy: { createdAt: "asc" }
    });

    const journalGroups = new Map<string, typeof journalEntries>();
    for (const row of journalEntries) {
        if (row.voucher.voucherNo === EXTRA_OFFICE_VOUCHER_NO && money(row.amount) === EXTRA_OFFICE_AMOUNT) continue;
        const key = [
            row.ledgerId,
            n(row.voucher.voucherNo).toUpperCase(),
            indiaDate(row.voucher.voucherDate),
            row.entryType,
            money(row.amount).toFixed(2)
        ].join("|");
        journalGroups.set(key, [...(journalGroups.get(key) || []), row]);
    }

    const journalDeletes: Array<{
        path: string;
        voucherNo: string;
        amount: number;
        keepSheet: string | null;
        dropSheet: string | null;
        journalId: string;
        voucherId: string;
        ledgerId: string;
    }> = [];
    const unexpectedJournalDupes: string[] = [];

    for (const list of journalGroups.values()) {
        if (list.length < 2) continue;
        const sheets = list.map(r => r.voucher.journals[0]?.sourceSheet || "");
        const hasRegister = sheets.includes("Journal Register");
        const hasSheet1 = sheets.includes("Sheet1");
        if (!(list.length === 2 && hasRegister && hasSheet1)) {
            unexpectedJournalDupes.push(
                `${pathOf(list[0].ledgerId)} ${list[0].voucher.voucherNo} sheets=${sheets.join(",")}`
            );
            continue;
        }
        const keep = list.find(r => r.voucher.journals[0]?.sourceSheet === "Journal Register")!;
        const drop = list.find(r => r.voucher.journals[0]?.sourceSheet === "Sheet1")!;
        if (drop.voucher.transaction.length || drop.voucher.debitCreditNotes.length || drop.voucher.manufactures.length) {
            throw new Error(`Journal ${drop.voucher.voucherNo} is linked to a source document`);
        }
        if (drop.voucher.entries.length !== 1) {
            throw new Error(`Journal ${drop.voucher.voucherNo} has ${drop.voucher.entries.length} entries`);
        }
        const journalId = drop.voucher.journals[0]?.id;
        if (!journalId) throw new Error(`Journal ${drop.voucher.voucherNo} has no journal`);
        journalDeletes.push({
            path: pathOf(drop.ledgerId),
            voucherNo: drop.voucher.voucherNo,
            amount: money(drop.amount),
            keepSheet: keep.voucher.journals[0]?.sourceSheet || null,
            dropSheet: drop.voucher.journals[0]?.sourceSheet || null,
            journalId,
            voucherId: drop.voucher.id,
            ledgerId: drop.ledgerId
        });
    }

    const moneyVoucherEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ledgerIds },
            voucher: {
                voucherType: {
                    in: [
                        VoucherType.RECEIPT,
                        VoucherType.PAYMENT,
                        VoucherType.CASH_RECEIPT,
                        VoucherType.CASH_PAYMENT,
                        VoucherType.BANK_RECEIPT,
                        VoucherType.BANK_PAYMENT,
                        VoucherType.CONTRA
                    ]
                }
            }
        },
        select: {
            ledgerId: true,
            amount: true,
            entryType: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    voucherType: true,
                    voucherDate: true,
                    journals: { select: { id: true } },
                    transaction: { select: { id: true }, take: 1 },
                    debitCreditNotes: { select: { id: true }, take: 1 },
                    manufactures: { select: { id: true }, take: 1 },
                    entries: { select: { id: true } }
                }
            }
        }
    });
    const moneyGroups = new Map<string, typeof moneyVoucherEntries>();
    for (const row of moneyVoucherEntries) {
        const key = [
            row.ledgerId,
            row.voucher.voucherType,
            n(row.voucher.voucherNo).toUpperCase(),
            indiaDate(row.voucher.voucherDate),
            row.entryType,
            money(row.amount).toFixed(2)
        ].join("|");
        moneyGroups.set(key, [...(moneyGroups.get(key) || []), row]);
    }
    const moneyDupes = [...moneyGroups.values()]
        .filter(list => list.length > 1)
        .map(list => ({
            path: pathOf(list[0].ledgerId),
            type: list[0].voucher.voucherType,
            voucherNo: list[0].voucher.voucherNo,
            amount: money(list[0].amount),
            count: list.length,
            extraEntries: list.map(r => r.voucher.entries.length)
        }));

    const branchLedgers = ledgers.filter(l =>
        /branch/i.test([l.group.parent?.name, l.group.name, l.name].join(" "))
    );
    const branchEntries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: branchLedgers.map(l => l.id) } },
        select: {
            ledgerId: true,
            amount: true,
            entryType: true,
            voucher: { select: { voucherType: true, voucherNo: true, voucherDate: true } }
        }
    });

    const preview = {
        apply,
        openingDeletes: openingDeletes.length,
        openingSample: openingDeletes.slice(0, 20),
        officeExtra: {
            voucherNo: officeExtra.voucher.voucherNo,
            amount: money(officeExtra.amount),
            journalId: officeExtra.voucher.journals[0].id,
            voucherId: officeExtra.voucher.id
        },
        sheet1JournalDeletes: journalDeletes.length,
        unexpectedJournalDupes,
        moneyDupes: moneyDupes.length,
        moneyDupeSample: moneyDupes.slice(0, 20),
        branchLedgerCount: branchLedgers.length,
        branchEntryCount: branchEntries.length,
        branchByLedger: branchLedgers.map(l => {
            const rows = branchEntries.filter(e => e.ledgerId === l.id);
            const debit = rows.filter(r => r.entryType === "DEBIT").reduce((s, r) => s + money(r.amount), 0);
            const credit = rows.filter(r => r.entryType === "CREDIT").reduce((s, r) => s + money(r.amount), 0);
            return {
                path: pathOf(l.id),
                entries: rows.length,
                debit: money(debit),
                credit: money(credit),
                net: money(debit - credit),
                vouchers: rows.map(r => ({
                    type: r.voucher.voucherType,
                    no: r.voucher.voucherNo,
                    amount: money(r.amount),
                    side: r.entryType
                }))
            };
        })
    };
    console.log(JSON.stringify(preview, null, 2));

    if (unexpectedJournalDupes.length) {
        throw new Error(`Refusing to apply: ${unexpectedJournalDupes.length} journal duplicate group(s) are not Journal Register vs Sheet1`);
    }
    if (!apply) {
        console.log("Preview only. Re-run with --apply to delete the duplicate vouchers.");
        return;
    }

    const affected = new Set<string>([
        ...openingDeletes.map(r => r.ledgerId),
        ...journalDeletes.map(r => r.ledgerId),
        officeExtra.ledgerId
    ]);

    const allDeletes = [
        {
            journalId: officeExtra.voucher.journals[0].id,
            voucherId: officeExtra.voucher.id
        },
        ...openingDeletes,
        ...journalDeletes
    ];
    const chunkSize = 40;
    for (let i = 0; i < allDeletes.length; i += chunkSize) {
        const chunk = allDeletes.slice(i, i + chunkSize);
        await prisma.$transaction(async tx => {
            for (const row of chunk) {
                await safeDeleteJournal(tx, row.journalId, row.voucherId);
            }
        }, { maxWait: 120_000, timeout: 120_000 });
        console.log(`deleted ${Math.min(i + chunkSize, allDeletes.length)}/${allDeletes.length}`);
    }
    for (const ledgerId of affected) {
        await LedgerService.syncCachedBalance(prisma, ledgerId);
    }

    const officeAfter = await prisma.ledgerEntry.findMany({
        where: { ledgerId: OFFICE_LEDGER_ID },
        select: {
            amount: true,
            entryType: true,
            voucher: { select: { voucherType: true, voucherNo: true, voucherDate: true } }
        }
    });
    const officeDebit = officeAfter
        .filter(r => r.entryType === "DEBIT")
        .reduce((s, r) => s + money(r.amount), 0);
    const officeCredit = officeAfter
        .filter(r => r.entryType === "CREDIT")
        .reduce((s, r) => s + money(r.amount), 0);

    console.log(JSON.stringify({
        deleted: {
            officeExtra: 1,
            openings: openingDeletes.length,
            sheet1Journals: journalDeletes.length
        },
        officeRemaining: officeAfter.map(r => ({
            type: r.voucher.voucherType,
            no: r.voucher.voucherNo,
            utc: r.voucher.voucherDate,
            amount: money(r.amount),
            side: r.entryType
        })),
        officeNet: money(officeDebit - officeCredit)
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
