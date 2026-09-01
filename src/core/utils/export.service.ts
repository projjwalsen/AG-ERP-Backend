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

    private static formatIndianAmount(
        amount: number
    ): string {

        return Number(
            amount || 0
        ).toLocaleString(
            "en-IN",
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        );
    }

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

    static async exportGSTR1Summary(
        res: Response,
        report: any,
        options: { filename: string; sheetName?: string; title?: string }
    ) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(options.sheetName || "GSTR-1");
        const columns = [
            "Particulars", "Party Name", "Voucher Count", "Taxable Amount",
            "IGST", "CGST", "SGST/UTGST", "Cess", "Tax Amount", "Invoice Amount"
        ];
        const branch = report.rows?.[0];
        const period = report.period?.startDate && report.period?.endDate
            ? `${new Date(report.period.startDate).toLocaleDateString("en-IN")} to ${new Date(report.period.endDate).toLocaleDateString("en-IN")}`
            : "";

        const titleRows = [
            [branch?.branchName || ""], [""], [options.title || "GSTR-1"], [period],
            ["GST Registration:", branch?.branchGst || ""],
            ["Status:", "Not Filed"],
            ["Check Vouchers Having Potential Conflicts with Masters", "Yes"]
        ];
        titleRows.forEach((values, index) => {
            if (!values[1]) {
                worksheet.mergeCells(index + 1, 1, index + 1, columns.length);
            }
            worksheet.getCell(index + 1, 1).value = values[0];
            if (values[1]) worksheet.getCell(index + 1, 2).value = values[1];
        });

        // Match the Tally layout: voucher-status block, then the GST summary header.
        worksheet.getRow(10).values = ["Particulars", "Voucher Count"];
        worksheet.getRow(11).values = ["Total Vouchers", (report.summary?.totalInvoices || 0) + (report.creditDebitNoteSummary || []).reduce((sum: number, row: any) => sum + Number(row.voucher_count || 0), 0)];
        worksheet.getRow(12).values = ["Included in Return", report.summary?.totalInvoices || 0];
        worksheet.getRow(13).values = ["Ready for Upload", 0];
        worksheet.getRow(14).values = ["Modified in Books After Upload/Export", 0];
        worksheet.getRow(15).values = ["No Action Required", report.summary?.totalInvoices || 0];
        worksheet.getRow(16).values = ["Not Relevant for This Return", 0];
        worksheet.getRow(17).values = ["Uncertain Transactions (Corrections needed)", 0];
        worksheet.getRow(18).values = ["Marked for Deletion on Portal", 0];
        worksheet.getRow(19).values = ["Check Vouchers Having Potential Conflicts with Masters", "Yes"];
        worksheet.getRow(10).eachCell(cell => { cell.font = { bold: true }; });
        worksheet.getRow(11).eachCell(cell => { cell.font = { bold: true }; });

        const headerRow = 20;
        worksheet.getRow(headerRow).values = columns;
        worksheet.getRow(headerRow + 1).values = ["", "", "Count", "Amount", "", "", "", "", "Amount", "Amount"];
        [headerRow, headerRow + 1].forEach(rowNumber => {
            const row = worksheet.getRow(rowNumber);
            row.height = 22;
            row.eachCell(cell => {
                cell.font = { bold: true };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "D9EAF7" } };
                cell.alignment = { horizontal: "center", vertical: "middle" };
                cell.border = { top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" }, bottom: { style: "thin" } };
            });
        });

        const money = (value: any) => Number(value || 0);
        const styleSection = (row: ExcelJS.Row, bold = true) => {
            row.eachCell(cell => {
                cell.font = { bold };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bold ? "D9EAF7" : "FFFFFF" } };
                cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
            });
        };
        const totalsFor = (data: any[]) => data.reduce((sum, row) => ({
            count: sum.count + Number(row.voucher_count || 0), taxable: sum.taxable + money(row.taxable_value),
            igst: sum.igst + money(row.igst_rate_amount), cgst: sum.cgst + money(row.cgst_rate_amount),
            sgst: sum.sgst + money(row.sgst_rate_amount), cess: sum.cess + money(row.cess_amount),
            tax: sum.tax + money(row.gst_amount), invoice: sum.invoice + money(row.invoice_total)
        }), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0, invoice: 0 });
        const addSummarySection = (title: string, data: any[]) => {
            const totals = totalsFor(data);
            const section = worksheet.addRow([title, totals.count, "", totals.taxable, totals.igst, totals.cgst, totals.sgst, totals.cess, totals.tax, totals.invoice]);
            styleSection(section);
            section.getCell(2).font = { bold: true };
            for (const row of data) {
                const detail = worksheet.addRow([row.customer_gstin || "", row.agency_name || "", row.voucher_count || 0, money(row.taxable_value), money(row.igst_rate_amount), money(row.cgst_rate_amount), money(row.sgst_rate_amount), money(row.cess_amount), money(row.gst_amount), money(row.invoice_total)]);
                detail.eachCell(cell => { cell.border = { bottom: { style: "hair" } }; });
            }
            return totals;
        };

        const returnView = worksheet.addRow(["Return View"]);
        styleSection(returnView);
        const b2bTotals = addSummarySection("B2B Invoices - 4A, 4B, 4C, 6B, 6C", report.b2bSummary || []);
        const noteTotals = addSummarySection("Credit or Debit Notes (Registered) - 9B", report.creditDebitNoteSummary || []);
        ["B2C (Large) Invoices - 5A, 5B", "Exports Invoices - 6A", "Credit or Debit Notes (Unregistered) - 9B", "Amended B2B Invoices - 9A", "Amended B2C (Large) Invoices - 9A", "Amended Exports Invoices - 9A", "Amended Credit or Debit Notes (Registered) - 9C", "Amended Credit or Debit Notes (Unregistered) - 9C", "B2C (Small) Invoices - 7", "Nil Rated Invoices - 8A, 8B, 8C, 8D", "Amendment B2C (Small) Invoices - 10", "Tax Liability (Advances Received) - 11A(1), 11A(2)", "Adjustment of Advances - 11B(1), 11B(2)", "Amended Tax Liability (Advances Received) - 11A", "Amendment of Adjusted Advances - 11B", "HSN Summary - 12", "HSN Summary - 12 (B2B - B2C Supplies)", "Document Summary - 13"].forEach(title => worksheet.addRow([title]));
        const grand = worksheet.addRow(["Total", "", b2bTotals.count + noteTotals.count, b2bTotals.taxable + noteTotals.taxable, b2bTotals.igst + noteTotals.igst, b2bTotals.cgst + noteTotals.cgst, b2bTotals.sgst + noteTotals.sgst, b2bTotals.cess + noteTotals.cess, b2bTotals.tax + noteTotals.tax, b2bTotals.invoice + noteTotals.invoice]);
        styleSection(grand);

        worksheet.columns = [12, 42, 14, 18, 16, 16, 16, 14, 16, 18].map(width => ({ width }));
        worksheet.getColumn(3).numFmt = "0";
        worksheet.getRow(headerRow + 2).eachCell(cell => cell.numFmt = "#,##0.00");
        worksheet.getColumn(4).numFmt = "#,##0.00";
        worksheet.getColumn(5).numFmt = "#,##0.00";
        worksheet.getColumn(6).numFmt = "#,##0.00";
        worksheet.getColumn(7).numFmt = "#,##0.00";
        worksheet.getColumn(8).numFmt = "#,##0.00";
        worksheet.getColumn(9).numFmt = "#,##0.00";
        worksheet.getColumn(10).numFmt = "#,##0.00";
        // Keep the worksheet fully scrollable; Tally's report does not lock
        // the detail header as a split/frozen pane.
        worksheet.views = [{ state: "normal" }];

        res.status(200);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${options.filename}.xlsx"`);
        await workbook.xlsx.write(res as any);
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

        // console.log("Raw value for column", col.header, ":", raw);

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

        workbook.creator = "AG ERP";
        workbook.created = new Date();

        const isCreditor =
            options.title
                .toLowerCase()
                .includes("creditor");

        const partyLabel =
            isCreditor
                ? "Vendor"
                : "Customer";

        const reportName =
            isCreditor
                ? "SUNDRY CREDITORS"
                : "SUNDRY DEBTORS";

        const asOnDate =
            (() => {
                const parts =
                    options.period
                        ?.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/g);

                const parsed =
                    (parts || [])
                        .map(x => new Date(x))
                        .filter(x => !Number.isNaN(x.getTime()))
                        .pop();

                return parsed || new Date();
            })();

        const signedAmount = (
            amount: any,
            balanceType?: string
        ) => {
            const value =
                Number(amount || 0);

            return String(balanceType || "")
                .toUpperCase()
                .startsWith("CR")
                ? -value
                : value;
        };

        const dueDateFrom = (date: any) => {
            const parsed =
                date instanceof Date
                    ? new Date(date)
                    : new Date(date);

            if (Number.isNaN(parsed.getTime())) {
                return null;
            }

            parsed.setDate(parsed.getDate() + 15);

            return parsed;
        };

        const currencyFormat =
            "\u20B9#,##0.00;[Red]-\u20B9#,##0.00";

        const dateFormat =
            "dd-mm-yyyy";

        const thinBorder: Partial<ExcelJS.Borders> = {
            top: { style: "thin", color: { argb: "FFD9E2EC" } },
            left: { style: "thin", color: { argb: "FFD9E2EC" } },
            bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
            right: { style: "thin", color: { argb: "FFD9E2EC" } }
        };

        const titleFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF17365D" }
        };

        const subtitleFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD9EAF7" }
        };

        const labelFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEAF2F8" }
        };

        const headerFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1F4E78" }
        };

        const totalFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFCE5CD" }
        };

        const bodyFills: ExcelJS.Fill[] = [
            {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFFFFFFF" }
            },
            {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF7FBFF" }
            }
        ];

        const blocks =
            options.data.map((row: any) => {
                if (row.ledger && row.summary) {
                    const agency =
                        row.ledger.agency || {};

                    return {
                        ledger:
                            row.ledger,

                        code:
                            row.ledger.code || "-",

                        name:
                            row.ledger.name || "-",

                        state:
                            agency.state ||
                            agency.stateCode ||
                            "-",

                        gstin:
                            agency.gstin || "-",

                        summary:
                            row.summary,

                        entries:
                            row.entries || []
                    };
                }

                return {
                    ledger: {},
                    code: "-",
                    name: row.particulars || "-",
                    state: "-",
                    gstin: "-",
                    summary: {
                        openingBalance:
                            Number(row.openingBalance || 0),
                        openingBalanceType:
                            "DR",
                        totalDebit:
                            Number(row.debit || 0),
                        totalCredit:
                            Number(row.credit || 0),
                        closingBalance:
                            Number(row.balance || 0),
                        closingBalanceType:
                            "DR"
                    },
                    entries: []
                };
            });

        const summaryRows =
            blocks.map((block, index) => {
                const opening =
                    signedAmount(
                        block.summary.openingBalance,
                        block.summary.openingBalanceType
                    );

                const debit =
                    Number(block.summary.totalDebit || 0);

                const credit =
                    Number(block.summary.totalCredit || 0);

                const closing =
                    signedAmount(
                        block.summary.closingBalance,
                        block.summary.closingBalanceType
                    );

                const invoiceRows =
                    block.entries.filter(
                        (entry: any) =>
                            entry.type !== "OPENING" &&
                            Number(entry.debit || 0) > 0
                    );

                const oldestDueDate =
                    invoiceRows
                        .map((entry: any) =>
                            dueDateFrom(entry.date)
                        )
                        .filter(Boolean)
                        .sort(
                            (a: any, b: any) =>
                                a.getTime() -
                                b.getTime()
                        )[0] || null;

                const overdueAmount =
                    closing > 0
                        ? Math.abs(closing)
                        : 0;

                const status =
                    closing <= 0
                        ? "Paid"
                        : credit > 0
                            ? "Partially Paid"
                            : "Overdue";

                return {
                    serialNo:
                        index + 1,

                    code:
                        block.code,

                    name:
                        block.name,

                    state:
                        block.state,

                    gstin:
                        block.gstin,

                    opening,

                    debit,

                    credit,

                    closing,

                    drCr:
                        closing > 0
                            ? "Dr"
                            : closing < 0
                                ? "Cr"
                                : "-",

                    overdueAmount,

                    oldestDueDate,

                    status
                };
            });

        const ageingRows: any[] = [];

        blocks.forEach(block => {
            const creditTotal =
                block.entries.reduce(
                    (sum: number, entry: any) =>
                        sum +
                        Number(entry.credit || 0),
                    0
                );

            let remainingCredit =
                creditTotal;

            block.entries
                .filter(
                    (entry: any) =>
                        entry.type !== "OPENING" &&
                        Number(entry.debit || 0) > 0
                )
                .forEach((entry: any) => {
                    const invoiceAmount =
                        Number(entry.debit || 0);

                    const receivedAmount =
                        Math.min(
                            remainingCredit,
                            invoiceAmount
                        );

                    remainingCredit =
                        Math.max(
                            remainingCredit -
                            receivedAmount,
                            0
                        );

                    const invoiceDate =
                        entry.date
                            ? new Date(entry.date)
                            : null;

                    const dueDate =
                        dueDateFrom(entry.date);

                    ageingRows.push({
                        code:
                            block.code,

                        name:
                            block.name,

                        invoiceNo:
                            entry.invoiceNo ||
                            entry.voucherNo ||
                            "-",

                        invoiceDate,

                        dueDate,

                        invoiceAmount,

                        receivedAmount
                    });
                });
        });

        const styleTitle = (
            worksheet: ExcelJS.Worksheet,
            address: string,
            value: string
        ) => {
            const cell =
                worksheet.getCell(address);

            cell.value = value;
            cell.font = {
                name: "Carlito",
                bold: true,
                size: 16,
                color: { argb: "FFFFFFFF" }
            };
            cell.fill = titleFill;
            cell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };
        };

        const styleHeaderRow = (
            row: ExcelJS.Row
        ) => {
            row.height = 34;
            row.eachCell(cell => {
                cell.font = {
                    name: "Carlito",
                    bold: true,
                    color: { argb: "FFFFFFFF" }
                };
                cell.fill = headerFill;
                cell.alignment = {
                    horizontal: "center",
                    vertical: "middle",
                    wrapText: true
                };
                cell.border = thinBorder;
            });
        };

        const styleMetaLabel = (
            cell: ExcelJS.Cell
        ) => {
            cell.font = {
                name: "Carlito",
                bold: true,
                color: { argb: "FF17365D" }
            };
            cell.fill = labelFill;
            cell.alignment = {
                vertical: "middle"
            };
        };

        const worksheet =
            workbook.addWorksheet(
                options.sheetName ||
                `${partyLabel}s Summary`
            );

        worksheet.columns = [
            { width: 9 },
            { width: 14 },
            { width: 34 },
            { width: 16 },
            { width: 20 },
            { width: 18 },
            { width: 18 },
            { width: 18 },
            { width: 20 },
            { width: 10 },
            { width: 18 },
            { width: 18 },
            { width: 20 }
        ];

        worksheet.mergeCells("A1:M1");
        worksheet.mergeCells("A2:M2");
        worksheet.getRow(1).height = 28;
        worksheet.getRow(2).height = 22;

        styleTitle(
            worksheet,
            "A1",
            options.companyName
        );

        const subtitle =
            worksheet.getCell("A2");
        subtitle.value =
            `${reportName} SUMMARY`;
        subtitle.font = {
            name: "Carlito",
            bold: true,
            size: 12,
            color: { argb: "FF17365D" }
        };
        subtitle.fill = subtitleFill;
        subtitle.alignment = {
            horizontal: "center",
            vertical: "middle"
        };

        const metaRows = [
            ["Branch", options.companyName, "Total " + partyLabel + "s", summaryRows.length],
            ["Financial Year", options.period || "-", "Total Debit", null],
            ["From Date", options.period?.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/)?.[0] || "-", "Total Credit", null],
            ["As On Date", asOnDate, "Net Outstanding", null],
            ["Generated On", new Date(), "Credit Balances", null]
        ];

        metaRows.forEach((values, index) => {
            const rowNo = index + 4;
            const row = worksheet.getRow(rowNo);

            row.getCell(1).value = values[0];
            row.getCell(2).value = values[1] as any;
            row.getCell(8).value = values[2];
            row.getCell(9).value = values[3] as any;

            styleMetaLabel(row.getCell(1));
            styleMetaLabel(row.getCell(8));
        });

        worksheet.getCell("I5").value = {
            formula: "SUM(G11:G1000)",
            result:
                summaryRows.reduce(
                    (sum, row) => sum + row.debit,
                    0
                )
        };
        worksheet.getCell("I6").value = {
            formula: "SUM(H11:H1000)",
            result:
                summaryRows.reduce(
                    (sum, row) => sum + row.credit,
                    0
                )
        };
        worksheet.getCell("I7").value = {
            formula: "SUM(I11:I1000)",
            result:
                summaryRows.reduce(
                    (sum, row) => sum + row.closing,
                    0
                )
        };
        worksheet.getCell("I8").value = {
            formula: 'ABS(SUMIF(J11:J1000,"Cr",I11:I1000))',
            result:
                Math.abs(
                    summaryRows
                        .filter(row => row.drCr === "Cr")
                        .reduce(
                            (sum, row) => sum + row.closing,
                            0
                        )
                )
        };

        ["B7", "B8", "I5", "I6", "I7", "I8"].forEach(address => {
            const cell = worksheet.getCell(address);
            if (address.startsWith("I")) {
                cell.numFmt = currencyFormat;
            }
        });

        worksheet.getCell("B7").numFmt = dateFormat;
        worksheet.getCell("B8").numFmt = "dd-mm-yyyy hh:mm AM/PM";

        const header =
            worksheet.getRow(10);

        header.values = [
            "Sl. No.",
            `${partyLabel} Code`,
            `${partyLabel} Name`,
            "State",
            "GSTIN",
            "Opening Balance",
            "Debit",
            "Credit",
            "Closing Balance",
            "Dr/Cr",
            "Overdue Amount",
            "Oldest Due Date",
            "Collection Status"
        ];

        styleHeaderRow(header);

        summaryRows.forEach((row, index) => {
            const excelRow = worksheet.addRow([
                row.serialNo,
                row.code,
                row.name,
                row.state,
                row.gstin,
                row.opening,
                row.debit,
                row.credit,
                {
                    formula: `F${index + 11}+G${index + 11}-H${index + 11}`,
                    result: row.closing
                },
                {
                    formula: `IF(I${index + 11}>0,"Dr",IF(I${index + 11}<0,"Cr","-"))`,
                    result: row.drCr
                },
                row.overdueAmount,
                row.oldestDueDate,
                row.status
            ]);

            excelRow.eachCell((cell, colNumber) => {
                cell.font = {
                    name: "Carlito"
                };
                cell.fill =
                    bodyFills[index % 2];
                cell.border = thinBorder;
                cell.alignment = {
                    horizontal:
                        [1, 4, 10, 13].includes(colNumber)
                            ? "center"
                            : colNumber >= 6 && colNumber <= 11
                                ? "right"
                                : "left",
                    vertical: "middle",
                    wrapText:
                        colNumber === 3
                };
            });

            [6, 7, 8, 9, 11].forEach(col => {
                excelRow.getCell(col).numFmt = currencyFormat;
            });
            excelRow.getCell(12).numFmt = dateFormat;
        });

        const totalRowNo =
            summaryRows.length + 12;

        const summaryDataEndRow =
            summaryRows.length
                ? totalRowNo - 2
                : 11;

        const totalRow =
            worksheet.getRow(totalRowNo);

        totalRow.values = [
            "",
            "",
            "TOTAL",
            "",
            "",
            {
                formula: `SUM(F11:F${summaryDataEndRow})`,
                result: summaryRows.reduce((sum, row) => sum + row.opening, 0)
            },
            {
                formula: `SUM(G11:G${summaryDataEndRow})`,
                result: summaryRows.reduce((sum, row) => sum + row.debit, 0)
            },
            {
                formula: `SUM(H11:H${summaryDataEndRow})`,
                result: summaryRows.reduce((sum, row) => sum + row.credit, 0)
            },
            {
                formula: `SUM(I11:I${summaryDataEndRow})`,
                result: summaryRows.reduce((sum, row) => sum + row.closing, 0)
            },
            "",
            {
                formula: `SUM(K11:K${summaryDataEndRow})`,
                result: summaryRows.reduce((sum, row) => sum + row.overdueAmount, 0)
            },
            "",
            ""
        ];

        totalRow.eachCell(cell => {
            cell.font = {
                name: "Carlito",
                bold: true
            };
            cell.fill = totalFill;
            cell.border = thinBorder;
            cell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };
        });

        [6, 7, 8, 9, 11].forEach(col => {
            totalRow.getCell(col).numFmt = currencyFormat;
        });

        worksheet.views = [
            {
                state: "frozen",
                ySplit: 10
            }
        ];

        worksheet.autoFilter = {
            from: "A10",
            to: `M${Math.max(totalRowNo - 1, 11)}`
        };

        worksheet.pageSetup = {
            paperSize: 9,
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0
        };

        const ageingSheet =
            workbook.addWorksheet(
                "Invoice Ageing"
            );

        ageingSheet.columns = [
            { width: 14 },
            { width: 34 },
            { width: 16 },
            { width: 14 },
            { width: 14 },
            { width: 18 },
            { width: 18 },
            { width: 20 },
            { width: 13 },
            { width: 16 },
            { width: 16 },
            { width: 16 },
            { width: 16 },
            { width: 16 }
        ];

        ageingSheet.mergeCells("A1:N1");
        ageingSheet.getRow(1).height = 28;
        styleTitle(
            ageingSheet,
            "A1",
            `${reportName} - INVOICE AGEING DETAILS`
        );

        ageingSheet.getCell("A3").value = "Branch";
        ageingSheet.getCell("B3").value = options.companyName;
        ageingSheet.getCell("A4").value = "As On Date";
        ageingSheet.getCell("B4").value = asOnDate;
        ageingSheet.getCell("A5").value = "Ageing Basis";
        ageingSheet.getCell("B5").value = "Invoice Due Date";

        ["A3", "A4", "A5"].forEach(address => {
            styleMetaLabel(ageingSheet.getCell(address));
        });
        ageingSheet.getCell("B4").numFmt = dateFormat;

        const ageingHeader =
            ageingSheet.getRow(7);

        ageingHeader.values = [
            `${partyLabel} Code`,
            `${partyLabel} Name`,
            "Invoice No.",
            "Invoice Date",
            "Due Date",
            "Invoice Amount",
            isCreditor
                ? "Paid Amount"
                : "Received Amount",
            "Outstanding Amount",
            "Overdue Days",
            "Not Due",
            "0-30 Days",
            "31-60 Days",
            "61-90 Days",
            "Above 90 Days"
        ];

        styleHeaderRow(ageingHeader);

        ageingRows.forEach((row, index) => {
            const rowNo =
                index + 8;

            const excelRow =
                ageingSheet.addRow([
                    row.code,
                    row.name,
                    row.invoiceNo,
                    row.invoiceDate,
                    row.dueDate,
                    row.invoiceAmount,
                    row.receivedAmount,
                    {
                        formula: `F${rowNo}-G${rowNo}`,
                        result: row.invoiceAmount - row.receivedAmount
                    },
                    {
                        formula: `IF(H${rowNo}<=0,0,MAX(0,$B$4-E${rowNo}))`,
                        result: row.dueDate
                            ? Math.max(
                                0,
                                Math.floor(
                                    (
                                        asOnDate.getTime() -
                                        row.dueDate.getTime()
                                    ) /
                                    86400000
                                )
                            )
                            : 0
                    },
                    {
                        formula: `IF(AND(H${rowNo}>0,E${rowNo}>$B$4),H${rowNo},0)`,
                        result: 0
                    },
                    {
                        formula: `IF(AND(H${rowNo}>0,I${rowNo}>=0,I${rowNo}<=30,E${rowNo}<=$B$4),H${rowNo},0)`,
                        result: 0
                    },
                    {
                        formula: `IF(AND(H${rowNo}>0,I${rowNo}>=31,I${rowNo}<=60),H${rowNo},0)`,
                        result: 0
                    },
                    {
                        formula: `IF(AND(H${rowNo}>0,I${rowNo}>=61,I${rowNo}<=90),H${rowNo},0)`,
                        result: 0
                    },
                    {
                        formula: `IF(AND(H${rowNo}>0,I${rowNo}>90),H${rowNo},0)`,
                        result: 0
                    }
                ]);

            excelRow.eachCell((cell, colNumber) => {
                cell.font = {
                    name: "Carlito"
                };
                cell.fill =
                    bodyFills[index % 2];
                cell.border = thinBorder;
                cell.alignment = {
                    horizontal:
                        colNumber >= 6
                            ? "right"
                            : "left",
                    vertical: "middle",
                    wrapText:
                        colNumber === 2
                };
            });

            [4, 5].forEach(col => {
                excelRow.getCell(col).numFmt = dateFormat;
            });

            [6, 7, 8, 10, 11, 12, 13, 14].forEach(col => {
                excelRow.getCell(col).numFmt = currencyFormat;
            });
        });

        const ageingTotalRowNo =
            ageingRows.length + 9;

        const ageingDataEndRow =
            ageingRows.length
                ? ageingTotalRowNo - 2
                : 8;

        const ageingTotal =
            ageingSheet.getRow(ageingTotalRowNo);

        ageingTotal.values = [
            "",
            "TOTAL",
            "",
            "",
            "",
            {
                formula: `SUM(F8:F${ageingDataEndRow})`,
                result: ageingRows.reduce((sum, row) => sum + row.invoiceAmount, 0)
            },
            {
                formula: `SUM(G8:G${ageingDataEndRow})`,
                result: ageingRows.reduce((sum, row) => sum + row.receivedAmount, 0)
            },
            {
                formula: `SUM(H8:H${ageingDataEndRow})`,
                result: ageingRows.reduce(
                    (sum, row) =>
                        sum +
                        row.invoiceAmount -
                        row.receivedAmount,
                    0
                )
            },
            "",
            {
                formula: `SUM(J8:J${ageingDataEndRow})`,
                result: 0
            },
            {
                formula: `SUM(K8:K${ageingDataEndRow})`,
                result: 0
            },
            {
                formula: `SUM(L8:L${ageingDataEndRow})`,
                result: 0
            },
            {
                formula: `SUM(M8:M${ageingDataEndRow})`,
                result: 0
            },
            {
                formula: `SUM(N8:N${ageingDataEndRow})`,
                result: 0
            }
        ];

        ageingTotal.eachCell(cell => {
            cell.font = {
                name: "Carlito",
                bold: true
            };
            cell.fill = totalFill;
            cell.border = thinBorder;
            cell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };
        });

        [6, 7, 8, 10, 11, 12, 13, 14].forEach(col => {
            ageingTotal.getCell(col).numFmt = currencyFormat;
        });

        ageingSheet.views = [
            {
                state: "frozen",
                ySplit: 7
            }
        ];

        ageingSheet.autoFilter = {
            from: "A7",
            to: `N${Math.max(ageingTotalRowNo - 1, 8)}`
        };

        const listSheet =
            workbook.addWorksheet("Lists");

        listSheet.state = "hidden";
        listSheet.getColumn(1).values = [
            undefined,
            "Paid",
            "Partially Paid",
            "Overdue"
        ];

        for (let row = 11; row <= 1000; row++) {
            worksheet.getCell(`M${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$A$2:$A$4"]
            };
        }

        workbook.calcProperties.fullCalcOnLoad = true;

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

    static async exportBranchDayBook(
        res: Response,
        report: any
    ) {
        // Tally-style Day Book: one voucher header line followed by its
        // balancing ledger lines.  The previous export was an analytical
        // workbook; this mirrors the compact Day Book layout users reconcile.
        {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = "AG ERP";
            workbook.created = new Date();

            const worksheet = workbook.addWorksheet("Day Book");
            worksheet.views = [{ state: "frozen", ySplit: 9 }];
            worksheet.pageSetup = {
                paperSize: 9,
                orientation: "landscape",
                fitToPage: true,
                fitToWidth: 1,
                fitToHeight: 0,
                margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
            };
            worksheet.columns = [
                { width: 13 }, { width: 52 }, { width: 22 }, { width: 20 },
                { width: 18 }, { width: 18 }
            ];

            const companyName = report.companyName || report.branch?.name || "A G ASHTAVINAYAKA PETROCHEM PVT LTD";
            const branch = report.branch || {};
            const startDate = report.dateRange?.startDate ? new Date(report.dateRange.startDate) : null;
            const endDate = report.dateRange?.endDate ? new Date(report.dateRange.endDate) : new Date();
            const dateText = startDate
                ? `For ${startDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} to ${endDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                : `For ${endDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
            const thinBorder: Partial<ExcelJS.Borders> = {
                top: { style: "thin", color: { argb: "FF808080" } },
                left: { style: "thin", color: { argb: "FF808080" } },
                bottom: { style: "thin", color: { argb: "FF808080" } },
                right: { style: "thin", color: { argb: "FF808080" } }
            };
            const moneyFormat = "#,##0.00;[Red]-#,##0.00";

            worksheet.mergeCells("A1:F1");
            worksheet.getCell("A1").value = companyName;
            worksheet.getCell("A1").font = { name: "Arial", bold: true, size: 12 };
            worksheet.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };
            const headerDetails = [
                ["A2", [branch.addressLine1, branch.addressLine2].filter(Boolean).join(", ")],
                ["A3", [branch.city, branch.state, branch.pinCode].filter(Boolean).join(", ")],
                ["A4", branch.gstin ? `GSTIN: ${branch.gstin}` : ""],
                ["A5", branch.email ? `E-Mail : ${branch.email}` : ""]
            ];
            for (const [cellRef, value] of headerDetails) {
                worksheet.mergeCells(`${cellRef}:F${String(cellRef).slice(1)}`);
                worksheet.getCell(cellRef).value = value;
                worksheet.getCell(cellRef).font = { name: "Arial", size: 10 };
                worksheet.getCell(cellRef).alignment = { horizontal: "left", vertical: "middle" };
            }
            worksheet.mergeCells("A6:F6");
            worksheet.getCell("A6").value = "Day Book";
            worksheet.getCell("A6").font = { name: "Arial", bold: true, size: 13 };
            worksheet.getCell("A6").alignment = { horizontal: "left", vertical: "middle" };
            worksheet.mergeCells("A7:F7");
            worksheet.getCell("A7").value = dateText;
            worksheet.getCell("A7").font = { name: "Arial", size: 10 };
            worksheet.getCell("A7").alignment = { horizontal: "left", vertical: "middle" };

            worksheet.mergeCells("E8:E9");
            worksheet.mergeCells("F8:F9");
            worksheet.getCell("A8").value = "Date";
            worksheet.getCell("B8").value = "Particulars";
            worksheet.getCell("C8").value = "Vch Type";
            worksheet.getCell("D8").value = "Vch No.";
            worksheet.getCell("E8").value = "Debit Amount";
            worksheet.getCell("F8").value = "Credit Amount";
            for (const rowNo of [8, 9]) {
                const row = worksheet.getRow(rowNo);
                row.height = 20;
                for (let col = 1; col <= 6; col++) {
                    const cell = row.getCell(col);
                    cell.font = { name: "Arial", bold: true, size: 10 };
                    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                    cell.border = thinBorder;
                }
            }

            const voucherRows = new Map<string, any[]>();
            for (const entry of report.doubleEntryRows || []) {
                const key = `${entry.date}|${entry.voucherNo}|${entry.voucherType}`;
                const rows = voucherRows.get(key) || [];
                rows.push(entry);
                voucherRows.set(key, rows);
            }

            let rowNo = 10;
            for (const entries of voucherRows.values()) {
                entries.forEach((entry, entryIndex) => {
                    const row = worksheet.getRow(rowNo++);
                    row.height = 19;
                    row.values = [
                        entryIndex === 0 ? new Date(entry.date) : null,
                        entry.ledgerAccount || entry.particulars || "",
                        entryIndex === 0 ? entry.voucherType || "" : "",
                        entryIndex === 0 ? entry.voucherNo || "" : "",
                        Number(entry.debit || 0) || null,
                        Number(entry.credit || 0) || null
                    ];
                    for (let col = 1; col <= 6; col++) {
                        const cell = row.getCell(col);
                        cell.font = { name: "Arial", size: 10 };
                        cell.alignment = {
                        horizontal: col >= 5 ? "right" : col === 1 || col === 3 || col === 4 ? "center" : "left",
                            vertical: "middle",
                            wrapText: true
                        };
                    }
                    row.getCell(1).numFmt = "dd-MMM-yy";
                    row.getCell(5).numFmt = moneyFormat;
                    row.getCell(6).numFmt = moneyFormat;
                });
            }

            res.status(200);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", 'attachment; filename="branch-day-book.xlsx"');
            await workbook.xlsx.write(res as any);
            res.end();
            return;
        }

        const workbook =
            new ExcelJS.Workbook();

        workbook.creator = "AG ERP";
        workbook.created = new Date();

        const summarySheet =
            workbook.addWorksheet("Voucher Summary");

        const entrySheet =
            workbook.addWorksheet("Double Entry Day Book");

        const listSheet =
            workbook.addWorksheet("Lists");

        listSheet.state = "hidden";

        const branchName =
            report.branch?.name || "All Branches";

        const companyName =
            String(branchName || "A G ASHTAVINAYAKA PETROCHEM PVT LTD")
                .toUpperCase();

        const startDate =
            report.dateRange?.startDate
                ? new Date(report.dateRange.startDate)
                : null;

        const endDate =
            report.dateRange?.endDate
                ? new Date(report.dateRange.endDate)
                : new Date();

        const financialYear = (() => {
            const sourceDate =
                startDate || endDate || new Date();

            const year =
                sourceDate.getFullYear();

            const startYear =
                sourceDate.getMonth() + 1 >= 4
                    ? year
                    : year - 1;

            return `${startYear}-${String(startYear + 1).slice(-2)}`;
        })();

        const moneyFormat =
            "\u20B9#,##0.00;[Red]-\u20B9#,##0.00";

        const dateFormat =
            "dd-mm-yyyy";

        const thinBorder: Partial<ExcelJS.Borders> = {
            top: { style: "thin", color: { argb: "FFD9E2EC" } },
            left: { style: "thin", color: { argb: "FFD9E2EC" } },
            bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
            right: { style: "thin", color: { argb: "FFD9E2EC" } }
        };

        const titleFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF17365D" }
        };

        const subtitleFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD9EAF7" }
        };

        const labelFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEAF2F8" }
        };

        const headerFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1F4E78" }
        };

        const bodyFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF7FBFF" }
        };

        const totalFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFCE5CD" }
        };

        const noteFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFF2CC" }
        };

        const normalizeAmount = (value: any) =>
            Number(value || 0);

        const parseDate = (value: any) => {
            if (!value) {
                return null;
            }

            if (value instanceof Date) {
                return value;
            }

            const parsed =
                new Date(value);

            return Number.isNaN(parsed.getTime())
                ? null
                : parsed;
        };

        const styleTitle = (
            sheet: ExcelJS.Worksheet,
            range: string,
            value: string,
            fill: ExcelJS.Fill,
            fontSize: number,
            fontColor = "FFFFFFFF"
        ) => {
            sheet.mergeCells(range);

            const cell =
                sheet.getCell(range.split(":")[0]);

            cell.value = value;
            cell.font = {
                name: "Carlito",
                bold: true,
                size: fontSize,
                color: { argb: fontColor }
            };
            cell.fill = fill;
            cell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };
        };

        const styleMetaPair = (
            sheet: ExcelJS.Worksheet,
            rowNo: number,
            labelCol: number,
            valueCol: number,
            label: string,
            value: any
        ) => {
            const row =
                sheet.getRow(rowNo);

            const labelCell =
                row.getCell(labelCol);

            const valueCell =
                row.getCell(valueCol);

            labelCell.value = label;
            labelCell.font = {
                name: "Carlito",
                bold: true,
                color: { argb: "FF17365D" }
            };
            labelCell.fill = labelFill;
            labelCell.border = thinBorder;
            labelCell.alignment = {
                vertical: "middle"
            };

            valueCell.value = value;
            valueCell.font = {
                name: "Carlito"
            };
            valueCell.border = thinBorder;
            valueCell.alignment = {
                vertical: "middle"
            };
        };

        const styleHeader = (row: ExcelJS.Row) => {
            row.height = 40;

            row.eachCell(cell => {
                cell.font = {
                    name: "Carlito",
                    bold: true,
                    color: { argb: "FFFFFFFF" }
                };
                cell.fill = headerFill;
                cell.border = thinBorder;
                cell.alignment = {
                    horizontal: "center",
                    vertical: "middle",
                    wrapText: true
                };
            });
        };

        const styleBodyRow = (
            row: ExcelJS.Row,
            rowIndex: number,
            moneyColumns: number[],
            dateColumns: number[],
            centerColumns: number[]
        ) => {
            row.height = 30;

            row.eachCell((cell, colNumber) => {
                cell.font = {
                    name: "Carlito"
                };
                cell.border = thinBorder;

                if (rowIndex % 2 === 0) {
                    cell.fill = bodyFill;
                }

                cell.alignment = {
                    vertical: "middle",
                    horizontal:
                        moneyColumns.includes(colNumber)
                            ? "right"
                            : centerColumns.includes(colNumber)
                                ? "center"
                                : "left",
                    wrapText: true
                };
            });

            moneyColumns.forEach(col => {
                row.getCell(col).numFmt = moneyFormat;
            });

            dateColumns.forEach(col => {
                row.getCell(col).numFmt = dateFormat;
            });
        };

        const styleTotalRow = (
            row: ExcelJS.Row,
            moneyColumns: number[]
        ) => {
            row.height = 30;

            row.eachCell(cell => {
                cell.font = {
                    name: "Carlito",
                    bold: true,
                    color: { argb: "FF274E13" }
                };
                cell.fill = totalFill;
                cell.border = thinBorder;
                cell.alignment = {
                    horizontal: "center",
                    vertical: "middle"
                };
            });

            moneyColumns.forEach(col => {
                row.getCell(col).numFmt = moneyFormat;
            });
        };

        const summaryRows =
            report.voucherSummaryRows ||
            report.entries ||
            [];

        const doubleEntryRows =
            report.doubleEntryRows ||
            [];

        /**
         * ===================================================
         * Voucher Summary
         * ===================================================
         */

        summarySheet.pageSetup = {
            paperSize: 9,
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: {
                left: 0.25,
                right: 0.25,
                top: 0.5,
                bottom: 0.5,
                header: 0.2,
                footer: 0.2
            }
        };

        summarySheet.columns = [
            { width: 11 },
            { width: 16 },
            { width: 24 },
            { width: 20 },
            { width: 42 },
            { width: 24 },
            { width: 52 },
            { width: 22 },
            { width: 22 },
            { width: 22 },
            { width: 22 },
            { width: 16 },
            { width: 36 }
        ];

        summarySheet.getRow(1).height = 34;
        summarySheet.getRow(2).height = 28;

        styleTitle(
            summarySheet,
            "A1:M1",
            companyName,
            titleFill,
            16
        );

        styleTitle(
            summarySheet,
            "A2:M2",
            "BRANCH DAY BOOK - VOUCHER SUMMARY",
            subtitleFill,
            12,
            "FF17365D"
        );

        styleMetaPair(summarySheet, 4, 1, 2, "Branch", branchName);
        styleMetaPair(summarySheet, 5, 1, 2, "Financial Year", financialYear);
        styleMetaPair(summarySheet, 6, 1, 2, "From Date", startDate || "-");
        styleMetaPair(summarySheet, 7, 1, 2, "To Date", endDate);
        styleMetaPair(summarySheet, 8, 1, 2, "Generated On", new Date());
        styleMetaPair(summarySheet, 9, 1, 2, "Report Type", "Voucher Summary");

        const summaryStartRow = 12;
        const summaryLastRow =
            Math.max(summaryStartRow, summaryStartRow + summaryRows.length - 1);

        styleMetaPair(summarySheet, 4, 9, 10, "Total Vouchers", {
            formula: `COUNTA(C${summaryStartRow}:C${summaryLastRow})`,
            result: summaryRows.length
        });
        styleMetaPair(summarySheet, 5, 9, 10, "Total Debit", {
            formula: `SUM(H${summaryStartRow}:H${summaryLastRow})`,
            result: summaryRows.reduce(
                (sum: number, row: any) =>
                    sum + normalizeAmount(row.debit),
                0
            )
        });
        styleMetaPair(summarySheet, 6, 9, 10, "Total Credit", {
            formula: `SUM(I${summaryStartRow}:I${summaryLastRow})`,
            result: summaryRows.reduce(
                (sum: number, row: any) =>
                    sum + normalizeAmount(row.credit),
                0
            )
        });
        styleMetaPair(summarySheet, 7, 9, 10, "Difference", {
            formula: "J5-J6"
        });
        styleMetaPair(summarySheet, 8, 9, 10, "Validation", {
            formula: 'IF(J7=0,"Balanced","Review")'
        });

        ["B6", "B7"].forEach(address => {
            summarySheet.getCell(address).numFmt = dateFormat;
        });
        summarySheet.getCell("B8").numFmt = dateFormat;
        ["J5", "J6", "J7"].forEach(address => {
            summarySheet.getCell(address).numFmt = moneyFormat;
        });

        const summaryHeader =
            summarySheet.getRow(11);

        summaryHeader.values = [
            "Sl. No.",
            "Date",
            "Voucher No.",
            "Voucher Type",
            "Party/Ledger",
            "Reference No.",
            "Narration",
            "Debit",
            "Credit",
            "Payment Mode",
            "Created By",
            "Status",
            "Branch"
        ];

        styleHeader(summaryHeader);

        summaryRows.forEach((item: any, index: number) => {
            const row =
                summarySheet.getRow(summaryStartRow + index);

            row.values = [
                index + 1,
                parseDate(item.date ?? item.transactionDate),
                item.voucherNo || item.transactionNo || item.voucherId || "",
                item.voucherType || "",
                item.partyLedger || item.particulars || item.primaryAgencyName || "",
                item.referenceNo || item.transactionRef || "",
                item.narration || item.remarks || "",
                normalizeAmount(item.debit ?? item.debitAmount),
                normalizeAmount(item.credit ?? item.creditAmount),
                item.paymentMode || item.paymentType || "",
                item.createdBy || "",
                item.status || "Posted",
                item.branch || branchName
            ];

            row.getCell(1).numFmt = "0";

            styleBodyRow(
                row,
                index,
                [8, 9],
                [2],
                [1, 2, 3, 4, 6, 10, 11, 12]
            );
        });

        const summaryTotalRowNo =
            summaryStartRow + summaryRows.length + 1;

        summarySheet.mergeCells(`A${summaryTotalRowNo}:G${summaryTotalRowNo}`);

        const summaryTotalRow =
            summarySheet.getRow(summaryTotalRowNo);

        summaryTotalRow.getCell(1).value = "GRAND TOTAL";
        summaryTotalRow.getCell(8).value = {
            formula: `SUM(H${summaryStartRow}:H${summaryLastRow})`
        };
        summaryTotalRow.getCell(9).value = {
            formula: `SUM(I${summaryStartRow}:I${summaryLastRow})`
        };
        summaryTotalRow.getCell(10).value = {
            formula: `H${summaryTotalRowNo}-I${summaryTotalRowNo}`
        };
        summaryTotalRow.getCell(11).value = "Difference";

        styleTotalRow(
            summaryTotalRow,
            [8, 9, 10]
        );

        const summaryNoteRowNo =
            summaryTotalRowNo + 3;

        summarySheet.mergeCells(`A${summaryNoteRowNo}:M${summaryNoteRowNo}`);
        summarySheet.getCell(`A${summaryNoteRowNo}`).value =
            "This sheet is a voucher-level summary. For accounting verification, use the Double Entry Day Book sheet where every voucher must balance.";
        summarySheet.getCell(`A${summaryNoteRowNo}`).font = {
            name: "Carlito",
            italic: true,
            color: { argb: "FF7F6000" }
        };
        summarySheet.getCell(`A${summaryNoteRowNo}`).fill = noteFill;
        summarySheet.getCell(`A${summaryNoteRowNo}`).alignment = {
            wrapText: true,
            vertical: "middle"
        };
        summarySheet.getRow(summaryNoteRowNo).height = 34;

        summarySheet.autoFilter = {
            from: "A11",
            to: `M${summaryLastRow}`
        };

        summarySheet.views = [
            {
                state: "frozen",
                ySplit: 11
            }
        ];

        /**
         * ===================================================
         * Double Entry Day Book
         * ===================================================
         */

        entrySheet.pageSetup = {
            paperSize: 9,
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: {
                left: 0.25,
                right: 0.25,
                top: 0.5,
                bottom: 0.5,
                header: 0.2,
                footer: 0.2
            }
        };

        entrySheet.columns = [
            { width: 16 },
            { width: 24 },
            { width: 20 },
            { width: 18 },
            { width: 42 },
            { width: 30 },
            { width: 34 },
            { width: 52 },
            { width: 22 },
            { width: 22 },
            { width: 16 },
            { width: 22 }
        ];

        entrySheet.getRow(1).height = 34;

        styleTitle(
            entrySheet,
            "A1:L1",
            "DOUBLE ENTRY DAY BOOK - ACCOUNTING VIEW",
            titleFill,
            15
        );

        styleMetaPair(entrySheet, 3, 1, 2, "Branch", branchName);
        styleMetaPair(entrySheet, 4, 1, 2, "Financial Year", financialYear);
        styleMetaPair(entrySheet, 5, 1, 2, "From Date", startDate || "-");
        styleMetaPair(entrySheet, 6, 1, 2, "To Date", endDate);
        styleMetaPair(entrySheet, 7, 1, 2, "Generated On", new Date());

        const entryStartRow = 10;
        const entryLastRow =
            Math.max(entryStartRow, entryStartRow + doubleEntryRows.length - 1);

        styleMetaPair(entrySheet, 3, 8, 9, "Total Debit", {
            formula: `SUM(I${entryStartRow}:I${entryLastRow})`,
            result: doubleEntryRows.reduce(
                (sum: number, row: any) =>
                    sum + normalizeAmount(row.debit),
                0
            )
        });
        styleMetaPair(entrySheet, 4, 8, 9, "Total Credit", {
            formula: `SUM(J${entryStartRow}:J${entryLastRow})`,
            result: doubleEntryRows.reduce(
                (sum: number, row: any) =>
                    sum + normalizeAmount(row.credit),
                0
            )
        });
        styleMetaPair(entrySheet, 5, 8, 9, "Difference", {
            formula: "I3-I4"
        });
        styleMetaPair(entrySheet, 6, 8, 9, "Validation", {
            formula: 'IF(I5=0,"Balanced","Review")'
        });
        styleMetaPair(entrySheet, 7, 8, 9, "Voucher Count", {
            formula: doubleEntryRows.length > 1
                ? `1+SUMPRODUCT(--(B${entryStartRow + 1}:B${entryLastRow}<>B${entryStartRow}:B${entryLastRow - 1}))`
                : String(doubleEntryRows.length),
            result: summaryRows.length
        });

        ["B5", "B6"].forEach(address => {
            entrySheet.getCell(address).numFmt = dateFormat;
        });
        entrySheet.getCell("B7").numFmt = dateFormat;
        ["I3", "I4", "I5"].forEach(address => {
            entrySheet.getCell(address).numFmt = moneyFormat;
        });

        const entryHeader =
            entrySheet.getRow(9);

        entryHeader.values = [
            "Date",
            "Voucher No.",
            "Voucher Type",
            "Ledger Code",
            "Ledger Account",
            "Ledger Group",
            "Particulars",
            "Narration",
            "Debit",
            "Credit",
            "Status",
            "Created By"
        ];

        styleHeader(entryHeader);

        doubleEntryRows.forEach((item: any, index: number) => {
            const row =
                entrySheet.getRow(entryStartRow + index);

            row.values = [
                parseDate(item.date),
                item.voucherNo || "",
                item.voucherType || "",
                item.ledgerCode || "",
                item.ledgerAccount || "",
                item.ledgerGroup || "",
                item.particulars || "",
                item.narration || "",
                normalizeAmount(item.debit),
                normalizeAmount(item.credit),
                item.status || "Posted",
                item.createdBy || ""
            ];

            styleBodyRow(
                row,
                index,
                [9, 10],
                [1],
                [1, 2, 3, 4, 11, 12]
            );
        });

        const entryTotalRowNo =
            entryStartRow + doubleEntryRows.length + 1;

        entrySheet.mergeCells(`A${entryTotalRowNo}:H${entryTotalRowNo}`);

        const entryTotalRow =
            entrySheet.getRow(entryTotalRowNo);

        entryTotalRow.getCell(1).value = "GRAND TOTAL";
        entryTotalRow.getCell(9).value = {
            formula: `SUM(I${entryStartRow}:I${entryLastRow})`
        };
        entryTotalRow.getCell(10).value = {
            formula: `SUM(J${entryStartRow}:J${entryLastRow})`
        };
        entryTotalRow.getCell(11).value = {
            formula: `I${entryTotalRowNo}-J${entryTotalRowNo}`
        };
        entryTotalRow.getCell(12).value = "Difference";

        styleTotalRow(
            entryTotalRow,
            [9, 10, 11]
        );

        entrySheet.autoFilter = {
            from: "A9",
            to: `L${entryLastRow}`
        };

        entrySheet.views = [
            {
                state: "frozen",
                ySplit: 9
            }
        ];

        listSheet.getColumn(1).values = [
            "Voucher Type",
            "Sale",
            "Purchase",
            "Rcm Purchase",
            "Receipt",
            "Payment",
            "Journal",
            "Contra",
            "Debit Note",
            "Credit Note",
            "Opening Balance"
        ];

        listSheet.getColumn(2).values = [
            "Payment Mode",
            "Cash",
            "NEFT",
            "RTGS",
            "UPI",
            "Cheque",
            "DD",
            "Bank Deposit",
            "Other"
        ];

        listSheet.getColumn(3).values = [
            "Status",
            "Posted",
            "Pending",
            "Cancelled",
            "Reversed"
        ];

        for (let row = 12; row <= 1000; row++) {
            summarySheet.getCell(`D${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$A$2:$A$11"]
            };
            summarySheet.getCell(`J${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$B$2:$B$9"]
            };
            summarySheet.getCell(`L${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$C$2:$C$5"]
            };
        }

        for (let row = 10; row <= 1000; row++) {
            entrySheet.getCell(`C${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$A$2:$A$11"]
            };
            entrySheet.getCell(`K${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$C$2:$C$5"]
            };
        }

        workbook.calcProperties.fullCalcOnLoad = true;

        res.status(200);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="branch-day-book.xlsx"`
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
            companyName: string;
            fromDate?: string;
            toDate?: string;
            openingBalance?: number;
            totalIncome?: number;
            totalExpense?: number;
            closingBalance?: number;
            data: any[];
        }
    ) {

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "AG ERP";
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet(
            "Account Ledger"
        );

        worksheet.pageSetup = {
            paperSize: 9,
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: {
                left: 0.25,
                right: 0.25,
                top: 0.5,
                bottom: 0.5,
                header: 0.2,
                footer: 0.2
            }
        };

        worksheet.views = [
            {
                state: "frozen",
                ySplit: 11
            }
        ];

        worksheet.properties.defaultRowHeight = 15;

        worksheet.columns = [
            { width: 10 },
            { width: 15 },
            { width: 20 },
            { width: 18 },
            { width: 24 },
            { width: 42 },
            { width: 22 },
            { width: 22 },
            { width: 22 },
            { width: 18 },
            { width: 24 },
            { width: 14 }
        ];

        const moneyFormat =
            "\u20B9#,##0.00;[Red]-\u20B9#,##0.00";

        const thinBorder: Partial<ExcelJS.Borders> = {
            top: { style: "thin", color: { argb: "FFD9E2EC" } },
            left: { style: "thin", color: { argb: "FFD9E2EC" } },
            bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
            right: { style: "thin", color: { argb: "FFD9E2EC" } }
        };

        const headerFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1F4E78" }
        };

        const titleFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF17365D" }
        };

        const labelFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEAF2F8" }
        };

        const totalFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFCE5CD" }
        };

        const bodyFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF7FBFF" }
        };

        const normalizeNumber = (value: any) =>
            Number(value || 0);

        const parseDate = (value: any) => {
            if (!value) {
                return null;
            }

            if (value instanceof Date) {
                return value;
            }

            const parsed = new Date(value);

            if (!Number.isNaN(parsed.getTime())) {
                return parsed;
            }

            const match = String(value).match(
                /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/
            );

            if (match) {
                const [, day, month, year] = match;
                const date = new Date(`${month} ${day}, ${year}`);

                if (!Number.isNaN(date.getTime())) {
                    return date;
                }
            }

            return null;
        };

        const formatFinancialYear = () => {
            const sourceDate =
                parseDate(options.fromDate) ||
                parseDate(options.toDate) ||
                new Date();

            const year = sourceDate.getFullYear();
            const month = sourceDate.getMonth() + 1;
            const startYear = month >= 4 ? year : year - 1;

            return `${startYear}-${String(startYear + 1).slice(-2)}`;
        };

        const voucherTypeLabel = (row: any) => {
            const type = row.voucherType || row.type;

            if (type) {
                return String(type)
                    .replace(/_/g, " ")
                    .toLowerCase()
                    .replace(/\b\w/g, char => char.toUpperCase());
            }

            if (row.description === "Opening Balance") {
                return "Opening";
            }

            if (normalizeNumber(row.income || row.debit) > 0) {
                return "Receipt";
            }

            if (normalizeNumber(row.expense || row.credit) > 0) {
                return "Payment";
            }

            return "Journal";
        };

        const paymentModeLabel = (row: any) =>
            row.paymentThrough ||
            row.paymentType ||
            row.paymentMode ||
            (
                row.description === "Opening Balance"
                    ? "-"
                    : "Other"
            );

        const rowDate = (row: any) =>
            parseDate(row.transactionDate ?? row.date);

        const exportedRows =
            options.data.length > 0
                ? options.data
                : [
                    {
                        serialNo: 0,
                        date: options.fromDate,
                        description: "Opening Balance",
                        income: 0,
                        expense: 0,
                        balance: options.openingBalance || 0
                    }
                ];

        worksheet.mergeCells("A1:L1");
        worksheet.mergeCells("A2:L2");

        worksheet.getRow(1).height = 28;
        worksheet.getRow(2).height = 22;

        const companyCell = worksheet.getCell("A1");
        companyCell.value = options.companyName;
        companyCell.font = {
            name: "Carlito",
            bold: true,
            size: 16,
            color: { argb: "FFFFFFFF" }
        };
        companyCell.fill = titleFill;
        companyCell.alignment = {
            horizontal: "center",
            vertical: "middle"
        };

        const titleCell = worksheet.getCell("A2");
        titleCell.value = options.title;
        titleCell.font = {
            name: "Carlito",
            bold: true,
            size: 12,
            color: { argb: "FF17365D" }
        };
        titleCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD9EAF7" }
        };
        titleCell.alignment = {
            horizontal: "center",
            vertical: "middle"
        };

        const firstRow = exportedRows[0] || {};

        const metaRows = [
            ["Account Name", options.companyName, "Opening Balance", options.openingBalance || 0],
            ["Account Code", firstRow.accountCode || "-", "Total Debit", options.totalIncome || 0],
            ["Branch", firstRow.branch || "All Branches", "Total Credit", options.totalExpense || 0],
            ["Financial Year", formatFinancialYear(), "Closing Balance", options.closingBalance || 0],
            ["From Date", parseDate(options.fromDate) || "-", "Balance Type", ""],
            ["To Date", parseDate(options.toDate) || new Date(), "Generated On", new Date()]
        ];

        metaRows.forEach((values, index) => {
            const rowNo = index + 4;
            const row = worksheet.getRow(rowNo);

            row.getCell(1).value = values[0];
            row.getCell(2).value = values[1] as any;
            row.getCell(10).value = values[2];
            row.getCell(11).value = values[3] as any;

            [1, 10].forEach(col => {
                const cell = row.getCell(col);
                cell.font = {
                    name: "Carlito",
                    bold: true,
                    color: { argb: "FF17365D" }
                };
                cell.fill = labelFill;
                cell.alignment = {
                    vertical: "middle"
                };
            });

            [2, 11].forEach(col => {
                const cell = row.getCell(col);
                cell.font = {
                    name: "Carlito"
                };
                cell.alignment = {
                    vertical: "middle"
                };
            });
        });

        ["K4", "K5", "K6", "K7"].forEach(address => {
            worksheet.getCell(address).numFmt = moneyFormat;
        });

        worksheet.getCell("B8").numFmt = "dd-mm-yyyy";
        worksheet.getCell("B9").numFmt = "dd-mm-yyyy";
        worksheet.getCell("K9").numFmt = "dd-mm-yyyy hh:mm AM/PM";

        const headerRow = worksheet.getRow(11);
        headerRow.height = 36;
        headerRow.values = [
            "Sl. No.",
            "Transaction Date",
            "Voucher No.",
            "Voucher Type",
            "Against Invoice",
            "Narration",
            "Debit",
            "Credit",
            "Balance",
            "Dr/Cr",
            "Payment Mode",
            "Status"
        ];

        headerRow.eachCell(cell => {
            cell.font = {
                name: "Carlito",
                bold: true,
                color: { argb: "FFFFFFFF" }
            };
            cell.fill = headerFill;
            cell.alignment = {
                horizontal: "center",
                vertical: "middle",
                wrapText: true
            };
            cell.border = thinBorder;
        });

        let lastDataRow = 11;

        exportedRows.forEach((item, index) => {
            const rowNo = index + 12;
            const row = worksheet.getRow(rowNo);
            const debit = normalizeNumber(item.debit ?? item.income);
            const credit = normalizeNumber(item.credit ?? item.expense);
            const signedBalance =
                normalizeNumber(item.signedBalance ?? item.balance);
            const runningBalance =
                normalizeNumber(item.runningBalance ?? Math.abs(signedBalance));
            const serialNo =
                item.serialNo !== undefined
                    ? Number(item.serialNo) + 1
                    : index + 1;

            row.values = [
                serialNo,
                rowDate(item) || item.date || null,
                item.voucherNo || item.transactionNo || "-",
                voucherTypeLabel(item),
                item.invoiceNo || item.againstInvoice || "-",
                item.narration || item.description || "-",
                debit,
                credit,
                Math.abs(runningBalance || signedBalance),
                item.balanceType ||
                    (
                        signedBalance > 0
                            ? "Dr"
                            : signedBalance < 0
                                ? "Cr"
                                : "-"
                    ),
                paymentModeLabel(item),
                item.status || "Posted"
            ];

            row.height = 21;

            row.eachCell((cell, colNumber) => {
                cell.font = {
                    name: "Carlito"
                };

                if (index % 2 === 0) {
                    cell.fill = bodyFill;
                }

                cell.border = thinBorder;
                cell.alignment = {
                    vertical: "middle",
                    horizontal:
                        [1, 2, 3, 4, 5, 10, 11, 12].includes(colNumber)
                            ? "center"
                            : colNumber >= 7 && colNumber <= 9
                                ? "right"
                                : "left",
                    wrapText:
                        colNumber === 5 ||
                        colNumber === 6
                };
            });

            row.getCell(1).numFmt = "0";
            row.getCell(2).numFmt = "dd-mm-yyyy";
            [7, 8, 9].forEach(col => {
                row.getCell(col).numFmt = moneyFormat;
            });

            lastDataRow = rowNo;
        });

        const totalRowNo = lastDataRow + 2;

        worksheet.mergeCells(`A${totalRowNo}:F${totalRowNo}`);

        const totalRow = worksheet.getRow(totalRowNo);
        totalRow.height = 22;
        totalRow.getCell(1).value = "TOTAL";
        totalRow.getCell(7).value = {
            formula: `SUM(G12:G${lastDataRow})`,
            result: options.totalIncome || 0
        };
        totalRow.getCell(8).value = {
            formula: `SUM(H12:H${lastDataRow})`,
            result: options.totalExpense || 0
        };
        totalRow.getCell(9).value =
            Math.abs(options.closingBalance || 0);
        totalRow.getCell(10).value =
            (options.closingBalance || 0) > 0
                ? "Dr"
                : (options.closingBalance || 0) < 0
                    ? "Cr"
                    : "-";

        totalRow.eachCell(cell => {
            cell.font = {
                name: "Carlito",
                bold: true,
                color: { argb: "FF274E13" }
            };
            cell.fill = totalFill;
            cell.border = thinBorder;
            cell.alignment = {
                vertical: "middle",
                horizontal: "center"
            };
        });

        [7, 8, 9].forEach(col => {
            totalRow.getCell(col).numFmt = moneyFormat;
        });

        worksheet.getCell("K4").value =
            Math.abs(options.openingBalance || 0);
        worksheet.getCell("K5").value = {
            formula: `SUM(G12:G${lastDataRow})`,
            result: options.totalIncome || 0
        };
        worksheet.getCell("K6").value = {
            formula: `SUM(H12:H${lastDataRow})`,
            result: options.totalExpense || 0
        };
        worksheet.getCell("K7").value =
            Math.abs(options.closingBalance || 0);
        worksheet.getCell("K8").value =
            (options.closingBalance || 0) > 0
                ? "Dr"
                : (options.closingBalance || 0) < 0
                    ? "Cr"
                    : "-";

        worksheet.autoFilter = {
            from: "A11",
            to: `L${Math.max(lastDataRow, 12)}`
        };

        worksheet.addConditionalFormatting({
            ref: "A12:L1000",
            rules: [
                {
                    type: "expression",
                    priority: 1,
                    formulae: ['$L12="Cancelled"'],
                    style: {
                        font: { color: { argb: "FF990000" } },
                        fill: {
                            type: "pattern",
                            pattern: "solid",
                            bgColor: { argb: "FFF4CCCC" }
                        }
                    }
                }
            ]
        });

        const listSheet = workbook.addWorksheet("Lists");
        listSheet.state = "hidden";
        listSheet.getColumn(1).values = [
            undefined,
            "Opening",
            "Sale Invoice",
            "Purchase Invoice",
            "Receipt",
            "Payment",
            "Journal",
            "Credit Note",
            "Debit Note",
            "Contra"
        ];
        listSheet.getColumn(2).values = [
            undefined,
            "Cash",
            "NEFT",
            "RTGS",
            "UPI",
            "Cheque",
            "Bank Deposit",
            "Other"
        ];
        listSheet.getColumn(3).values = [
            undefined,
            "Posted",
            "Pending",
            "Cancelled",
            "Reversed"
        ];

        for (let row = 12; row <= 1000; row++) {
            worksheet.getCell(`D${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$A$2:$A$10"]
            };
            worksheet.getCell(`K${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$B$2:$B$8"]
            };
            worksheet.getCell(`L${row}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ["Lists!$C$2:$C$5"]
            };
        }

        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.font = {
                    name: cell.font?.name || "Carlito",
                    bold: cell.font?.bold,
                    italic: cell.font?.italic,
                    size: cell.font?.size,
                    color: cell.font?.color
                };
            });
        });

        workbook.calcProperties.fullCalcOnLoad = true;

        res.status(200);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${options.filename}.xlsx"`
        );

        await workbook.xlsx.write(res as any);

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

    static async exportTrialBalance(
        res: Response,
        options: {
            filename: string;
            sheetName?: string;
            companyName: string;
            branchName?: string | null;
            period: string;

            data: Array<{
                srNo: number;
                ledgerCode: string;
                account: string;
                parentGroup: string;
                groupCode?: string;
                reportParentCode?: string;
                reportParentName?: string;
                reportChildCode?: string;
                reportChildName?: string;
                debit: number;
                credit: number;
                periodDebit: number;
                periodCredit: number;
                closingSigned: number;
                closingBalance?: number;
                closingBalanceType?: "Dr" | "Cr" | null;
                closingDebit: number;
                closingCredit: number;
            }>;

            summary: {
                totalDebit: number;
                totalCredit: number;
                totalClosingDebit: number;
                totalClosingCredit: number;
                totalPeriodDebit: number;
                totalPeriodCredit: number;
                isBalanced: boolean;
            };
        }
    ) {
        const workbook = new ExcelJS.Workbook();

        workbook.creator = options.companyName;
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet(
            options.sheetName || "Trial Balance"
        );

        /* ============================================================
           PAGE SETUP
        ============================================================ */

        worksheet.pageSetup = {
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            paperSize: 9, // A4
            margins: {
                left: 0.25,
                right: 0.25,
                top: 0.5,
                bottom: 0.5,
                header: 0.2,
                footer: 0.2
            }
        };

        /* ============================================================
           COLUMNS
        ============================================================ */

        worksheet.getColumn(1).width = 48;
        worksheet.getColumn(2).width = 19;
        worksheet.getColumn(3).width = 19;
        worksheet.getColumn(4).width = 22;

        /* ============================================================
           ROW 1 - COMPANY
        ============================================================ */

        worksheet.mergeCells("A1:D1");

        const companyCell = worksheet.getCell("A1");

        companyCell.value = options.companyName;

        companyCell.font = { bold: true, size: 12 };

        companyCell.alignment = {
            horizontal: "left",
            vertical: "middle"
        };

        worksheet.getRow(1).height = 20;

        /* ============================================================
           ROW 2 - TITLE
        ============================================================ */

        worksheet.mergeCells("A2:D2");

        const titleCell = worksheet.getCell("A2");

        titleCell.value = "Trial Balance";

        titleCell.font = {
            bold: true,
            size: 13
        };

        titleCell.alignment = {
            horizontal: "center",
            vertical: "middle"
        };

        worksheet.getRow(2).height = 20;

        /* ============================================================
           ROW 3 - BRANCH / PERIOD
        ============================================================ */

        worksheet.mergeCells("A3:D3");
        const periodCell = worksheet.getCell("A3");
        periodCell.value = options.period;
        periodCell.font = { bold: true };
        periodCell.alignment = { horizontal: "center", vertical: "middle" };

        worksheet.getRow(3).height = 20;

        /* ============================================================
           ROW 4 - BLANK
        ============================================================ */

        worksheet.getRow(4).height = 8;

        /* ============================================================
           ROW 5 - TABLE HEADER
        ============================================================ */

        const headerRowNumber = 6;
        worksheet.mergeCells("B5:C5");
        const headerRow = worksheet.getRow(5);
        headerRow.getCell(1).value = "Particulars";
        headerRow.getCell(2).value = "Transactions";
        headerRow.getCell(4).value = "Closing";
        worksheet.getRow(6).getCell(2).value = "Debit";
        worksheet.getRow(6).getCell(3).value = "Credit";
        worksheet.getRow(6).getCell(4).value = "Balance";

        for (const rowNumber of [5, 6]) {
            const currentHeaderRow = worksheet.getRow(rowNumber);
            currentHeaderRow.height = 20;
            for (let column = 1; column <= 4; column++) {
                const cell = currentHeaderRow.getCell(column);

            cell.font = {
                bold: true,
                color: {
                    argb: "FF000000"
                }
            };

            cell.fill = {
                type: "pattern",
                pattern: "none"
            };

            cell.alignment = {
                horizontal: "center",
                vertical: "middle"
            };

            cell.border = {
                top: {
                    style: "thin"
                },
                left: {
                    style: "thin"
                },
                bottom: {
                    style: "thin"
                },
                right: {
                    style: "thin"
                }
            };
            }
        }

        /* ============================================================
           GROUPED DATA ROWS
        ============================================================ */

        const groupDefinitions: Record<string, {
            label: string;
            order: number;
        }> = {
            CASH_IN_HAND: { label: "Cash-in-Hand", order: 10 },
            BANK_ACCOUNTS: { label: "Bank", order: 20 },
            SUNDRY_DEBTORS: { label: "Debtors", order: 30 },
            FIXED_ASSETS: { label: "Fixed Assets", order: 40 },
            GST_INPUT: { label: "GST Input", order: 50 },
            SUNDRY_CREDITORS: { label: "Creditors", order: 60 },
            LOANS: { label: "Loans", order: 70 },
            DUTIES_AND_TAXES: { label: "Duties & Taxes", order: 80 },
            GST_OUTPUT: { label: "GST Output", order: 90 },
            SUSPENSE_ACCOUNT: { label: "Suspense", order: 100 },
            SALES: { label: "Sales", order: 110 },
            PURCHASE: { label: "Purchase", order: 120 },
            DIRECT_EXPENSE: { label: "Direct Expenses", order: 130 },
            INDIRECT_EXPENSE: { label: "Indirect Expenses", order: 140 },
            DIRECT_INCOME: { label: "Direct Income", order: 150 },
            INDIRECT_INCOME: { label: "Indirect Incomes", order: 160 },
            INVESTMENTS: { label: "Investments", order: 45 }
        };

        const tallyParentOrder: Record<string, number> = {
            ASSETS: 40,
            DUTIES_AND_TAXES: 50,
            EXPENSES: 60,
            INCOME: 70,
            SALES_ACCOUNTS: 80,
            PURCHASE_ACCOUNTS: 90,
            LIABILITIES: 130
        };

        const getTallyGroupOverride = (item: typeof options.data[number]) => {
            const account = String(item.account || "")
                .replace(/\s+/g, " ")
                .trim()
                .toUpperCase();
            const code = String(item.groupCode || "").toUpperCase();

            if (account === "GOLD & ORNAMENTS") {
                return {
                    parentKey: "ASSETS",
                    parentLabel: "Assets",
                    childKey: "INVESTMENTS",
                    childLabel: "Investments",
                    label: "Investments",
                    order: 45
                };
            }

            const byCode: Record<string, {
                parentKey: string;
                parentLabel: string;
                childKey: string;
                childLabel: string;
                label: string;
                order: number;
            }> = {
                CASH_IN_HAND: { parentKey: "ASSETS", parentLabel: "Assets", childKey: "CASH_IN_HAND", childLabel: "Cash-in-Hand", label: "Cash-in-Hand", order: 10 },
                BANK_ACCOUNTS: { parentKey: "ASSETS", parentLabel: "Assets", childKey: "BANK_ACCOUNTS", childLabel: "Bank Accounts", label: "Bank Accounts", order: 20 },
                FIXED_ASSETS: { parentKey: "ASSETS", parentLabel: "Assets", childKey: "FIXED_ASSETS", childLabel: "Fixed Assets", label: "Fixed Assets", order: 30 },
                SUNDRY_DEBTORS: { parentKey: "ASSETS", parentLabel: "Assets", childKey: "SUNDRY_DEBTORS", childLabel: "Sundry Debtors", label: "Sundry Debtors", order: 40 },
                DUTIES_AND_TAXES: { parentKey: "LIABILITIES", parentLabel: "Liabilities", childKey: "DUTIES_AND_TAXES", childLabel: "Duties & Taxes", label: "Duties & Taxes", order: 10 },
                LOANS: { parentKey: "LIABILITIES", parentLabel: "Liabilities", childKey: "LOANS", childLabel: "Loans", label: "Loans", order: 20 },
                SUNDRY_CREDITORS: { parentKey: "LIABILITIES", parentLabel: "Liabilities", childKey: "SUNDRY_CREDITORS", childLabel: "Sundry Creditors", label: "Sundry Creditors", order: 30 },
                INDIRECT_EXPENSE: { parentKey: "EXPENSES", parentLabel: "Expenses", childKey: "INDIRECT_EXPENSE", childLabel: "Indirect Expenses", label: "Indirect Expenses", order: 20 },
                DIRECT_EXPENSE: { parentKey: "EXPENSES", parentLabel: "Expenses", childKey: "DIRECT_EXPENSE", childLabel: "Direct Expenses", label: "Direct Expenses", order: 10 },
                PURCHASE: { parentKey: "PURCHASE_ACCOUNTS", parentLabel: "Purchase Accounts", childKey: "PURCHASE", childLabel: "Purchase", label: "Purchase", order: 10 },
                SALES: { parentKey: "SALES_ACCOUNTS", parentLabel: "Sales Accounts", childKey: "SALES", childLabel: "Sales", label: "Sales", order: 10 },
                INDIRECT_INCOME: { parentKey: "INCOME", parentLabel: "Income", childKey: "INDIRECT_INCOME", childLabel: "Indirect Incomes", label: "Indirect Incomes", order: 10 }
            };

            if (code.startsWith("INPUT_GST_")) {
                const taxKind = code.replace("INPUT_GST_", "");
                const label = `Input GST ${taxKind}`;
                return { parentKey: "ASSETS", parentLabel: "Assets", childKey: code, childLabel: label, label, order: 50 };
            }

            if (code.startsWith("OUTPUT_GST_")) {
                const taxKind = code.replace("OUTPUT_GST_", "");
                const label = `Output GST ${taxKind}`;
                return { parentKey: "LIABILITIES", parentLabel: "Liabilities", childKey: code, childLabel: label, label, order: 40 };
            }

            return byCode[code];
        };

        const getGroup = (item: typeof options.data[number]) => {
            const code = String(item.groupCode || "").toUpperCase();

            const tallyOverride = getTallyGroupOverride(item);
            if (tallyOverride) return tallyOverride;

            if (item.reportParentCode) {
                return {
                    parentKey: item.reportParentCode,
                    parentLabel: item.reportParentName || item.reportParentCode,
                    childKey: item.reportChildCode || code,
                    childLabel: item.reportChildName || item.account,
                    label: item.reportChildName || item.account,
                    order: 999
                };
            }

            if (code.startsWith("INPUT_GST_")) {
                return {
                    parentKey: "ASSETS",
                    parentLabel: "Assets",
                    childKey: "GST_INPUT",
                    childLabel: "GST Input",
                    ...groupDefinitions.GST_INPUT
                };
            }

            if (code.startsWith("OUTPUT_GST_")) {
                return {
                    parentKey: "LIABILITIES",
                    parentLabel: "Liabilities",
                    childKey: "GST_OUTPUT",
                    childLabel: "GST Output",
                    ...groupDefinitions.GST_OUTPUT
                };
            }

            return {
                parentKey: code || item.parentGroup,
                parentLabel: item.parentGroup,
                childKey: code || item.parentGroup,
                childLabel: item.account,
                ...(groupDefinitions[code] || {
                    label: item.account,
                    order: 999
                })
            };
        };

        const grouped = new Map<string, {
            parentKey: string;
            parentLabel: string;
            childKey: string;
            label: string;
            order: number;
            items: typeof options.data;
        }>();

        for (const item of options.data) {
            const group = getGroup(item);
            const key = `${group.parentKey}:${group.childKey}`;
            const current = grouped.get(key) || {
                parentKey: group.parentKey,
                parentLabel: group.parentLabel,
                childKey: group.childKey,
                label: group.label,
                order: group.order,
                items: []
            };

            current.items.push(item);
            grouped.set(key, current);
        }

        const sortedGroups = [...grouped.values()]
            .sort((a, b) =>
                (tallyParentOrder[a.parentKey] ?? 999) -
                    (tallyParentOrder[b.parentKey] ?? 999) ||
                a.parentKey.localeCompare(b.parentKey) ||
                a.order - b.order ||
                a.childKey.localeCompare(b.childKey)
            );

        let previousParentKey: string | null = null;

        for (const group of sortedGroups) {
            if (group.parentKey !== previousParentKey) {
                const parentRow = worksheet.addRow([
                    group.parentLabel,
                    "",
                    "",
                    ""
                ]);

                worksheet.mergeCells(
                    parentRow.number,
                    1,
                    parentRow.number,
                    4
                );

                parentRow.font = { bold: true, size: 12 };
                parentRow.fill = {
                    type: "pattern",
                    pattern: "none"
                };

                previousParentKey = group.parentKey;
            }

            const groupDebit = group.items.reduce(
                (sum, item) => sum + Number(item.periodDebit || 0),
                0
            );
            const groupCredit = group.items.reduce(
                (sum, item) => sum + Number(item.periodCredit || 0),
                0
            );
            const groupClosingSigned = group.items.reduce(
                (sum, item) => sum + Number(item.closingSigned || 0),
                0
            );
            const groupRow = worksheet.addRow([
                group.label,
                groupDebit || null,
                groupCredit || null,
                groupClosingSigned || null
            ]);

            groupRow.font = { bold: true };
            groupRow.fill = {
                type: "pattern",
                pattern: "none"
            };
            groupRow.getCell(2).numFmt = '#,##0.00';
            groupRow.getCell(3).numFmt = '#,##0.00';
            groupRow.getCell(4).numFmt =
                '#,##0.00 "Dr";#,##0.00 "Cr";-';

            group.items
                .sort((a, b) =>
                    String(a.account).localeCompare(
                        String(b.account)
                    )
                );

            for (const item of group.items) {
                const row = worksheet.addRow([
                    item.account,
                    item.periodDebit !== 0
                        ? item.periodDebit
                        : null,
                    item.periodCredit !== 0
                        ? item.periodCredit
                        : null,
                    item.closingSigned !== 0
                        ? item.closingSigned
                        : null
                ]);

                row.height = 21;

                row.getCell(1).alignment = {
                    horizontal: "left",
                    vertical: "middle"
                };

                row.getCell(2).alignment = {
                    horizontal: "right",
                    vertical: "middle"
                };

                row.getCell(2).numFmt = '#,##0.00';
                row.getCell(3).numFmt = '#,##0.00';
                row.getCell(4).numFmt =
                    '#,##0.00 "Dr";#,##0.00 "Cr";-';

                row.getCell(3).alignment = {
                    horizontal: "right",
                    vertical: "middle"
                };

                row.getCell(4).alignment = {
                    horizontal: "right",
                    vertical: "middle"
                };

                for (let column = 1; column <= 4; column++) {
                    row.getCell(column).border = {
                        bottom: {
                            style: "hair"
                        }
                    };
                }
            }

        }

        /* ============================================================
           TOTAL ROW
        ============================================================ */

        // Recalculate turnover from the rows being exported.  The closing
        // credit total is a net balance and must not be used as turnover.
        const exportedDebit = options.data.reduce(
            (sum, item) => sum + Number(item.periodDebit || 0),
            0
        );
        const exportedCredit = options.data.reduce(
            (sum, item) => sum + Number(item.periodCredit || 0),
            0
        );
        const totalRow = worksheet.addRow([
            "Grand Total",
            Number(exportedDebit.toFixed(2)),
            Number(exportedCredit.toFixed(2)),
            null
        ]);

        totalRow.height = 25;

        totalRow.font = {
            bold: true,
            size: 11
        };

        totalRow.getCell(2).numFmt = '#,##0.00';
        totalRow.getCell(3).numFmt = '#,##0.00';
        totalRow.getCell(4).alignment = {
            horizontal: "right"
        };

        totalRow.getCell(2).alignment = {
            horizontal: "right"
        };

        totalRow.getCell(3).alignment = {
            horizontal: "right"
        };

        for (let column = 1; column <= 4; column++) {
            totalRow.getCell(column).border = {
                top: {
                    style: "double"
                },
                bottom: {
                    style: "double"
                }
            };
        }

        /* ============================================================
           FREEZE HEADER
        ============================================================ */

        worksheet.views = [
            {
                state: "frozen",
                ySplit: headerRowNumber
            }
        ];

        worksheet.pageSetup.printTitlesRow =
            `${headerRowNumber}:${headerRowNumber}`;

        // Tally uses a plain Arial/black presentation without the blue
        // application theme. Preserve bold/size settings while normalising
        // the report font and removing any inherited white font color.
        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.font = {
                    ...(cell.font || {}),
                    name: "Arial",
                    color: { argb: "FF000000" }
                };
            });
        });

        /* ============================================================
           RESPONSE
        ============================================================ */

        res.status(200);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${options.filename}.xlsx"`
        );

        await workbook.xlsx.write(res as any);

        res.end();
    }

}
