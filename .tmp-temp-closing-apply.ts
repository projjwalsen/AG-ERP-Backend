import { Prisma } from "@prisma/client";
import { prisma } from "./src/config/db";

const items: Array<{ name: string; value: number }> = [
    { name: "AGGREGATE", value: 52767.86 },
    { name: "AGGREGATE COLD MIX", value: 19144.33 },
    { name: "BASE OIL 12", value: 29058245 },
    { name: "BASE OIL GRADE 2", value: 36577750 },
    { name: "BASE OIL N 600", value: 71298886 },
    { name: "BITUMEN", value: 18616129 },
    { name: "BITUMEN 27132000 - MT", value: 942211.6 },
    { name: "Bitumen Emulsion (RS-1)", value: 1177873.36 },
    { name: "Bitumen Emulsion (RS-2)", value: 26235.86 },
    { name: "BITUMEN EMULSION SS-1 OIL BASE", value: 593124 },
    { name: "BITUMEN- KG (27132000)", value: 58672 },
    { name: "BITUMEN MT (27132000)", value: 2832668 },
    { name: "BITUMEN - MTS", value: 10747974.81 },
    { name: "BS 200", value: 63210000 },
    { name: "BUTANOL NX 4190", value: 1079730.31 },
    { name: "EMPTY WOVEN BAG", value: 225000 },
    { name: "FUEL OIL (KGS) 27101990", value: 3712363.64 },
    { name: "FUEL OIL  - LITER - (27101990)", value: 167806042.16 },
    { name: "FUEL OIL - LTR", value: 1917990.2 },
    { name: "HSD-BS VI", value: 12014358 },
    { name: "Hydrochloric Acid", value: 11760.17 },
    { name: "HYDROCLORIC ACID", value: 17401.28 },
    { name: "INDUSTRIAL FUEL OIL", value: 21041323.9 },
    { name: "INDUSTRIAL HYDROCARBON OIL - KG", value: 183822666.06 },
    { name: "INDUSTRIAL HYDROCARBON OIL - KGS", value: 22963475.16 },
    { name: "Industrial Oil -KGS", value: 6383565 },
    { name: "Industrial Oil -LITER", value: 21220208.06 },
    { name: "Industrial Oil (Ltr)", value: 84007144.83 },
    { name: "ISO PROPYL ALCOHOL", value: 2002400 },
    { name: "LUBRICATING BOTTOM OIL - LTR", value: 1049980 },
    { name: "METHYL TERTIARY BUTYL ETHER", value: 1886400 },
    { name: "Micromix Additive", value: 51255 },
    { name: "MIXED HYDRO CARBON OIL-KGS(27101990)", value: 25459.6 },
    { name: "MIXED HYDROCARBON OIL - Liter (27101990)", value: 55027.25 },
    { name: "MIX SOLVENT", value: 1176160.65 },
    { name: "MONO ETHYLENE GLYCOL", value: 221940 },
    { name: "Polymer Modified Bitumen Emulsion-KG", value: 906554 },
    { name: "Prasurf P 500", value: 1153620 },
    { name: "PRASURF P 575", value: 144460 },
    { name: "Prasurf  P 620", value: 2085545 },
    { name: "PRASURF P-710", value: 173440 },
    { name: "PRASURF PV 192", value: 226800 },
    { name: "PR Solutions", value: 417361.38 },
    { name: "Redicote C 500-1 400 LB", value: 315089.47 },
    { name: "RE REFINED LUB OIL 27101971", value: 16180500 },
    { name: "U P 1159", value: 63564.5 },
    { name: "ZIPNOL LA", value: 31528125 }
];

async function main() {
    const updated: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const item of items) {
        const matches = await prisma.product.findMany({
            where: { name: { equals: item.name, mode: "insensitive" } },
            select: { id: true, name: true, tempClosingBalance: true }
        });

        if (matches.length !== 1) {
            skipped.push({
                name: item.name,
                value: item.value,
                reason: matches.length === 0 ? "not found" : `expected 1, found ${matches.length}`,
                matches: matches.map(m => ({ id: m.id, name: m.name }))
            });
            continue;
        }

        const product = matches[0];
        const before = product.tempClosingBalance?.toString() ?? null;
        await prisma.product.update({
            where: { id: product.id },
            data: { tempClosingBalance: new Prisma.Decimal(item.value) }
        });
        const after = await prisma.product.findUnique({
            where: { id: product.id },
            select: { tempClosingBalance: true }
        });

        updated.push({
            name: product.name,
            id: product.id,
            before,
            value: item.value,
            after: after?.tempClosingBalance?.toString() ?? null
        });
    }

    const sum = items.reduce((s, i) => s + i.value, 0);
    console.log(JSON.stringify({
        targetCount: items.length,
        updated: updated.length,
        skippedCount: skipped.length,
        skipped,
        sumClosingBalance: Math.round(sum * 100) / 100,
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
