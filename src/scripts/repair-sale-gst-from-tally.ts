import "dotenv/config";
import fs from "node:fs";
import XLSX from "xlsx";
import { prisma } from "../config/db";

const file = process.argv[2] || "D:/SALEGST.xlsx";
const apply = process.argv.includes("--apply");
const money = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;
if (!fs.existsSync(file)) throw new Error(`Workbook not found: ${file}`);
const wb = XLSX.readFile(file, { cellDates: true });
const data = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const input = data.slice(11).filter(r => r[2] === "Tax Invoice" && r[3]).map(r => ({
    invoiceNo: String(r[3]).trim(), party: String(r[1] || ""), taxable: money(r[4]), igst: money(r[5]),
    cgst: money(r[6]), sgst: money(r[7]), gst: money(r[9]), total: money(r[10])
}));
const duplicateWorkbookVouchers = input.length - new Set(input.map(x => x.invoiceNo)).size;
const vouchers = [...new Map(input.map(x => [x.invoiceNo, x])).values()];
async function main() {
const sales = await prisma.sale.findMany({ where: { invoiceNo: { in: vouchers.map(v => v.invoiceNo) } }, include: { agency: true } });
const saleMap = new Map(sales.map(s => [s.invoiceNo, s]));
const matched = vouchers.filter(v => saleMap.has(v.invoiceNo));
const agencyIds = new Set(matched.map(v => saleMap.get(v.invoiceNo)!.agencyId));
console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", workbookRows: input.length, duplicateWorkbookVouchers, uniqueVouchers: vouchers.length, matchedVouchers: matched.length, missingVouchers: vouchers.length - matched.length, agenciesToUpdate: agencyIds.size }, null, 2));
if (!apply) { await prisma.$disconnect(); process.exit(0); }
await prisma.$transaction(async tx => {
    for (const v of matched) {
        const sale = saleMap.get(v.invoiceNo)!;
        await tx.sale.update({ where: { id: sale.id }, data: { subTotalAmount: v.taxable, totalIGSTAmount: v.igst, totalCGSTAmount: v.cgst, totalSGSTAmount: v.sgst, totalGSTAmount: v.gst, grandTotal: v.total } });
    }
});
console.log(`Updated ${matched.length} Sale rows and ${agencyIds.size} Agency rows.`);
await prisma.$disconnect();
}

main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
