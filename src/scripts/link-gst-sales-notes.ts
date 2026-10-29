import "dotenv/config";
import {
    JournalDirection,
    JournalStatus,
    LedgerType,
    PaymentMode,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const apply = process.argv.includes("--apply");
const GST_SALES = "GST SALES";
const GST_SALES_PATH = "Sales Accounts / GST SALES";

const NOTE_NOS = [
    "SDN/M/2526/001",
    "SCN/M/2526/001",
    "SDN/M/2526/002",
    "SDN/M/2526/003",
    "SCN/M/2526/002",
    "SCN/M/2526/003",
    "SCN/M/2526/005",
    "SDN/M/2526/007",
    "SCN/M/2526/006",
    "SCN/M/2526/007",
    "SDN/M/2526/008",
    "SCN/M/2526/010",
    "SCN/M/2526/011"
];

const compact = (value: unknown) => String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
const wanted = new Set(NOTE_NOS.map(compact));
const isGstSalesPath = (value: unknown) =>
    String(value || "").replace(/\\/g, "/").replace(/_/g, " ").replace(/\s+/g, " ").trim().toUpperCase()
    === GST_SALES_PATH.toUpperCase();

async function gstSalesLedgerMovement(ledgerId: string) {
    const fyStart = new Date("2025-03-31T18:30:00.000Z");
    const fyEnd = new Date("2026-03-31T18:29:59.999Z");
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId,
            voucher: { voucherDate: { gte: fyStart, lte: fyEnd } }
        },
        select: { entryType: true, amount: true }
    });
    let debit = 0;
    let credit = 0;
    for (const entry of entries) {
        const amount = Number(entry.amount || 0);
        if (entry.entryType === "DEBIT") debit += amount;
        else credit += amount;
    }
    return {
        debit: Number(debit.toFixed(2)),
        credit: Number(credit.toFixed(2)),
        closingCredit: Number((credit - debit).toFixed(2))
    };
}

