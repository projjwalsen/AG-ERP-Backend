import "dotenv/config";
import fs from "node:fs";
import XLSX from "xlsx";
import { prisma } from "../config/db";

const fileFlagIndex = process.argv.indexOf("--file");
const file = fileFlagIndex >= 0
    ? process.argv[fileFlagIndex + 1]
    : process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) || "D:/SALEGST.xlsx";
const apply = process.argv.includes("--apply");
const money = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;
if (!fs.existsSync(file)) throw new Error(`Workbook not found: ${file}`);
const wb = XLSX.readFile(file, { cellDates: true });
const data = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const headerIndex = data.findIndex(row => row.some((v: unknown) => String(v || "").trim().toLowerCase() === "voucher no."));
if (headerIndex < 0) throw new Error("Voucher No. header not found in workbook");
const headers = data[headerIndex].map((v: unknown) => String(v || "").trim().toLowerCase());
const col = (...names: string[]) => headers.findIndex(h => names.some(n => h === n || h.includes(n)));
const voucherNoCol = col("voucher no.", "voucher no");
const typeCol = col("voucher type");
const valueCol = col("value", "taxable");
const totalCol = col("gross total", "grand total", "invoice amount");
const exactTaxColumn = (header: string) => headers.findIndex(h => h === header);
const cgstCol = exactTaxColumn("output cgst 9%");
const sgstCol = exactTaxColumn("output sgst 9%");
const igstCol = exactTaxColumn("output igst 18%");
const input: any[] = data.slice(headerIndex + 1).filter(r => String(r[typeCol] || "").trim().toLowerCase() === "tax invoice" && r[voucherNoCol]).map(r => {
    const cgst = cgstCol >= 0 ? money(r[cgstCol]) : 0;
    const sgst = sgstCol >= 0 ? money(r[sgstCol]) : 0;
    const igst = igstCol >= 0 ? money(r[igstCol]) : 0;
    return { invoiceNo: String(r[voucherNoCol]).trim(), party: String(r[1] || ""), taxable: money(r[valueCol]), igst, cgst, sgst, gst: money(cgst + sgst + igst), total: money(r[totalCol]) };
});
const duplicateWorkbookVouchers = input.length - new Set(input.map(x => x.invoiceNo)).size;
const vouchers = [...new Map(input.map(x => [x.invoiceNo, x])).values()];
async function main() {
const sales = await prisma.sale.findMany({ where: { invoiceNo: { in: vouchers.map(v => v.invoiceNo) } }, include: { agency: true } });
const saleMap = new Map(sales.map(s => [s.invoiceNo, s]));
const matched = vouchers.filter(v => saleMap.has(v.invoiceNo));
const needsRepair = matched.filter(v => {
    const sale = saleMap.get(v.invoiceNo)!;
    return [sale.totalIGSTAmount, sale.totalCGSTAmount, sale.totalSGSTAmount, sale.totalGSTAmount]
        .every(value => Number(value || 0) === 0);
});
const agencyIds = new Set(matched.map(v => saleMap.get(v.invoiceNo)!.agencyId));
const skippedAlreadyCorrect = matched.length - needsRepair.length;
console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", workbookPath: file, workbookRows: input.length, duplicateWorkbookVouchers, uniqueVouchers: vouchers.length, matchedVouchers: matched.length, vouchersNeedingRepair: needsRepair.length, skippedAlreadyHavingGST: skippedAlreadyCorrect, missingVouchers: vouchers.length - matched.length, agenciesMatched: new Set(needsRepair.map(v => saleMap.get(v.invoiceNo)!.agencyId)).size }, null, 2));
if (!apply) { await prisma.$disconnect(); process.exit(0); }
await prisma.$transaction(async tx => {
    for (const v of needsRepair) {
        const sale = saleMap.get(v.invoiceNo)!;
        await tx.sale.update({ where: { id: sale.id }, data: { subTotalAmount: v.taxable, totalIGSTAmount: v.igst, totalCGSTAmount: v.cgst, totalSGSTAmount: v.sgst, totalGSTAmount: v.gst, grandTotal: v.total } });
    }
});
console.log(`Updated ${needsRepair.length} Sale rows. Skipped ${skippedAlreadyCorrect} vouchers that already had GST.`);
await prisma.$disconnect();
}

main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
