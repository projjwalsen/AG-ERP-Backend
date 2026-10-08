import "dotenv/config";
import { prisma } from "../config/db";

const FACTORY_BUILDING_GROUP_ID = "f983a738-dbc3-4045-bad9-8d78159905c5";
const CATEGORY_LEDGER_IDS = [
  "4e8e6cdd-53bf-489f-a2c4-37301b2eef32", // CEMENT
  "19e2fbb5-d6e1-4915-b26f-984bdbe90c42", // Factory Assets
  "a8879c6e-b084-41ac-9bd2-c1d2a96f2bf9"  // Factory Construction
];

async function main() {
  const ledgers = await prisma.ledger.findMany({
    where: { id: { in: CATEGORY_LEDGER_IDS } },
    select: { id: true, name: true, groupId: true }
  });
  if (ledgers.length !== CATEGORY_LEDGER_IDS.length) {
    throw new Error(`Expected ${CATEGORY_LEDGER_IDS.length} category ledgers; found ${ledgers.length}`);
  }

  const result = await prisma.$transaction(async tx => tx.ledger.updateMany({
    where: { id: { in: CATEGORY_LEDGER_IDS }, groupId: { not: FACTORY_BUILDING_GROUP_ID } },
    data: { groupId: FACTORY_BUILDING_GROUP_ID, updatedAt: new Date() }
  }));

  console.log(JSON.stringify({
    action: "flatten-factory-building-category-ledgers",
    factoryBuildingGroupId: FACTORY_BUILDING_GROUP_ID,
    ledgers,
    movedLedgers: result.count
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