async function main() {
    const notes = await prisma.debitCreditNote.findMany({
        where: { noteNo: { in: NOTE_NOS } },
        select: {
            id: true,
            noteNo: true,
            type: true,
            status: true,
            sourceType: true,
            categoryPath: true,
            totalAmount: true,
            voucherId: true,
            branchId: true,
            noteDate: true,
            voucher: {
                select: {
                    voucherType: true,
                    entries: {
                        select: {
                            id: true,
                            entryType: true,
                            amount: true,
                            ledger: { select: { id: true, code: true, name: true, category: true } }
                        }
                    }
                }
            }
        }
    });

    const gstNotes = notes.filter(note =>
        note.sourceType === "SALE" &&
        note.status === "APPROVED" &&
        isGstSalesPath(note.categoryPath)
    );
    const byNo = new Map<string, typeof gstNotes>();
    for (const note of gstNotes) {
        const list = byNo.get(note.noteNo) || [];
        list.push(note);
        byNo.set(note.noteNo, list);
    }

    const gstSalesLedger = await prisma.ledger.findFirst({
        where: {
            category: LedgerType.SALES,
            code: { startsWith: "SALES-TYPE-GST_SALES-" }
        },
        select: { id: true, code: true, name: true }
    });

    const before = gstSalesLedger
        ? await gstSalesLedgerMovement(gstSalesLedger.id)
        : null;

    const alreadyLinked: string[] = [];
    const toLink: typeof gstNotes = [];
    for (const note of gstNotes) {
        const onGstSales = note.voucher?.entries.some(entry =>
            entry.ledger.category === LedgerType.SALES &&
            String(entry.ledger.code || "").startsWith("SALES-TYPE-GST_SALES-")
        );
        if (onGstSales) alreadyLinked.push(note.noteNo);
        else toLink.push(note);
    }

    const compactJournals = await prisma.journal.findMany({
        where: {
            OR: [
                { voucherNo: { contains: "SDN/M", mode: "insensitive" } },
                { voucherNo: { contains: "SCN/M", mode: "insensitive" } }
            ]
        },
        select: {
            id: true,
            voucherNo: true,
            voucherId: true,
            categoryPath: true,
            journalHead: { select: { name: true } }
        }
    });
    const matchingJournals = compactJournals.filter(journal => wanted.has(compact(journal.voucherNo)));
    const gstNoteVoucherIds = new Set(gstNotes.map(note => note.voucherId).filter(Boolean) as string[]);
    const journalsToPath = matchingJournals.filter(journal =>
        gstNoteVoucherIds.has(journal.voucherId || "") &&
        !isGstSalesPath(journal.categoryPath)
    );

    console.log(JSON.stringify({
        dryRun: !apply,
        wanted: NOTE_NOS.length,
        gstSalesNotes: gstNotes.length,
        missingGstSalesNote: NOTE_NOS.filter(no => !byNo.has(no)),
        alreadyLinked,
        toLink: toLink.map(note => ({
            noteNo: note.noteNo,
            type: note.type,
            amount: Number(note.totalAmount),
            voucherType: note.voucher?.voucherType,
            entries: note.voucher?.entries.map(entry =>
                `${entry.ledger.category}:${entry.ledger.code}:${entry.ledger.name}:${entry.entryType}:${Number(entry.amount)}`
            )
        })),
        matchingJournals: matchingJournals.map(journal => ({
            voucherNo: journal.voucherNo,
            head: journal.journalHead?.name,
            categoryPath: journal.categoryPath,
            onGstNoteVoucher: gstNoteVoucherIds.has(journal.voucherId || "")
        })),
        journalsToPath: journalsToPath.length,
        gstSalesLedger,
        gstSalesLedgerBefore: before
    }, null, 2));

    if (!apply) return;

    const actor = await prisma.user.findFirst({
        where: { email: { equals: "admin@ashtavinayaka.com", mode: "insensitive" } },
        select: { id: true }
    });
    if (!actor) throw new Error("admin@ashtavinayaka.com was not found");

    let classified = 0;
    let journalsCreated = 0;
    const failures: Array<{ noteNo: string; error: string }> = [];
    for (const note of toLink) {
        try {
            await prisma.$transaction(async tx => {
                await LedgerService.assignOutwardNoteToImportedSalesType(tx, note.id, GST_SALES);
            });
            classified += 1;
        } catch (error) {
            failures.push({
                noteNo: note.noteNo,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    const gstHeadLedger = gstSalesLedger || await prisma.ledger.findFirst({
        where: {
            category: LedgerType.SALES,
            code: { startsWith: "SALES-TYPE-GST_SALES-" }
        },
        select: { id: true, code: true, name: true }
    });
    if (!gstHeadLedger) throw new Error("GST SALES ledger was not found");

    const gstJournalHead = await prisma.journalHead.findFirst({
        where: { ledgerId: gstHeadLedger.id, name: { equals: GST_SALES, mode: "insensitive" } }
    }) || await prisma.journalHead.create({
        data: {
            name: GST_SALES,
            ledgerId: gstHeadLedger.id,
            isActive: true
        }
    });

    for (const note of gstNotes) {
        if (!note.voucherId) continue;
        try {
            const existing = await prisma.journal.findFirst({
                where: {
                    voucherId: note.voucherId,
                    categoryPath: GST_SALES_PATH
                },
                select: { id: true }
            });
            if (existing) {
                await prisma.journal.update({
                    where: { id: existing.id },
                    data: { journalHeadId: gstJournalHead.id, categoryPath: GST_SALES_PATH }
                });
                continue;
            }
            await prisma.journal.create({
                data: {
                    branchId: note.branchId,
                    journalHeadId: gstJournalHead.id,
                    importKey: `GST-SALES-NOTE:${note.id}`,
                    categoryPath: GST_SALES_PATH,
                    serialNo: `GST-SALES:${note.noteNo}`,
                    voucherNo: note.noteNo,
                    sourceSheet: "GST SALES notes",
                    amount: note.totalAmount,
                    direction: note.type === "DEBIT_NOTE"
                        ? JournalDirection.INWARD
                        : JournalDirection.OUTWARD,
                    paymentMode: PaymentMode.OFFLINE,
                    remarks: `Linked ${note.noteNo} to ${GST_SALES_PATH}`,
                    journalDate: note.noteDate,
                    status: JournalStatus.APPROVED,
                    voucherId: note.voucherId,
                    createdById: actor.id,
                    approvedById: actor.id,
                    approvedAt: new Date()
                }
            });
            journalsCreated += 1;
        } catch (error) {
            failures.push({
                noteNo: note.noteNo,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    const afterLedger = gstSalesLedger
        ? await gstSalesLedgerMovement(gstSalesLedger.id)
        : null;
    const linkedEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledger: { code: { startsWith: "SALES-TYPE-GST_SALES-" } },
            voucher: {
                voucherType: { in: [VoucherType.DEBIT_NOTE, VoucherType.CREDIT_NOTE] },
                debitCreditNotes: { some: { noteNo: { in: NOTE_NOS } } }
            }
        },
        select: {
            entryType: true,
            amount: true,
            voucher: {
                select: {
                    voucherType: true,
                    debitCreditNotes: { select: { noteNo: true } }
                }
            }
        }
    });

    console.log(JSON.stringify({
        classified,
        journalsCreated,
        failed: failures.length,
        failures,
        gstSalesLedgerAfter: afterLedger,
        linkedNoteEntries: linkedEntries.map(entry => ({
            noteNo: entry.voucher.debitCreditNotes[0]?.noteNo,
            voucherType: entry.voucher.voucherType,
            entryType: entry.entryType,
            amount: Number(entry.amount)
        }))
    }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
}).finally(() => prisma.$disconnect());
