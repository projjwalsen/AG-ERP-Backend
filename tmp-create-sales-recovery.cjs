const path = require("path");
const XLSX = require("xlsx");

const sourcePath = "C:/Users/RAZONOVA/Downloads/import-error-report (14).xlsx";
const outputPath = path.resolve(
  "Sales-Transaction-Recovery-APM-G2526.xlsx"
);
const sourceBook = XLSX.readFile(sourcePath, { cellDates: true });
const errors = XLSX.utils.sheet_to_json(
  sourceBook.Sheets["Import Errors"],
  { defval: "", raw: false }
);

const byVoucher = new Map();
for (const row of errors) {
  const voucherNo = String(row["Vch No."] || "").trim();
  if (!voucherNo) continue;

  const current = byVoucher.get(voucherNo);
  const isUsableParty = !/^(?:BY|TO)$/i.test(String(row.Particulars || "").trim());
  const currentHasUsableParty = current &&
    !/^(?:BY|TO)$/i.test(String(current.Particulars || "").trim());

  if (!current || (isUsableParty && !currentHasUsableParty)) {
    byVoucher.set(voucherNo, row);
  }
}

const recoveryRows = Array.from(byVoucher.values())
  .sort((a, b) => new Date(a.Date) - new Date(b.Date))
  .map((row) => ({
    Date: row.Date,
    Particulars: String(row.Particulars || "").trim(),
    "Vch Type": String(row["Vch Type"] || "Tax Invoice").trim(),
    "Vch No.": String(row["Vch No."] || "").trim(),
    Debit: row.Debit || "",
    Credit: row.Credit || "",
    Type: String(row.Type || "").trim()
  }));

const sheetRows = [
  ["A G Ashtavinayaka Petrochem Pvt Ltd - Transaction Recovery"],
  ["Generated from import-error-report (14).xlsx"],
  ["One row per voucher; duplicate source rows removed."],
  ["Import through Transaction Import after deploying the accounting-only sale recovery update."],
  [],
  ["SALES TRANSACTION RECOVERY"],
  ["Ledger Account"],
  ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit", "Type"],
  ...recoveryRows.map((row) => [
    row.Date,
    row.Particulars,
    row["Vch Type"],
    row["Vch No."],
    row.Debit,
    row.Credit,
    row.Type
  ])
];

const recoverySheet = XLSX.utils.aoa_to_sheet(sheetRows);
recoverySheet["!cols"] = [
  { wch: 14 }, { wch: 42 }, { wch: 18 }, { wch: 22 },
  { wch: 16 }, { wch: 16 }, { wch: 28 }
];

const instructionsSheet = XLSX.utils.aoa_to_sheet([
  ["Recovery workbook instructions"],
  ["Invoices", recoveryRows.length],
  ["Source errors", errors.length],
  [],
  ["Use", "Import this workbook with Transaction Import."],
  ["What it does", "Creates accounting-only Sales for missing Tax Invoice rows, then posts and settles the related inward transactions."],
  ["Inventory", "No stock movement is created because the source report has no product, quantity, or GST-breakup data."],
  ["Trial Balance", "The Type column becomes the Sales head, such as SCRAP DRUMS or STORAGE WAREHOUSE RENT."],
  ["Safety", "Re-importing the same rows is idempotent after a successful import." ]
]);
instructionsSheet["!cols"] = [{ wch: 22 }, { wch: 110 }];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, recoverySheet, "Sales Transaction Recovery");
XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions");
XLSX.writeFile(workbook, outputPath);
console.log(JSON.stringify({ outputPath, invoices: recoveryRows.length, sourceErrors: errors.length }));
