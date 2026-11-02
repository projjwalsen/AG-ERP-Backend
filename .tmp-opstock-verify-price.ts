import { readFileSync } from "fs";
import { prisma } from "./src/config/db";

type ExcelRow = { name: string; qty: number | null; rate: number | null; value: number | null };
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const key = (s: string) =>
    String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();

async function main() {
    const anionic = await prisma.product.findMany({
        where: { name: { equals: "ANIONIC EMULSION MS- KG", mode: "insensitive" } },
        select: { id: true, name: true, sellPricePerUnit: true, openingStockKG: true }
    });

    const excel: ExcelRow[] = JSON.parse(readFileSync(".tmp-opstock.json", "utf8"));
    const products = await prisma.product.findMany({
        select: { name: true, openingStockKG: true, sellPricePerUnit: true }
    });
    const db = new Map(products.map(p => [key(p.name), p]));

    let pnlSum = 0;
    let tallySum = 0;
    const leftover: Array<Record<string, unknown>> = [];
    for (const row of excel) {
        if (!Number(row.qty) || row.value == null) continue;
        const p = db.get(key(row.name));
        if (!p) continue;
        const line = money(Number(p.openingStockKG) * Number(p.sellPricePerUnit));
        pnlSum = money(pnlSum + line);
        tallySum = money(tallySum + Number(row.value));
        const diff = money(Number(row.value) - line);
        if (Math.abs(diff) >= 0.005) {
            leftover.push({
                name: row.name,
                skippedAnionic: key(row.name) === "anionic emulsion ms- kg",
                tallyValue: Number(row.value),
                liveLine: line,
                diff
            });
        }
    }

    console.log(JSON.stringify({
        anionicUntouched: anionic,
        tallyOpeningValue: tallySum,
        liveOpeningQtyTimesPrice: pnlSum,
        remainingGap: money(tallySum - pnlSum),
        leftoverMismatches: leftover
    }, null, 2));
}

main().finally(() => prisma.$disconnect());
