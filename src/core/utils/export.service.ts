import ExcelJS from "exceljs";
import { Response } from "express";
import { getByPath } from "./loc.utils";

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

  columns: ExportColumn<T>[];

  data: T[];

  filters?: Record<string, any>;

  headerStyle?: Partial<ExcelJS.Style>;
  rowStyle?: Partial<ExcelJS.Style>;

  customRowStyles?: (
    row: T,
    index: number
  ) => Partial<ExcelJS.Style>;
}

export class ExcelService {
    private static applyStyles<T>(
        worksheet: ExcelJS.Worksheet,
        options: ExportRequest<T>
    ) {
        // Header Style
        const headerRow = worksheet.getRow(1);

        headerRow.eachCell((cell) => {
            if (options.headerStyle?.fill)
            cell.fill = options.headerStyle.fill;

            if (options.headerStyle?.font)
            cell.font = options.headerStyle.font;

            if (options.headerStyle?.alignment)
            cell.alignment = options.headerStyle.alignment;
        });

        // Row Style
        if (options.rowStyle) {
            for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);

            row.eachCell((cell) => {
                if (options.rowStyle?.alignment)
                cell.alignment = options.rowStyle.alignment;

                if (options.rowStyle?.font)
                cell.font = options.rowStyle.font;
            });
            }
        }
    }
    static async export<T>(
        res: Response,
        options: ExportRequest<T>
    ) {
        const workbook = new ExcelJS.Workbook();

        const worksheet = workbook.addWorksheet(
            options.sheetName || "Sheet1"
        );

        const headerRowNumber = 1;


        /**
         * ==========================
         * Header Row
         * ==========================
         */
        const headerRow =
            worksheet.addRow(
                options.columns.map(
                    col => col.header
                )
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
                ySplit: 1
            }
        ];

        /**
         * Auto Filter
         */
        worksheet.autoFilter = {
            from: {
                row: 1,
                column: 1
            },
            to: {
                row: 1,
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
}