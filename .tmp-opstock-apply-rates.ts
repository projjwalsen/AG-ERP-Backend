import { Prisma } from "@prisma/client";
import { prisma } from "./src/config/db";
import { execFileSync } from "child_process";
import { writeFileSync, existsSync, copyFileSync } from "fs";

const SKIP = "anionic emulsion ms- kg";
const SRC_XLS = "c:\\Users\\razon\\Downloads\\OPStock.xls";
const SRC_XLSX = "c:\\Users\\razon\\AG_ERP_Backend\\.tmp-opstock.xlsx";

function key(s: string) {
    return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function main() {
    let col = await prisma.$queryRaw<Array<{ numeric_precision: number; numeric_scale: number }>>`
        SELECT numeric_precision::int AS numeric_precision, numeric_scale::int AS numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'sellPricePerUnit'
    `;
    if ((col[0]?.numeric_scale ?? 2) < 10) {
        await prisma.$executeRawUnsafe(
            `ALTER TABLE "Product" ALTER COLUMN "sellPricePerUnit" TYPE DECIMAL(18,10)`
        );
        col = await prisma.$queryRaw<Array<{ numeric_precision: number; numeric_scale: number }>>`
            SELECT numeric_precision::int AS numeric_precision, numeric_scale::int AS numeric_scale
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'sellPricePerUnit'
        `;
    }
    console.log("db column sellPricePerUnit", col[0]);

    if (!existsSync(SRC_XLSX)) {
        copyFileSync(SRC_XLS, SRC_XLSX);
    }
    const py = `
import json, openpyxl
wb=openpyxl.load_workbook(r"${SRC_XLSX.replace(/\\/g, "\\\\")}", data_only=True)
ws=wb.active
rows=[]
skip=${JSON.stringify(SKIP)}
for row in ws.iter_rows(min_row=12, max_row=303, values_only=True):
    name=str(row[0] or "").strip()
    if not name or name.lower()==skip: continue
    qty, rate, val = row[1], row[2], row[3]
    if qty is None or val is None: continue
    q=float(qty); v=float(val)
    if q==0: continue
    rows.append({"name": name, "qty": q, "tallyRate": None if rate is None else float(rate), "value": v, "rawRate": v/q})
print(json.dumps(rows))
`;
    writeFileSync(".tmp-opstock-parse.py", py);
    const parsed = JSON.parse(execFileSync("py", [".tmp-opstock-parse.py"], { encoding: "utf8" }));

    const products = await prisma.product.findMany({
        select: { id: true, name: true, sellPricePerUnit: true }
    });
    const byKey = new Map<string, typeof products>();
    for (const p of products) {
        const k = key(p.name);
        const list = byKey.get(k) || [];
        list.push(p);
        byKey.set(k, list);
    }

    const results: any[] = [];
    let updated = 0;
    let skippedMissing = 0;
    let skippedAnionic = 0;
    let skippedNoChange = 0;

    for (const row of parsed) {
        if (key(row.name) === SKIP) {
            skippedAnionic++;
            continue;
        }
        const matches = byKey.get(key(row.name)) || [];
        if (!matches.length) {
            skippedMissing++;
            results.push({ name: row.name, status: "MISSING_IN_DB" });
            continue;
        }
        const raw = new Prisma.Decimal(String(row.rawRate));
        for (const product of matches) {
            const before = product.sellPricePerUnit.toString();
            await prisma.product.update({
                where: { id: product.id },
                data: { sellPricePerUnit: raw }
            });
            const after = await prisma.product.findUnique({
                where: { id: product.id },
                select: { sellPricePerUnit: true }
            });
            const stored = after!.sellPricePerUnit.toString();
            const changed = before !== stored;
            if (changed) updated++;
            else skippedNoChange++;
            results.push({
                name: product.name,
                id: product.id,
                qty: row.qty,
                tallyValue: row.value,
                tallyRate: row.tallyRate,
                rawRate: row.rawRate,
                before,
                stored,
                changed
            });
        }
    }

    const anionic = products.filter(p => key(p.name) === SKIP);
    console.log(JSON.stringify({
        column: col[0],
        excelRows: parsed.length,
        updated,
        unchanged: skippedNoChange,
        missingInDb: skippedMissing,
        skippedAnionicNamed: skippedAnionic,
        anionicLeftUntouched: anionic.map(p => ({
            id: p.id,
            name: p.name,
            sellPricePerUnit: p.sellPricePerUnit.toString()
        })),
        results
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
