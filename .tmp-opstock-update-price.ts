import { readFileSync } from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "./src/config/db";

type ExcelRow = { name: string; qty: number | null; rate: number | null; value: number | null };

const SKIP = "anionic emulsion ms- kg";
const key = (s: string) =>
    String(s || "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();

async function main() {
    const scale = await prisma.$queryRaw<Array<{ numeric_precision: number; numeric_scale: number }>>`
        SELECT numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_name = 'Product' AND column_name = 'sellPricePerUnit'
    `;
    console.log("sellPricePerUnit column", scale[0]);

    const excel: ExcelRow[] = JSON.parse(readFileSync(".tmp-opstock.json", "utf8"));
    const targets = excel
        .filter(row => key(row.name) !== SKIP)
        .filter(row => Number(row.qty) && row.value != null)
        .map(row => {
            const qty = Number(row.qty);
            const value = Number(row.value);
            const raw = value / qty;
            return {
                name: row.name,
                key: key(row.name),
                qty,
                tallyRate: row.rate,
                value,
                rawRate: raw,
                rawText: raw.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")
            };
        });

    const results: Array<Record<string, unknown>> = [];
    for (const target of targets) {
        const matches = await prisma.product.findMany({
            where: { name: { equals: target.name, mode: "insensitive" } },
            select: { id: true, name: true, sellPricePerUnit: true }
        });
        if (matches.length !== 1) {
            results.push({
                name: target.name,
                status: "SKIPPED",
                reason: matches.length === 0 ? "not found" : `expected 1 product, found ${matches.length}`,
                ids: matches.map(m => m.id)
            });
            continue;
        }
        const product = matches[0];
        const before = product.sellPricePerUnit.toString();
        await prisma.product.update({
            where: { id: product.id },
            data: { sellPricePerUnit: new Prisma.Decimal(target.rawText) }
        });
        const after = await prisma.product.findUnique({
            where: { id: product.id },
            select: { sellPricePerUnit: true }
        });
        results.push({
            name: product.name,
            id: product.id,
            status: "UPDATED",
            before,
            rawRate: target.rawText,
            after: after?.sellPricePerUnit.toString()
        });
    }

    const skipped = results.filter(r => r.status === "SKIPPED");
    const updated = results.filter(r => r.status === "UPDATED");
    console.log(JSON.stringify({
        column: scale[0],
        targetCount: targets.length,
        updated: updated.length,
        skipped,
        updated
    }, null, 2));
}

main()
    .catch(err => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
