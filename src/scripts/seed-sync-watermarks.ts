import { prisma } from "../config/db";
import { WatermarkService } from "../modules/internalSync/watermark.service";

async function main() {
  const count = await WatermarkService.ensureAllWatermarks();
  console.log(`SyncWatermark rows ensured: ${count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
