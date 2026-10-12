import ExcelJS from "exceljs";
import { Response } from "express";
import profitAndLossSource from "./PLAC/PandL-pure.json";
import balanceSheetSource from "./BLSHEET/BSheet-pure.json";

type StatementKind = "PROFIT_AND_LOSS" | "BALANCE_SHEET";
type PureStatementItem = { name: string; amount: number; children?: PureStatementItem[]; items?: PureStatementItem[] };
type PureBalanceSheet = {
    report: string;
    company: string;
    period: { from: string; to: string };
    liabilities: PureStatementItem[];
    assets: PureStatementItem[];
    totals: { liabilities: number; assets: number };
};
type PureProfitAndLoss = {
    report: string;
    company: string;
    period: { from: string; to: string };
    debit: Record<string, PureStatementItem>;
    credit: Record<string, PureStatementItem>;
    totals: { debit: number; credit: number };
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

const companyAddress = [
    "SURVEY NO - 222, VILLAGE - HEDAVALI, Tl- SUDHAGAD",
    "KHOPOLI - PALI ROAD, KHOPOLI, DIST - RAIGAD"
];
const companyIdentifier = "CIN: U11100MH2011PTC224243";
const companyEmail = "E-Mail : info@ashtvinayakapetrochem.com";

const displayDate = (isoDate: string) => {
    const date = new Date(`${isoDate}T00:00:00`);
    return `${date.getDate()}-${date.toLocaleString("en", { month: "short" })}-${String(date.getFullYear()).slice(-2)}`;
};

const periodLabel = (period: { from: string; to: string }) =>
    `${displayDate(period.from)} to ${displayDate(period.to)}`;

const reportHeaderRows = (company: string, reportName: string, period: string) => [
    [company, null, null, null, null, null],
    [companyAddress[0], null, null, null, null, null],
    [companyAddress[1], null, null, null, null, null],
    [companyIdentifier, null, null, null, null, null],
    [companyEmail, null, null, null, null, null],
    [reportName, null, null, null, null, null],
    [period, null, null, null, null, null]
];

const flattenSections = (sections: PureStatementItem[]) => sections.flatMap(section => {
    const rows: unknown[][] = [[section.name, null, section.amount]];
    const children = section.children ?? section.items ?? [];
    const appendChildren = (items: PureStatementItem[]) => {
        for (const child of items) {
            const descendants = child.children ?? child.items ?? [];
            if (descendants.length) {
                rows.push([child.name, null, child.amount]);
                appendChildren(descendants);
            } else {
                rows.push([child.name, child.amount, null]);
            }
        }
    };
    appendChildren(children);
    return rows;
});

const pairStatementSides = (leftRows: unknown[][], rightRows: unknown[][]) => {
    const count = Math.max(leftRows.length, rightRows.length);
    return Array.from({ length: count }, (_, index) => {
        const left = leftRows[index] ?? [];
        const right = rightRows[index] ?? [];
        return [left[0] ?? null, left[1] ?? null, left[2] ?? null, right[0] ?? null, right[1] ?? null, right[2] ?? null];
    });
};

const balanceSheetRows = (source: PureBalanceSheet) => {
    const liabilities = flattenSections(source.liabilities);
    const assets = flattenSections(source.assets);
    const rows = reportHeaderRows(source.company, source.report, periodLabel(source.period));
    rows.push(["", "", null, "", "", null]);
    rows.push(["Liabilities", `as at ${displayDate(source.period.to)}`, null, "Assets", `as at ${displayDate(source.period.to)}`, null]);
    rows.push(...pairStatementSides(liabilities, assets));
    rows.push(["Total", null, source.totals.liabilities, "Total", null, source.totals.assets]);
    return rows;
};

const profitAndLossRows = (source: PureProfitAndLoss) => {
    const debit = source.debit;
    const credit = source.credit;
    const leftSections = [debit.openingStock, debit.purchaseAccounts, debit.directExpenses, debit.indirectExpenses]
        .filter((section): section is PureStatementItem => Boolean(section));
    const rightSections: PureStatementItem[] = [];

    if (credit.salesAccounts) {
        rightSections.push({ ...credit.salesAccounts, children: credit.salesLedgers?.items ?? [] });
    }
    for (const key of ["closingStock", "grossProfitBf", "indirectIncomes"] as const) {
        const section = credit[key];
        if (section) rightSections.push(section);
    }

    // Profit is the balancing debit in the final Profit & Loss account.
    const netProfit = credit.netProfit;
    if (netProfit) leftSections.push({ ...netProfit, name: netProfit.name || "Nett Profit" });

    const rows = reportHeaderRows(source.company, source.report, periodLabel(source.period));
    rows.push(["", "", null, "", "", null]);
    rows.push(["Particulars", periodLabel(source.period), null, "Particulars", periodLabel(source.period), null]);
    rows.push(...pairStatementSides(flattenSections(leftSections), flattenSections(rightSections)));
    rows.push(["Total", null, source.totals.debit, "Total", null, source.totals.credit]);
    return rows;
};

const reorderProfitAndLossSectionsForExport = (rows: unknown[][]) => {
    const sectionIndex = (name: string) => rows.findIndex(row =>
        text(row[3]).toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    const salesStart = sectionIndex("Sales Accounts");
    const stockStart = sectionIndex("Closing Stock");
    if (salesStart < 0 || stockStart <= salesStart) return;

    const nextSection = (start: number) => {
        for (let index = start + 1; index < rows.length; index++) {
            if (text(rows[index][3]) && rows[index][5] != null) return index;
        }
        return rows.length;
    };

    const salesEnd = nextSection(salesStart);
    const stockEnd = nextSection(stockStart);
    if (salesEnd !== stockStart || stockEnd <= stockStart) return;

    // Reorder only the right-hand account groups; the left-hand cost sections
    // stay on their original rows and the response JSON remains unchanged.
    const reorderedRightSide = [
        ...rows.slice(stockStart, stockEnd).map(row => row.slice(3, 6)),
        ...rows.slice(salesStart, salesEnd).map(row => row.slice(3, 6))
    ];
    reorderedRightSide.forEach((cells, offset) => {
        rows[salesStart + offset].splice(3, 3, ...cells);
    });
};

export class Srv1FinancialStatementsService {
    static getProfitAndLossReport() {
        const source = profitAndLossSource as PureProfitAndLoss;
        return {
            statementType: "PROFIT_AND_LOSS" as const,
            reportName: source.report,
            company: source.company,
            period: periodLabel(source.period),
            companyDetails: { address: companyAddress, identifier: companyIdentifier, email: companyEmail },
            rows: profitAndLossRows(source)
        };
    }

    static getBalanceSheetReport() {
        const source = balanceSheetSource as PureBalanceSheet;
        return {
            statementType: "BALANCE_SHEET" as const,
            reportName: source.report,
            company: source.company,
            period: periodLabel(source.period),
            companyDetails: { address: companyAddress, identifier: companyIdentifier, email: companyEmail },
            rows: balanceSheetRows(source)
        };
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
        const rows = report.rows.map(row => [...row]);
        if (report.statementType === "PROFIT_AND_LOSS") {
            reorderProfitAndLossSectionsForExport(rows);
        }

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
                    const yellowHeaderOnly = report.statementType === "PROFIT_AND_LOSS" && section;
                    if (yellowHeaderOnly) {
                        const headerColumns = [
                            ...(sourceRow[2] != null ? [1, 3] : []),
                            ...(sourceRow[5] != null ? [4, 6] : [])
                        ];
                        for (const column of headerColumns) {
                            const cell = row.getCell(column);
                            cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF202A35" } };
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
                            cell.border = { top: { style: "thin", color: { argb: "FFD6C37A" } } };
                        }
                    } else {
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
            }
        });

        const buffer = await workbook.xlsx.writeBuffer();
        res.status(200);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
        return res.send(Buffer.from(buffer));
    }
}
