import { prisma } from "./src/config/db";

const SKIP = "anionic emulsion ms- kg";
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const key = (s: string) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

async function main() {
    const products = await prisma.product.findMany({
        select: { name: true, openingStockKG: true, sellPricePerUnit: true }
    });
    let all = 0;
    let exceptAnionic = 0;
    let anionic = 0;
    for (const p of products) {
        const v = Number(p.openingStockKG) * Number(p.sellPricePerUnit);
        all += v;
        if (key(p.name) === SKIP) anionic += v;
        else exceptAnionic += v;
    }
    console.log(JSON.stringify({
        liveOpeningAll: money(all),
        liveExceptAnionic: money(exceptAnionic),
        anionicValue: money(anionic),
        tallyGrand: 368726872.59,
        gapVsTally: money(368726872.59 - all)
    }, null, 2));
}

main().finally(() => prisma.$disconnect());
