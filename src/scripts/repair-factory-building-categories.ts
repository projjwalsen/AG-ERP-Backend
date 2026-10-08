import "dotenv/config";
import { VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const FACTORY_BUILDING_HEAD_ID = "ae4a5425-df2e-44bc-b0a7-2f8ae86fa4f0";
const CEMENT_HEAD_ID = "c9f9bbf3-f66a-4b4e-866d-a29b06fcd01b";
const FACTORY_ASSETS_HEAD_ID = "45dd2c06-1fa6-43df-94b5-25385b7312b1";
const CEMENT_CATEGORY_ID = "48b75142-f847-47d9-8458-39282bd69726";
const DUPLICATE_FACTORY_ASSETS_CATEGORY_ID = "9a7c56a6-e9f0-4afa-a2fa-6c9b55af053f";
const CANONICAL_FACTORY_ASSETS_CATEGORY_ID = "ec9495fc-465a-46b4-9132-509c49917b55";
const apply = process.argv.includes("--apply");

async function main() {
  const duplicateFactoryAssetsJournals = await prisma.journal.findMany({
    where: { categoryId: DUPLICATE_FACTORY_ASSETS_CATEGORY_ID },
    include: { voucher: { include: { entries: { select: { ledgerId: true } } } } }
  });

  const preview = {
    action: "repair-factory-building-categories",
    apply,
    factoryBuildingHeadId: FACTORY_BUILDING_HEAD_ID,
    categoriesMovedUnderFactoryBuilding: [CEMENT_CATEGORY_ID, CANONICAL_FACTORY_ASSETS_CATEGORY_ID],
    duplicateFactoryAssetsCategoryId: DUPLICATE_FACTORY_ASSETS_CATEGORY_ID,
    duplicateFactoryAssetsJournals: duplicateFactoryAssetsJournals.map(j => ({
      journalId: j.id,
      voucherId: j.voucherId,
      amount: String(j.amount),
      voucherType: j.voucher?.voucherType,
      ledgerIds: j.voucher?.entries.map(entry => entry.ledgerId)
    }))
  };
  console.log(JSON.stringify(preview, null, 2));

  if (!apply) {
    console.log("Preview only. Re-run with --apply to repair the hierarchy.");
    return;
  }

  const affectedLedgerIds = new Set<string>();
  for (const journal of duplicateFactoryAssetsJournals) {
    for (const entry of journal.voucher?.entries || []) affectedLedgerIds.add(entry.ledgerId);
  }

  await prisma.$transaction(async tx => {
    // Move the valid CEMENT category and all of its journals to Factory Building.
    await tx.journalCategory.update({
      where: { id: CEMENT_CATEGORY_ID },
      data: { journalHeadId: FACTORY_BUILDING_HEAD_ID, updatedAt: new Date() }
    });
    await tx.journal.updateMany({
      where: { journalHeadId: CEMENT_HEAD_ID, categoryId: CEMENT_CATEGORY_ID },
      data: { journalHeadId: FACTORY_BUILDING_HEAD_ID, updatedAt: new Date() }
    });
    await tx.journal.updateMany({
      where: { journalHeadId: FACTORY_ASSETS_HEAD_ID, categoryId: CANONICAL_FACTORY_ASSETS_CATEGORY_ID },
      data: { journalHeadId: FACTORY_BUILDING_HEAD_ID, updatedAt: new Date() }
    });

    // Remove the duplicate Factory Assets opening posting. The canonical
    // Factory Assets category already has the same opening amount.
    for (const journal of duplicateFactoryAssetsJournals) {
      if (journal.voucherId && journal.voucher?.voucherType === VoucherType.OPENING_BALANCE) {
        await tx.journal.update({ where: { id: journal.id }, data: { voucherId: null } });
        await tx.ledgerEntry.deleteMany({ where: { voucherId: journal.voucherId } });
        await tx.voucher.delete({ where: { id: journal.voucherId } });
      }
      await tx.journal.delete({ where: { id: journal.id } });
    }

    const remaining = await tx.journal.count({ where: { categoryId: DUPLICATE_FACTORY_ASSETS_CATEGORY_ID } });
    if (remaining > 0) throw new Error(`Duplicate Factory Assets category still has ${remaining} journal(s)`);
    await tx.journalCategory.delete({ where: { id: DUPLICATE_FACTORY_ASSETS_CATEGORY_ID } });

    // Both records are now represented by categories under Factory Building.
    // Preserve the old heads and ledgers for historical references, but remove
    // them from normal journal-head selection.
    await tx.journalHead.updateMany({
      where: { id: { in: [CEMENT_HEAD_ID, FACTORY_ASSETS_HEAD_ID] } },
      data: { isActive: false, updatedAt: new Date() }
    });
  });

  for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(prisma, ledgerId);
  console.log(JSON.stringify({ repaired: true, removedDuplicateFactoryAssetsJournals: duplicateFactoryAssetsJournals.length, affectedLedgers: [...affectedLedgerIds] }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
