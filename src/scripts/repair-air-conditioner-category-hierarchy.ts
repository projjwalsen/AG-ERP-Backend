import "dotenv/config";
import { prisma } from "../config/db";

const PARENT_HEAD_ID = "5d316e79-9a5a-4189-9d56-dbc7938ccea8";
const OFFICE_HEAD_ID = "7ea84cf6-c951-4428-9d50-a95283abac69";
const AIRCONDITIONER_HEAD_ID = "21599881-d81c-4308-9c06-350ff1a571f9";
const OFFICE_CATEGORY_ID = "3bc4fa9f-9bf4-45fe-9b1e-616ee6a2fe59";
const AIRCONDITIONER_CATEGORY_ID = "453eed2e-450c-48e5-90ff-b104b118d675";
const DUPLICATE_OFFICE_CATEGORY_ID = "d7b8fda3-3b94-4e3b-9ea2-509b05a75b05";

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const parent = await tx.journalHead.findUnique({ where: { id: PARENT_HEAD_ID } });
    const officeHead = await tx.journalHead.findUnique({ where: { id: OFFICE_HEAD_ID } });
    const airconditionerHead = await tx.journalHead.findUnique({ where: { id: AIRCONDITIONER_HEAD_ID } });

    if (!parent || parent.name.trim().toLowerCase() !== "air conditioner") {
      throw new Error("Expected Air Conditioner parent journal head was not found");
    }
    if (!officeHead || !airconditionerHead) {
      throw new Error("Expected redundant Air Conditioner journal heads were not found");
    }

    const categories = await tx.journalCategory.findMany({
      where: { id: { in: [OFFICE_CATEGORY_ID, AIRCONDITIONER_CATEGORY_ID] } },
      select: { id: true, name: true, journalHeadId: true }
    });
    if (categories.length !== 2) {
      throw new Error(`Expected two Air Conditioner categories; found ${categories.length}`);
    }

    const movedCategories = await tx.journalCategory.updateMany({
      where: { id: { in: [OFFICE_CATEGORY_ID, AIRCONDITIONER_CATEGORY_ID] } },
      data: { journalHeadId: PARENT_HEAD_ID, updatedAt: new Date() }
    });

    const mergedDuplicateJournals = await tx.journal.updateMany({
      where: { categoryId: DUPLICATE_OFFICE_CATEGORY_ID },
      data: { journalHeadId: PARENT_HEAD_ID, categoryId: OFFICE_CATEGORY_ID, updatedAt: new Date() }
    });

    const duplicateCategory = await tx.journalCategory.findUnique({ where: { id: DUPLICATE_OFFICE_CATEGORY_ID } });
    if (duplicateCategory) {
      const remaining = await tx.journal.count({ where: { categoryId: DUPLICATE_OFFICE_CATEGORY_ID } });
      if (remaining > 0) throw new Error(`Duplicate Office category still has ${remaining} journal(s)`);
      await tx.journalCategory.delete({ where: { id: DUPLICATE_OFFICE_CATEGORY_ID } });
    }

    const movedJournals = await tx.journal.updateMany({
      where: {
        journalHeadId: { in: [OFFICE_HEAD_ID, AIRCONDITIONER_HEAD_ID] },
        categoryId: { in: [OFFICE_CATEGORY_ID, AIRCONDITIONER_CATEGORY_ID] }
      },
      data: { journalHeadId: PARENT_HEAD_ID, updatedAt: new Date() }
    });

    const deactivatedHeads = await tx.journalHead.updateMany({
      where: { id: { in: [OFFICE_HEAD_ID, AIRCONDITIONER_HEAD_ID] } },
      data: { isActive: false, updatedAt: new Date() }
    });

    return { movedCategories: movedCategories.count, mergedDuplicateJournals: mergedDuplicateJournals.count, movedJournals: movedJournals.count, deactivatedHeads: deactivatedHeads.count };
  }, { maxWait: 120_000, timeout: 120_000 });

  console.log(JSON.stringify({ action: "consolidate-air-conditioner-categories", ...result }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
