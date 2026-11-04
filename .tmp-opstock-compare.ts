import { readFileSync, writeFileSync } from "fs";
import { prisma } from "./src/config/db";

type ExcelRow = { name: string; qty: number | null; rate: number | null; value: number | null };

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const key = (s: string) =>
    String(s || "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();

async function main() {
    const excel: ExcelRow[] = JSON.parse(readFileSync(".tmp-opstock.json", "utf8"));
    const products = await prisma.product.findMany({
        select: {
            id: true,
            name: true,
            sku: true,
            openingStockKG: true,
            sellPricePerUnit: true,
            isActive: true
        }
    });

    const excelByKey = new Map<string, ExcelRow[]>();
    for (const row of excel) {
        const k = key(row.name);
        const list = excelByKey.get(k) || [];
        list.push(row);
        excelByKey.set(k, list);
    }

    const dbByKey = new Map<string, typeof products>();
    for (const p of products) {
        const k = key(p.name);
        const list = dbByKey.get(k) || [];
        list.push(p);
        dbByKey.set(k, list);
    }

    const excelNames = [...excelByKey.keys()];
    const missingInDb: ExcelRow[] = [];
    const extraInDb: Array<{ name: string; qty: number; price: number; value: number; isActive: boolean }> = [];
    const qtyMismatch: any[] = [];
    const rateMismatch: any[] = [];
    const valueMismatch: any[] = [];
    const matched: any[] = [];

    for (const k of excelNames) {
        const rows = excelByKey.get(k)!;
        const dbRows = dbByKey.get(k) || [];
        if (!dbRows.length) {
            missingInDb.push(...rows);
            continue;
        }
        const excelQty = money(rows.reduce((s, r) => s + Number(r.qty || 0), 0));
        const excelValue = money(rows.reduce((s, r) => s + Number(r.value || 0), 0));
        const excelRate = rows.find(r => r.rate != null)?.rate ?? null;
        const dbQty = money(dbRows.reduce((s, p) => s + Number(p.openingStockKG || 0), 0));
        const dbPrice = Number(dbRows[0].sellPricePerUnit || 0);
        const dbValue = money(dbRows.reduce((s, p) => s + Number(p.openingStockKG || 0) * Number(p.sellPricePerUnit || 0), 0));
        const item = {
            name: rows[0].name,
            excelQty,
            dbQty,
            excelRate,
            dbSellPrice: dbPrice,
            excelValue,
            dbValue: dbValue,
            dbCount: dbRows.length
        };
        if (Math.abs(excelQty - dbQty) > 0.001) qtyMismatch.push(item);
        if (excelRate != null && Math.abs(Number(excelRate) - dbPrice) > 0.0001) rateMismatch.push(item);
        if (Math.abs(excelValue - dbValue) > 0.02) valueMismatch.push(item);
        if (
            Math.abs(excelQty - dbQty) <= 0.001 &&
            (excelRate == null || Math.abs(Number(excelRate) - dbPrice) <= 0.0001) &&
            Math.abs(excelValue - dbValue) <= 0.02
        ) {
            matched.push(item);
        }
    }

    for (const [k, dbRows] of dbByKey) {
        if (excelByKey.has(k)) continue;
        const qty = money(dbRows.reduce((s, p) => s + Number(p.openingStockKG || 0), 0));
        if (!qty) continue;
        extraInDb.push({
            name: dbRows[0].name,
            qty,
            price: Number(dbRows[0].sellPricePerUnit || 0),
            value: money(dbRows.reduce((s, p) => s + Number(p.openingStockKG || 0) * Number(p.sellPricePerUnit || 0), 0)),
            isActive: dbRows.some(p => p.isActive)
        });
    }

    const excelTotal = money(excel.reduce((s, r) => s + Number(r.value || 0), 0));
    const dbUsedTotal = money(
        products.reduce((s, p) => s + Number(p.openingStockKG || 0) * Number(p.sellPricePerUnit || 0), 0)
    );
    const excelWithStock = excel.filter(r => Number(r.qty || 0) !== 0 || Number(r.value || 0) !== 0);

    const summary = {
        excelRows: excel.length,
        excelRowsWithStock: excelWithStock.length,
        excelTotal,
        dbProducts: products.length,
        dbProductsWithOpening: products.filter(p => Number(p.openingStockKG) !== 0).length,
        dbSellPriceTotal: dbUsedTotal,
        gap: money(excelTotal - dbUsedTotal),
        missingInDb: missingInDb.length,
        extraInDbWithOpening: extraInDb.length,
        qtyMismatch: qtyMismatch.length,
        rateMismatch: rateMismatch.length,
        valueMismatch: valueMismatch.length,
        fullyMatched: matched.length
    };

    const out = {
        summary,
        missingInDb,
        extraInDb,
        qtyMismatch: qtyMismatch.sort((a, b) => Math.abs(b.excelValue - b.dbValue) - Math.abs(a.excelValue - a.dbValue)),
        rateMismatch: rateMismatch
            .map(r => ({
                ...r,
                rateDiff: money(Number(r.excelRate || 0) - r.dbSellPrice),
                valueDiff: money(r.excelValue - r.dbValue)
            }))
            .sort((a, b) => Math.abs(b.valueDiff) - Math.abs(a.valueDiff)),
        valueMismatch: valueMismatch
            .map(r => ({ ...r, valueDiff: money(r.excelValue - r.dbValue) }))
            .sort((a, b) => Math.abs(b.valueDiff) - Math.abs(a.valueDiff)),
        missingWithValue: missingInDb.filter(r => Number(r.value || 0) !== 0)
    };
    writeFileSync(".tmp-opstock-compare.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    console.log("missingInDb sample", missingInDb.slice(0, 20).map(x => x.name));
    console.log("extraInDb", extraInDb);
    console.log("top value mismatches", out.valueMismatch.slice(0, 25));
}

main()
    .catch(err => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
