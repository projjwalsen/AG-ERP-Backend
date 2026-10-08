import "dotenv/config";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const CANONICAL_CATEGORY_ID = "2a419b79-ccfa-4c7e-8dd5-40f0395cdc25";
const DUPLICATE_CATEGORY_ID = "654ea85e-635e-4e26-9064-334aff973945";
const CANONICAL_HEAD_ID = "ae4a5425-df2e-44bc-b0a7-2f8ae86fa4f0";
const DUPLICATE_HEAD_ID = "c9f9bbf3-f66a-4b4e-866d-a29b06fcd01b";
const apply = process.argv.includes("--apply");

async function main() {
  const categories = await prisma.journalCategory.findMany({
    where: { id: { in: [CANONICAL_CATEGORY_ID, DUPLICATE_CATEGORY_ID] } },
    select: { id: true, name: true, journalHeadId: true, journalHead: { select: { id: true, name: true, headType: true } } }
  });
  if (categories.length !== 2) throw new Error(`Expected both Factory Construction categories; found ${categories.length}`);

  const duplicateJournals = await prisma.journal.findMany({
    where: { categoryId: DUPLICATE_CATEGORY_ID },
    include: { voucher: { include: { entries: { select: { ledgerId: true } } } } }
  });
  const canonicalJournals = await prisma.journal.count({ where: { categoryId: CANONICAL_CATEGORY_ID } });

  console.log(JSON.stringify({
    action: "repair-factory-construction-category",
    apply,
    canonicalCategory: categories.find(c => c.id === CANONICAL_CATEGORY_ID),
    duplicateCategory: categories.find(c => c.id === DUPLICATE_CATEGORY_ID),
    canonicalJournalCount: canonicalJournals,
    duplicateJournals: duplicateJournals.map(j => ({ id: j.id, voucherId: j.voucherId, amount: String(j.amount), voucherType: j.voucher?.voucherType, voucherNo: j.voucher?.voucherNo, ledgerIds: j.voucher?.entries.map(e => e.ledgerId) }))
  }, null, 2));

  if (!apply) {
    console.log("Preview only. Re-run with --apply to remove the duplicate category and opening posting.");
    return;
  }

  const affectedLedgerIds = new Set<string>();
  for (const journal of duplicateJournals) {
    if (journal.journalHeadId === DUPLICATE_HEAD_ID) {
      const head = await prisma.journalHead.findUnique({ where: { id: DUPLICATE_HEAD_ID }, select: { ledgerId: true } });
      if (head) affectedLedgerIds.add(head.ledgerId);
    }
    for (const entry of journal.voucher?.entries || []) affectedLedgerIds.add(entry.ledgerId);
  }

  await prisma.$transaction(async tx => {
    for (const journal of duplicateJournals) {
      if (journal.voucherId && journal.voucher?.voucherType === VoucherType.OPENING_BALANCE) {
        await tx.journal.update({ where: { id: journal.id }, data: { voucherId: null } });
        await tx.ledgerEntry.deleteMany({ where: { voucherId: journal.voucherId } });
        await tx.voucher.delete({ where: { id: journal.voucherId } });
      }
      await tx.journal.delete({ where: { id: journal.id } });
    }

    const remaining = await tx.journal.count({ where: { categoryId: DUPLICATE_CATEGORY_ID } });
    if (remaining > 0) throw new Error(`Duplicate category still has ${remaining} journal(s)`);
    await tx.journalCategory.delete({ where: { id: DUPLICATE_CATEGORY_ID } });
  });

  for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(prisma, ledgerId);
  console.log(JSON.stringify({ removedDuplicateJournals: duplicateJournals.length, removedDuplicateCategory: true, affectedLedgers: [...affectedLedgerIds] }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
