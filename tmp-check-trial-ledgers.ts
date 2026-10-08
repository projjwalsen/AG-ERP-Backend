import "dotenv/config";
import { prisma } from "./src/config/db";

async function main() {
  const names = ["Building", "Factory Building", "CEMENT", "Factory Assets", "Factory Construction"];
  const rows = await prisma.ledger.findMany({
    where: { name: { in: names, mode: "insensitive" } },
    select: { id: true, name: true, isActive: true, branchId: true, currentBalance: true, groupId: true, group: { select: { id: true, name: true, parentId: true } }, journalHeads: { select: { id: true, name: true, isActive: true, categories: { select: { id: true, name: true, isActive: true } } } } }
  });
  console.log(JSON.stringify(rows.map(r => ({ ...r, currentBalance: String(r.currentBalance) })), null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
