import "dotenv/config";
import { prisma } from "../config/db";

const BUILDING_GROUP_ID = "c21008ab-33d7-4be7-995d-7908626570b2";
const BUNGLOW_GROUP_ID = "6b230516-606b-446c-9ab6-d80add6de7c3";
const BUNGLOW_LEDGER_ID = "04aa2d8b-ceaf-44c3-9fb9-f0e481da8c02";

async function main() {
  const result = await prisma.$transaction(async tx => {
    const buildingGroup = await tx.ledgerGroup.findUnique({ where: { id: BUILDING_GROUP_ID } });
    const bunglowGroup = await tx.ledgerGroup.findUnique({ where: { id: BUNGLOW_GROUP_ID } });
    const bunglowLedger = await tx.ledger.findUnique({ where: { id: BUNGLOW_LEDGER_ID } });

    if (!buildingGroup || buildingGroup.name.trim().toLowerCase() !== "building") {
      throw new Error("Building ledger group was not found");
    }
    if (!bunglowGroup || bunglowGroup.name.trim().toLowerCase() !== "bunglow") {
      throw new Error("Bunglow ledger group was not found");
    }
    if (!bunglowLedger || bunglowLedger.name.trim().toLowerCase() !== "bunglow") {
      throw new Error("Bunglow ledger was not found");
    }

    const moved = await tx.ledger.updateMany({
      where: { id: BUNGLOW_LEDGER_ID, groupId: BUNGLOW_GROUP_ID },
      data: { groupId: BUILDING_GROUP_ID, updatedAt: new Date() }
    });

    const remaining = await tx.ledger.count({ where: { groupId: BUNGLOW_GROUP_ID } });
    return { movedLedgers: moved.count, remainingLedgersInOldGroup: remaining };
  }, { maxWait: 120_000, timeout: 120_000 });

  console.log(JSON.stringify({ action: "flatten-bunglow-ledger-group", ...result }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
