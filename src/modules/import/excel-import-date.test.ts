import assert from "node:assert/strict";
import test from "node:test";
import { ExcelImportService } from "./excelImport.service";

test("parses Tally DD-MM-YYYY dates without US locale ambiguity", () => {
    const date = ExcelImportService.toDate("14-04-2025");
    assert.ok(date);
    assert.equal(date.getFullYear(), 2025);
    assert.equal(date.getMonth(), 3);
    assert.equal(date.getDate(), 14);
});

test("rejects impossible imported dates", () => {
    assert.equal(ExcelImportService.toDate("31-02-2025"), undefined);
});

test("parses Excel serial dates", () => {
    const date = ExcelImportService.toDate(45756);
    assert.ok(date);
    assert.equal(date.getFullYear(), 2025);
});
