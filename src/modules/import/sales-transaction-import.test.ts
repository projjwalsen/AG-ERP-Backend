import assert from "node:assert/strict";
import test from "node:test";
import { ExcelImportService } from "./excelImport.service";
import {
    normalizeImportedPartyName,
    normalizeImportedTransactionType
} from "./transaction-import.utils";

test("sales transaction parser reads a direct Particulars customer", () => {
    const rows = ExcelImportService.parseJournalRows([
        ExcelImportService.normalizeHeaders({
            Date: "2-Apr-25",
            Particulars: "MANAN ENTERPRISE",
            "Vch Type": "Tax Invoice",
            "Vch No.": "APM/G2526/0001",
            Credit: "3975075.00",
            Type: "GST_SALES"
        })
    ], "GST SALES");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].particulars, "MANAN ENTERPRISE");
    assert.equal(rows[0].voucherType, "TAX INVOICE");
    assert.equal(rows[0].creditAmount, 3975075);
    assert.equal(rows[0].accountingVoucherType, "GST SALES");
    assert.equal(rows[0].sourceSheet, "GST SALES");
    assert.equal(rows[0].sourceRow, 9);
});

test("sales transaction parser reads a customer after the By marker", () => {
    const rows = ExcelImportService.parseJournalRows([
        ExcelImportService.normalizeHeaders({
            Date: "7-Aug-25",
            Particulars: "By",
            __EMPTY: "SRI VAISHNAVI ENTERPRISES",
            "Vch Type": "Tax Invoice",
            "Vch No.": "APM/G2526/0891",
            Credit: "2868610.50",
            Type: "IGST_SALE@12%"
        })
    ], "IGST SALES @ 12%");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].particulars, "SRI VAISHNAVI ENTERPRISES");
    assert.equal(rows[0].accountingVoucherType, "IGST SALES @12%");
});

test("sales transaction normalization removes Tally markers", () => {
    assert.equal(
        normalizeImportedPartyName("INFINIUM INDUSTRIES PRIVATE LIMITED Dr."),
        "INFINIUM INDUSTRIES PRIVATE LIMITED"
    );
    assert.equal(
        normalizeImportedTransactionType("IGST_SALE@12%"),
        "IGST SALES @12%"
    );
});

test("Tax Invoice rows without voucher numbers remain reportable", () => {
    const rows = ExcelImportService.parseJournalRows([
        ExcelImportService.normalizeHeaders({
            Date: "2-Apr-25",
            Particulars: "MANAN ENTERPRISE",
            "Vch Type": "Tax Invoice",
            "Vch No.": "",
            Credit: "100.00",
            Type: "GST_SALES"
        })
    ], "GST SALES");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].voucherNo, "");
});
