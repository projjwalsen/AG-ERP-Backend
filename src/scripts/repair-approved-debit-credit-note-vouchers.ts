import { DebitCreditNoteStatus } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const main = async () => {
    const notes = await prisma.debitCreditNote.findMany({
        where: {
            status: DebitCreditNoteStatus.APPROVED,
            voucherId: null
        },
        select: { id: true, noteNo: true }
    });

    let repaired = 0;
    const failures: Array<{ id: string; noteNo: string; error: string }> = [];

    for (const note of notes) {
        try {
            await prisma.$transaction(async tx => {
                const current = await tx.debitCreditNote.findUnique({
                    where: { id: note.id },
                    select: { status: true, voucherId: true }
                });
                if (!current || current.status !== DebitCreditNoteStatus.APPROVED || current.voucherId) {
                    return;
                }

                const voucher = await LedgerService.postDebitCreditNoteApproval(tx, note.id);
                await tx.debitCreditNote.update({
                    where: { id: note.id, voucherId: null },
                    data: { voucherId: voucher.id }
                });
            });
            repaired += 1;
            console.log(`REPAIRED ${note.id} ${note.noteNo}`);
        } catch (error: any) {
            failures.push({
                id: note.id,
                noteNo: note.noteNo,
                error: error?.message || "Repair failed"
            });
            console.error(`FAILED ${note.id} ${note.noteNo}: ${error?.message || error}`);
        }
    }

    console.log(JSON.stringify({ total: notes.length, repaired, failed: failures.length, failures }, null, 2));
};

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
