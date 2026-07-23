import ExcelJS from "exceljs";
import { Response } from "express";
import { formatISTDate, getByPath } from "./loc.utils";
export interface ExcelReportHeader {
    title: string;
    subtitle?: string;
    period?: string;
}
export interface ExportColumn<T> {
  header: string;

  key?: keyof T | string;

  value?: (row: T) => any;

  width?: number;

  maxLength?: number;
}

export interface ExportRequest<T> {
  filename: string;
  sheetName?: string;
  title?: string;

  columns: ExportColumn<T>[];

  data: T[];
  companyName?: string;
  showCompanyName?: boolean;

  filters?: Record<string, any>;

  headerStyle?: Partial<ExcelJS.Style>;
  rowStyle?: Partial<ExcelJS.Style>;

  customRowStyles?: (
    row: T,
    index: number
  ) => Partial<ExcelJS.Style>;
}

export class ExcelService {

    private static styleLedgerHeader(
        row: ExcelJS.Row
    ) {

        row.eachCell(cell => {

            cell.font = {
                bold: true,
                color: {
                    argb: "FFFFFF"
                }
            };

            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: {
                    argb: "1F4E78"
                }
            };

            cell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };

            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                right: { style: "thin" },
                bottom: { style: "thin" }
            };
        });
    }

    private static styleTotalRow(
        row: ExcelJS.Row
    ) {

        row.eachCell(cell => {

            cell.font = {
                bold: true
            };

            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: {
                    argb: "D9EAD3"
                }
            };

            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                right: { style: "thin" },
                bottom: { style: "thin" }
            };
        });
    }
    // private static addReportHeader(
    //     worksheet: ExcelJS.Worksheet,
    //     header: ExcelReportHeader,
    //     totalColumns: number
    // ) {

    //     worksheet.mergeCells(
    //         1,
    //         1,
    //         1,
    //         totalColumns
    //     );

    //     const companyCell =
    //         worksheet.getCell(1, 1);

    //     companyCell.value =
    //         header.companyName ||
    //         "ASHTAVINAYAKA";

    //     companyCell.font = {
    //         bold: true,
    //         size: 18
    //     };

    //     companyCell.alignment = {
    //         horizontal: "center"
    //     };

    //     worksheet.mergeCells(
    //         2,
    //         1,
    //         2,
    //         totalColumns
    //     );

    //     const titleCell =
    //         worksheet.getCell(2, 1);

    //     titleCell.value =
    //         header.title;

    //     titleCell.font = {
    //         bold: true,
    //         size: 14
    //     };

    //     titleCell.alignment = {
    //         horizontal: "center"
    //     };

    //     if (header.subtitle) {

    //         worksheet.mergeCells(
    //             3,
    //             1,
    //             3,
    //             totalColumns
    //         );

    //         worksheet.getCell(
    //             3,
    //             1
    //         ).value =
    //             header.subtitle;
    //     }

    //     if (header.period) {

    //         worksheet.mergeCells(
    //             4,
    //             1,
    //             4,
    //             totalColumns
    //         );

    //         worksheet.getCell(
    //             4,
    //             1
    //         ).value =
    //             `Period : ${header.period}`;
    //     }

    //     return 6;
    // }
    static async export<T>(
        res: Response,
        options: ExportRequest<T> & {
            reportHeader?: ExcelReportHeader;
        }
    ) {
        const workbook = new ExcelJS.Workbook();

        const worksheet = workbook.addWorksheet(
            options.sheetName || "Sheet1"
        );

        let currentRow = 1;

        if (options.showCompanyName && options.companyName) {

            worksheet.mergeCells(
                currentRow,
                1,
                currentRow,
                options.columns.length
            );

            const companyCell =
                worksheet.getCell(currentRow, 1);

            companyCell.value =
                options.companyName;

            companyCell.font = {
                bold: true,
                size: 18
            };

            companyCell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };

            worksheet.getRow(currentRow).height = 28;

            currentRow++;
        }

        if (options.title) {

            worksheet.mergeCells(
                currentRow,
                1,
                currentRow,
                options.columns.length
            );

            const titleCell =
                worksheet.getCell(currentRow, 1);

            titleCell.value =
                options.title;

            titleCell.font = {
                bold: true,
                size: 18
            };

            titleCell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };

            worksheet.getRow(currentRow).height = 28;

            currentRow++;

            worksheet.mergeCells(
                currentRow,
                1,
                currentRow,
                options.columns.length
            );

            const generatedCell =
                worksheet.getCell(currentRow, 1);

            generatedCell.value =
                `Date of Generation : ${new Intl.DateTimeFormat(
                    "en-IN",
                    {
                        timeZone: "Asia/Kolkata",
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true
                    }
                ).format(new Date())}`;

            generatedCell.font = {
                bold: true,
                size: 12,
                color: {
                    argb: "404040"
                }
            };

            generatedCell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };

            worksheet.getRow(currentRow).height = 20;

            currentRow++;
        }

        const headerRowNumber = currentRow + 1;




        /**
         * ==========================
         * Header Row
         * ==========================
         */
        const headerRow =
            worksheet.getRow(
                headerRowNumber
            );

        headerRow.values =
            options.columns.map(
                col => col.header
            );

        /**
         * Column Widths
         */
        options.columns.forEach(
            (col, index) => {

                worksheet.getColumn(index + 1).width =
                    col.width || 20;
            }
        );

        /**
         * ==========================
         * Header Styling
         * ==========================
         */
        headerRow.height = 25;

        headerRow.eachCell(cell => {

            cell.font = {
                bold: true,
                color: {
                    argb: "000000"
                }
            };

            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: {
                    argb: "D9EAF7" // Light Blue
                }
            };

            cell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };

            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                right: { style: "thin" },
                bottom: { style: "thin" }
            };
        });

        /**
         * Freeze Header
         */
        worksheet.views = [
            {
                state: "frozen",
                ySplit: headerRowNumber
            }
        ];

        /**
         * Auto Filter
         */
        worksheet.autoFilter = {
            from: {
                row: headerRowNumber,
                column: 1
            },
            to: {
                row: headerRowNumber,
                column: options.columns.length
            }
        };

        /**
         * ==========================
         * Data Rows
         * ==========================
         */
        options.data.forEach((row, index) => {

            const values =
                options.columns.map(col => {

                    const raw =
                        typeof col.value === "function"
                            ? col.value(row)
                            : getByPath(
                                row,
                                String(col.key)
                            );

                    return this.truncate(
                        raw,
                        col.maxLength
                    );
                });

            const excelRow =
                worksheet.addRow(values);

            options.columns.forEach((col, index) => {

                const cell =
                    excelRow.getCell(index + 1);

                const raw =
                    typeof col.value === "function"
                        ? col.value(row)
                        : getByPath(
                            row,
                            String(col.key)
                        );

                if (
                    raw instanceof Date
                ) {

                    cell.value = raw;

                    cell.numFmt =
                        "dd-mmm-yyyy";
                }
            });

            /**
             * Default row alignment
             */
            excelRow.alignment = {
                vertical: "middle"
            };

            /**
             * Custom row styles
             */
            if (options.customRowStyles) {

                const style =
                    options.customRowStyles(
                        row,
                        index
                    );

                if (style) {

                    excelRow.eachCell(cell => {

                        if (style.fill)
                            cell.fill = style.fill;

                        if (style.font)
                            cell.font = style.font;

                        if (style.alignment)
                            cell.alignment =
                                style.alignment;
                    });
                }
            }
        });

        /**
         * Global Row Style
         */
        if (options.rowStyle) {

            worksheet.eachRow((row, rowNumber) => {

                if (rowNumber <= headerRowNumber)
                    return;

                row.eachCell(cell => {

                    if (options.rowStyle?.font)
                        cell.font =
                            options.rowStyle.font;

                    if (options.rowStyle?.alignment)
                        cell.alignment =
                            options.rowStyle.alignment;
                });
            });
        }

        /**
         * Response Headers
         */
        res.status(200);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${options.filename}.xlsx"`
        );

        await workbook.xlsx.write(
            res as any
        );

        res.end();
    }
    private static truncate(
        value: any,
        maxLength?: number
    ) {
        const text = String(value ?? "");

        if (!maxLength) {
            return text;
        }

        return text.length > maxLength
            ? text.slice(0, maxLength)
            : text;
    }

    private static buildFlatRow<T>(
        row: T,
        columns: ExportColumn<T>[]
    ) {
        const output: Record<string, any> = {};

        for (const col of columns) {
        const raw =
            typeof col.value === "function"
            ? col.value(row)
            : getByPath(
                row,
                String(col.key)
                );

        console.log("Raw value for column", col.header, ":", raw);

        output[col.header] =
            this.truncate(raw, col.maxLength);
        }

        return output;
    }

    static async exportSundryLedger(
        res: Response,
        options: {
            filename: string;
            sheetName?: string;
            title: string;
            companyName: string;
            period: string;
            data: any[];
        }
    ) {

        const workbook =
            new ExcelJS.Workbook();

        const worksheet =
            workbook.addWorksheet(
                options.sheetName || options.title
            );

        /**
         * ===================================================
         * TITLE
         * ===================================================
         */

        worksheet.mergeCells("A1:E1");

        const title =
            worksheet.getCell("A1");

        title.value =
            options.title;

        title.font = {
            bold: true,
            size: 18
        };

        title.alignment = {
            horizontal: "center"
        };

        /**
         * Group Summary
         */

        worksheet.mergeCells("A2:E2");

        worksheet.getCell("A2").value =
            "Group Summary";

        worksheet.getCell("A2").font = {
            bold: true,
            size: 13
        };

        worksheet.getCell("A2").alignment = {
            horizontal: "center"
        };

        /**
         * Period
         */

        worksheet.mergeCells("A3:E3");

        worksheet.getCell("A3").value =
            options.period;

        worksheet.getCell("A3").alignment = {
            horizontal: "center"
        };

        /**
         * Blank Row
         */

        worksheet.addRow([]);

        /**
         * Group Name
         */

        // worksheet.getCell("B5").value =
        //     options.title;

        worksheet.getCell("B5").font = {
            bold: true
        };

        /**
         * Company
         */

        worksheet.getCell("B6").value =
            options.companyName;

        /**
         * Period
         */

        worksheet.getCell("B7").value =
            options.period;

        /**
         * Transactions / Closing
         */

        worksheet.getCell("C8").value =
            "Transactions";

        worksheet.getCell("C8").font = {
            bold: true
        };

        worksheet.getCell("E8").font = {
            bold: true
        };

        /**
         * ===================================================
         * HEADER
         * ===================================================
         */

        const header =
            worksheet.getRow(10);

        header.values = [

            "Particulars",

            "Opening Balance",

            "Debit",

            "Credit",

            "Closing Balance"

        ];

        header.font = {
            bold: true
        };

        header.alignment = {
            horizontal: "center",
            vertical: "middle"
        };

        header.eachCell(cell => {

            cell.border = {

                top: {
                    style: "thin"
                },

                left: {
                    style: "thin"
                },

                right: {
                    style: "thin"
                },

                bottom: {
                    style: "thin"
                }

            };

        });

        /**
         * ===================================================
         * DATA
         * ===================================================
         */

        options.data.forEach(row => {

            const excelRow =
                worksheet.addRow([

                    row.particulars,

                    row.openingBalance,

                    row.debit,

                    row.credit,

                    row.balance

                ]);

            excelRow.getCell(3).numFmt =
                "#,##0.00";

            excelRow.getCell(4).numFmt =
                "#,##0.00";


            excelRow.eachCell(cell => {

                cell.border = {

                    top: {
                        style: "thin"
                    },

                    left: {
                        style: "thin"
                    },

                    right: {
                        style: "thin"
                    },

                    bottom: {
                        style: "thin"
                    }

                };

            });

        });

        /**
         * ===================================================
         * COLUMN WIDTHS
         * ===================================================
         */

        worksheet.columns = [

            {
                width: 55
            },

            {
                width: 20
            },

            {
                width: 20
            },

            {
                width: 20
            },

            {
                width: 20
            }

        ];

        /**
         * ===================================================
         * RESPONSE
         * ===================================================
         */

        res.status(200);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${options.filename}.xlsx"`
        );

        await workbook.xlsx.write(
            res as any
        );

        res.end();

    }

    static async exportAccountingLedger(
        res: Response,
        options: {
            filename: string;
            sheetName?: string;
            title: string;
            period?: string;
            data: any[];
        }
    ) {

        const workbook =
            new ExcelJS.Workbook();

        const worksheet =
            workbook.addWorksheet(
                options.sheetName ||
                "Accounting Ledger"
            );

        /**
         * Title
         */
        worksheet.mergeCells("B2:F2");

        const titleCell =
            worksheet.getCell("B2");

        titleCell.value =
            options.title;

        titleCell.font = {
            bold: true,
            size: 16
        };

        /**
         * Period
         */
        worksheet.getCell("E3").value =
            "Time Period:";

        worksheet.getCell("E4").value =
            options.period || "";

        /**
         * Header
         */
        const headerRow =
            worksheet.getRow(6);

        headerRow.values = [
            "",
            "NO",
            "DATE",
            "DESCRIPTION",
            "INCOME",
            "EXPENSE",
            "BALANCE"
        ];

        headerRow.eachCell(cell => {

            cell.font = {
                bold: true
            };

            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: {
                    argb: "FFF3E242"
                }
            };

            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                right: { style: "thin" },
                bottom: { style: "thin" }
            };

            cell.alignment = {
                vertical: "middle",
                horizontal: "center"
            };
        });

        worksheet.columns = [

            { width: 3 },

            { width: 10 },

            { width: 18 },

            { width: 55 },

            { width: 18 },

            { width: 18 },

            { width: 18 }
        ];

        /**
         * Data
         */
        options.data.forEach(
            (row, index) => {

                const excelRow =
                    worksheet.addRow([
                        "",
                        index + 1,
                        row.date,
                        row.description,
                        row.income || 0,
                        row.expense || 0,
                        row.balance || 0
                    ]);

                excelRow.height = 22;

                excelRow.eachCell(cell => {

                    cell.border = {
                        top: { style: "thin" },
                        left: { style: "thin" },
                        right: { style: "thin" },
                        bottom: { style: "thin" }
                    };
                });

                excelRow.getCell(3).numFmt =
                    "dd-mmm-yyyy";

                excelRow.getCell(5).numFmt =
                    "#,##0.00";

                excelRow.getCell(6).numFmt =
                    "#,##0.00";

                excelRow.getCell(7).numFmt =
                    "#,##0.00";
            }
        );

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${options.filename}.xlsx"`
        );

        await workbook.xlsx.write(
            res as any
        );

        res.end();
    }

    static async exportGSTLedger(
        res: Response,
        data: any
    ) {

        const workbook =
            new ExcelJS.Workbook();

        const worksheet =
            workbook.addWorksheet(
                "GST Ledger"
            );

        /**
         * ==================================================
         * COMPANY HEADER
         * ==================================================
         */

        worksheet.mergeCells("A1:H1");

        const titleCell =
            worksheet.getCell("A1");

        titleCell.value =
            `${data.company.name} - GST LEDGER`;

        titleCell.font = {
            bold: true,
            size: 18
        };

        titleCell.alignment = {
            horizontal: "center"
        };

        worksheet.addRow([]);

        worksheet.addRow([
            "Period",
            `${data.period?.startDate
                ? formatISTDate(data.period.startDate)
                : "Beginning"} To ${data.period?.endDate
                ? formatISTDate(data.period.endDate)
                : formatISTDate(new Date())
            }`
        ]);

        worksheet.addRow([]);

        /**
         * ==================================================
         * INPUT GST LEDGER
         * ==================================================
         */

        worksheet.addRow([
            "INPUT GST LEDGER"
        ]);

        const inputHeader =
            worksheet.addRow([
                "Date",
                "Particulars",
                "Voucher No",
                "Taxable Value",
                "CGST",
                "SGST",
                "IGST",
                "Total GST"
            ]);

        this.styleLedgerHeader(
            inputHeader
        );

        data.inputGSTLedger.entries.forEach(
            (row: any) => {

                worksheet.addRow([
                    row.date,
                    row.particulars,
                    row.voucherNo,
                    row.taxableValue,
                    row.cgst,
                    row.sgst,
                    row.igst,
                    row.totalGST
                ]);
            }
        );

        const inputTotal =
            worksheet.addRow([
                "",
                "TOTAL INPUT GST",
                "",
                data.inputGSTLedger.totals.taxableValue,
                data.inputGSTLedger.totals.cgst,
                data.inputGSTLedger.totals.sgst,
                data.inputGSTLedger.totals.igst,
                data.inputGSTLedger.totals.totalGST
            ]);

        this.styleTotalRow(
            inputTotal
        );

        worksheet.addRow([]);

        /**
         * ==================================================
         * OUTPUT GST LEDGER
         * ==================================================
         */

        worksheet.addRow([
            "OUTPUT GST LEDGER"
        ]);

        const outputHeader =
            worksheet.addRow([
                "Date",
                "Particulars",
                "Voucher No",
                "Taxable Value",
                "CGST",
                "SGST",
                "IGST",
                "Total GST"
            ]);

        this.styleLedgerHeader(
            outputHeader
        );

        data.outputGSTLedger.entries.forEach(
            (row: any) => {

                worksheet.addRow([
                    row.date,
                    row.particulars,
                    row.voucherNo,
                    row.taxableValue,
                    row.cgst,
                    row.sgst,
                    row.igst,
                    row.totalGST
                ]);
            }
        );

        const outputTotal =
            worksheet.addRow([
                "",
                "TOTAL OUTPUT GST",
                "",
                data.outputGSTLedger.totals.taxableValue,
                data.outputGSTLedger.totals.cgst,
                data.outputGSTLedger.totals.sgst,
                data.outputGSTLedger.totals.igst,
                data.outputGSTLedger.totals.totalGST
            ]);

        this.styleTotalRow(
            outputTotal
        );

        worksheet.addRow([]);
        worksheet.addRow([]);

        /**
         * ==================================================
         * LIABILITY SUMMARY
         * ==================================================
         */

        worksheet.addRow([
            "GST LIABILITY SUMMARY"
        ]);

        const summaryHeader =
            worksheet.addRow([
                "GST Type",
                "Output GST",
                "Input GST",
                "Net Payable"
            ]);

        this.styleLedgerHeader(
            summaryHeader
        );

        worksheet.addRow([
            "CGST",
            data.liabilitySummary.cgst.output,
            data.liabilitySummary.cgst.input,
            data.liabilitySummary.cgst.payable
        ]);

        worksheet.addRow([
            "SGST",
            data.liabilitySummary.sgst.output,
            data.liabilitySummary.sgst.input,
            data.liabilitySummary.sgst.payable
        ]);

        worksheet.addRow([
            "IGST",
            data.liabilitySummary.igst.output,
            data.liabilitySummary.igst.input,
            data.liabilitySummary.igst.payable
        ]);

        const finalRow =
            worksheet.addRow([
                "TOTAL",
                data.liabilitySummary.total.output,
                data.liabilitySummary.total.input,
                data.liabilitySummary.total.payable
            ]);

        this.styleTotalRow(
            finalRow
        );

        /**
         * ==================================================
         * WIDTHS
         * ==================================================
         */

        worksheet.columns = [
            { width: 15 },
            { width: 45 },
            { width: 25 },
            { width: 18 },
            { width: 18 },
            { width: 18 },
            { width: 18 },
            { width: 18 }
        ];

        /**
         * ==================================================
         * RESPONSE
         * ==================================================
         */

        res.status(200);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="gst-ledger.xlsx"`
        );

        await workbook.xlsx.write(
            res as any
        );

        res.end();
    }
    
}