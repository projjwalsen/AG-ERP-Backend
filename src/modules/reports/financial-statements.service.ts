import ExcelJS from "exceljs";
import { Response } from "express";
import profitAndLossSource from "./PLAC/profit-and-loss.json";
import balanceSheetSource from "./BLSHEET/balance-sheet.json";

type StatementKind = "PROFIT_AND_LOSS" | "BALANCE_SHEET";
type SourceWorkbook = {
    sheets: Record<string, {
        rows: unknown[][];
        rowCount?: number;
        columnCount?: number;
    }>;
};

export type FinancialStatementReport = {
    statementType: StatementKind;
    reportName: string;
    company: string;
    period: string;
    companyDetails: {
        address: string[];
        identifier: string;
        email: string;
    };
    rows: unknown[][];
};

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const rupee = String.fromCharCode(0x20b9);
const amountFormat = `${rupee}#,##,##0.00;[Red](${rupee}#,##,##0.00);-`;

const statementReport = (
    source: SourceWorkbook,
    statementType: StatementKind,
    defaultName: string
): FinancialStatementReport => {
    const sheet = Object.values(source.sheets)[0];
    const rows = sheet?.rows ?? [];
    return {
        statementType,
        reportName: text(rows[5]?.[0]) || defaultName,
        company: text(rows[0]?.[0]),
        period: text(rows[6]?.[0]),
        companyDetails: {
            address: [text(rows[1]?.[0]), text(rows[2]?.[0])].filter(Boolean),
            identifier: text(rows[3]?.[0]),
            email: text(rows[4]?.[0])
        },
        // Return the workbook's source matrix without changing its row order,
        // values, or debit/credit side placement.
        rows: rows.map(row => [...row])
    };
};

export class Srv1FinancialStatementsService {
    static getProfitAndLossReport() {
        return statementReport(
            profitAndLossSource as SourceWorkbook,
            "PROFIT_AND_LOSS",
            "Profit & Loss A/c"
        );
    }

    static getBalanceSheetReport() {
        return statementReport(
            balanceSheetSource as SourceWorkbook,
            "BALANCE_SHEET",
            "Balance Sheet"
        );
    }

    static async exportExcel(
        res: Response,
        report: FinancialStatementReport,
        filename: string,
        sheetName: string
    ) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "A G ERP";
        workbook.subject = report.reportName;
        workbook.title = `${report.company} - ${report.reportName}`;
        const worksheet = workbook.addWorksheet(sheetName);
        const rows = report.rows;

        worksheet.views = [{ state: "frozen", ySplit: 9 }];
        worksheet.pageSetup = {
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            paperSize: 9,
            margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
        };
        worksheet.getColumn(1).width = 43;
        worksheet.getColumn(2).width = 16;
        worksheet.getColumn(3).width = 17;
        worksheet.getColumn(4).width = 43;
        worksheet.getColumn(5).width = 16;
        worksheet.getColumn(6).width = 17;
        worksheet.properties.defaultRowHeight = 15;

        rows.forEach((sourceRow, index) => {
            const rowNumber = index + 1;
            const cells = Array.from({ length: 6 }, (_, columnIndex) => sourceRow[columnIndex] ?? null);
            const row = worksheet.addRow(cells);
            row.height = rowNumber <= 7 ? 18 : 16;
            row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
                cell.font = { name: "Arial", size: 9, color: { argb: "FF202A35" } };
                cell.alignment = {
                    vertical: "middle",
                    horizontal: [2, 3, 5, 6].includes(columnNumber) ? "right" : "left"
                };
                if ([2, 3, 5, 6].includes(columnNumber) && typeof cell.value === "number") {
                    cell.numFmt = amountFormat;
                }
            });

            if (rowNumber <= 5) {
                worksheet.mergeCells(rowNumber, 1, rowNumber, 6);
                row.getCell(1).font = {
                    name: "Arial", size: rowNumber === 1 ? 11 : 9,
                    bold: rowNumber === 1, color: { argb: "FF263445" }
                };
            } else if (rowNumber === 6) {
                worksheet.mergeCells(6, 1, 6, 6);
                const title = row.getCell(1);
                title.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
                title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263445" } };
                title.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
                row.height = 25;
                for (let column = 1; column <= 6; column++) {
                    row.getCell(column).border = { bottom: { style: "medium", color: { argb: "FFF2C94C" } } };
                }
            } else if (rowNumber === 7) {
                worksheet.mergeCells(7, 1, 7, 6);
                row.getCell(1).font = { name: "Arial", size: 10, italic: true, color: { argb: "FF526273" } };
            } else if (rowNumber === 8) {
                for (const column of [2, 5]) {
                    row.getCell(column).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF263445" } };
                    row.getCell(column).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                }
                row.height = 24;
            } else if (rowNumber === 9) {
                row.eachCell({ includeEmpty: true }, cell => {
                    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF202A35" } };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
                    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFB7A45A" } },
                        bottom: { style: "thin", color: { argb: "FFB7A45A" } }
                    };
                });
                row.height = 22;
            } else {
                const leftLabel = text(sourceRow[0]);
                const rightLabel = text(sourceRow[3]);
                const total = /^total$/i.test(leftLabel) || /^total$/i.test(rightLabel);
                const section = !total && Boolean(sourceRow[2] != null || sourceRow[5] != null);
                if (section || total) {
                    row.eachCell({ includeEmpty: true }, cell => {
                        cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF202A35" } };
                        cell.fill = {
                            type: "pattern", pattern: "solid",
                            fgColor: { argb: total ? "FFFFE699" : "FFFFF5D6" }
                        };
                        cell.border = { top: { style: "thin", color: { argb: "FFD6C37A" } } };
                    });
                }
            }
        });

        const buffer = await workbook.xlsx.writeBuffer();
        res.status(200);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
        return res.send(Buffer.from(buffer));
    }
}
