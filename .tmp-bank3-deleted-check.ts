import "dotenv/config";
import { prisma } from "./src/config/db";

const IDS = [
    "2b744cfe-5386-4a19-9d0e-8b63e072aeb6",
    "54fdb22f-302a-4ac8-b819-ad248d257484",
    "af65468d-8c27-457b-9345-e4ad30ffb4c7",
    "da9edbda-a073-4412-900f-4a37e5527ac5",
    "44248575-bd91-4169-ac15-07071655f9dc",
    "0d486169-2d2a-48c7-a8ed-e72653a32b14",
    "5d88ca71-6f03-42d1-96b3-66f999e20e63",
    "f35776e2-9c54-4ada-bb68-5bf1bd2a2797",
    "34ac8d15-d99f-4650-bebd-6c07020aa55d",
    "637537da-e499-4a4b-a0ed-b37e8eb0c874"
];

(async () => {
    const still = await prisma.voucher.findMany({
        where: { id: { in: IDS } },
        select: { id: true, voucherNo: true, voucherType: true, _count: { select: { entries: true, journals: true } } }
    });
    const entriesStill = await prisma.ledgerEntry.findMany({
        where: { voucherId: { in: IDS } },
        select: { id: true, voucherId: true, ledger: { select: { name: true } }, entryType: true, amount: true }
    });
    console.log(JSON.stringify({ still, leftoverEntries: entriesStill, missing: IDS.filter(id => !still.some(s => s.id === id)) }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
