import { prisma } from "../../config/db";
import { Express } from "express";
import { PurchaseService } from "../purchase/purchase.service";
import { SalesService } from "../sales/sales.service";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import multer from "multer";
import pLimit from "p-limit";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";

type ImportErrorReport = {
    buffer: Buffer;
    fileName: string;
    expiresAt: number;
};

type ImportSummary = {
    total: number;
    processed: number;
    success: number;
    failed: number;
    percentage: number;
    errors: any[];
    errorReport?: {
        reportId: string;
        fileName: string;
    };
};

const importErrorReports = new Map<string, ImportErrorReport>();

function sourceRowValue(
    row: Record<string, any>,
    header: string
) {
    const normalizedHeader =
        ExcelImportService.normalizeHeader(header);

    const key = Object.keys(row).find(
        value =>
            ExcelImportService.normalizeHeader(value) === normalizedHeader
    );

    return key ? row[key] : undefined;
}

export async function createImportErrorReport(
    worksheet: XLSX.WorkSheet,
    errors: any[],
    headerRow = 3,
    filePrefix = "import"
) {
    const sourceRows = XLSX.utils.sheet_to_json<Record<string, any>>(
        worksheet,
        {
            range: headerRow - 1,
            defval: "",
            raw: false
        }
    );

    const rowsByVoucher = new Map<string, Record<string, any>[]>();
    let currentVoucher = "";

    for (const row of sourceRows) {
        const voucherNo = String(
            sourceRowValue(row, "Voucher No") || ""
        ).trim();

        if (voucherNo) {
            currentVoucher = voucherNo;
        }

        if (!currentVoucher) {
            continue;
        }

        const rows = rowsByVoucher.get(currentVoucher) || [];
        rows.push(row);
        rowsByVoucher.set(currentVoucher, rows);
    }

    const selectedRows: Record<string, any>[] = [];

    for (const error of errors) {
        const rows =
            rowsByVoucher.get(String(error.voucherNo).trim()) || [];

        if (rows.length === 0) {
            selectedRows.push({
                "Voucher No": error.voucherNo,
                "Invoice No": error.invoiceNo || "",
                "Import Error": error.error || "Unknown import error",
                "Error Code": error.code || "",
                "Error Meta": error.meta
                    ? JSON.stringify(error.meta)
                    : ""
            });
            continue;
        }

        for (const row of rows) {
            selectedRows.push({
                ...row,
                "Import Error": error.error || "Unknown import error",
                "Error Code": error.code || "",
                "Error Meta": error.meta
                    ? JSON.stringify(error.meta)
                    : ""
            });
        }
    }

    const columns: string[] = [];

    for (const row of selectedRows) {
        for (const key of Object.keys(row)) {
            if (!columns.includes(key)) {
                columns.push(key);
            }
        }
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Import Errors");

    sheet.columns = columns.map(key => ({
        header: key,
        key,
        width: Math.min(
            Math.max(key.length + 2, 14),
            45
        )
    }));

    sheet.addRows(
        selectedRows.map(row =>
            columns.map(column => row[column] ?? "")
        )
    );

    const header = sheet.getRow(1);
    //@ts-ignore
    header.font = { bold: true, color: "FFFFFFFF" };
    header.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F4E78" }
    };
    header.alignment = { vertical: "middle" };

    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
        from: "A1",
        to: `${sheet.getColumn(columns.length).letter}1`
    };

    const errorColumn = columns.indexOf("Import Error") + 1;
    if (errorColumn > 0) {
        sheet.getColumn(errorColumn).width = 65;
    }

    const reportId = randomUUID();
    const fileName = `${filePrefix}-import-errors-${reportId}.xlsx`;
    const buffer = Buffer.from(
        await workbook.xlsx.writeBuffer()
    );

    importErrorReports.set(reportId, {
        buffer,
        fileName,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });

    return {
        reportId,
        fileName
    };
}

export function getImportErrorReport(reportId: string) {
    const report = importErrorReports.get(reportId);

    if (!report || report.expiresAt < Date.now()) {
        importErrorReports.delete(reportId);
        return undefined;
    }

    return report;
}

export class ImportService {
    

    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        type: "PURCHASE" | "SALE",
        onProgress?: (summary:any)=>void
    ) {

        ImportResolver.clearCache();
        

        const workbook =
            ExcelImportService.readExcel(
                file.buffer
            );

        const worksheet =
            ExcelImportService.getWorkSheet(
                workbook
            );

        const sourceWorksheet = worksheet;

        const rawRows =
            ExcelImportService.readRows(
                worksheet, {
                    headerRow: 3
                }
            );

            console.log("RAW ROWS =", rawRows.length);

            console.log(rawRows[0]);

        const parsedRows =
            ExcelImportService.parseRows(
                rawRows,
                type
            );

            console.log("Parsed Rows:", parsedRows.length);

console.log(
    parsedRows.slice(0, 10).map(r => ({
        voucher: r.voucherNo,
        voucherDate: r.voucherDate,
        iso: r.voucherDate?.toISOString()
    }))
);


        let rowsToImport = parsedRows;


console.log("Rows To Import:", rowsToImport.length);


        const validationErrors: any[] = [];

        const vouchers =
            ExcelImportService
                .groupAndValidateVouchers(
                    rowsToImport,
                    type,
                    validationErrors
                );

                const seen = new Set<string>();

                const uniqueVouchers =
                    vouchers.filter(v => {

                        const key =
                            `${v.invoiceNo}|${v.voucherNo}`;

                        if (seen.has(key)) {
                            console.log("Duplicate voucher skipped", key);
                            return false;
                        }

                        seen.add(key);
                        return true;
                    });
        console.log("VOUCHERS =", uniqueVouchers.length);
        const summary: ImportSummary = {

            total:
                uniqueVouchers.length +
                validationErrors.length,

            processed: validationErrors.length,

            success: 0,

            failed: validationErrors.length,

            percentage: 0,

            errors: validationErrors,

            errorReport: undefined as
                | {
                    reportId: string;
                    fileName: string;
                }
                | undefined

        };

        if (validationErrors.length > 0) {
            onProgress?.({
                processed: summary.processed,
                total: summary.total,
                success: summary.success,
                failed: summary.failed,
                percentage: Number(
                    (
                        summary.processed /
                        summary.total *
                        100
                    ).toFixed(2)
                ),
                currentVoucher:
                    validationErrors[validationErrors.length - 1]
                        .voucherNo
            });
        }


            const limit = pLimit(1); // trying 2

            await Promise.all(

                uniqueVouchers.map(voucher =>

                    limit(async () => {

                        try {

                            if (type === "PURCHASE") {

                                const payload =
                                    await ImportResolver.buildPurchasePayload(voucher);

                                const purchase =
                                    await PurchaseService.createPurchase(
                                        actor,
                                        payload
                                    );

                                await PurchaseService.approvePurchase(
                                    actor,
                                    purchase.id
                                );

                            } else {

                                const payload =
                                    await ImportResolver.buildSalePayload(voucher);

                                const exists =
                                    await prisma.sale.findUnique({
                                        where: {
                                            invoiceNo: payload.invoiceNo
                                        }
                                    });

                                if (exists) {

                                    console.log(
                                        "Skipping existing invoice",
                                        payload.invoiceNo
                                    );

                                    summary.success++;

                                    return;
                                }

                                const existingSale =
                                    await prisma.sale.findFirst({
                                        where: {
                                            invoiceNo: payload.invoiceNo
                                        }
                                    });

                                if (existingSale) {

                                    console.log(
                                        `Skipping duplicate invoice ${payload.invoiceNo}`
                                    );

                                    return;
                                }

                                const sale =
                                    await SalesService.createSale(
                                        actor,
                                        payload
                                    );

                                await SalesService.approveSale(
                                    actor,
                                    sale.id
                                );

                            }

                            summary.success++;

                        } catch (error: any) {

                            console.error("\n================ FAILED =================");

                            console.error("Voucher :", voucher.voucherNo);

                            console.error("Code    :", error.code);

                            console.error("Message :", error.message);

                            console.error("Meta    :", error.meta);

                            console.error("Stack   :", error.stack);

                            console.error("=========================================\n");

                            summary.failed++;

                            summary.errors.push({

                                voucherNo: voucher.voucherNo,

                                invoiceNo: voucher.invoiceNo,

                                code: error.code,

                                meta: error.meta,

                                error: error.message

                            });

                        } finally {

                            summary.processed++;

                            summary.percentage = Number(

                                (
                                    summary.processed /
                                    summary.total *
                                    100
                                ).toFixed(2)

                            );

                            onProgress?.({
                                processed: summary.processed,
                                total: summary.total,
                                success: summary.success,
                                failed: summary.failed,
                                percentage: summary.percentage,
                                currentVoucher: voucher.voucherNo
                            });

                            console.log(

                                `[${summary.processed}/${summary.total}] ${summary.percentage}% - ${voucher.voucherNo}`

                            );
                        }

                    })

                )

            );


        if (summary.errors.length > 0) {
            summary.errorReport =
                await createImportErrorReport(
                    sourceWorksheet,
                    summary.errors,
                    3,
                    type.toLowerCase()
                );
        }

        return summary;

    }

}


export const importExcel = multer({

    storage:
        multer.memoryStorage(),

    limits: {

        fileSize:
            20 * 1024 * 1024

    },

    fileFilter(
        req,
        file,
        cb
    ) {

        const allowed = [

            "application/vnd.ms-excel",

            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        ];

        if (

            allowed.includes(file.mimetype)

        ) {

            cb(null, true);

        }

        else {

            cb(

                new Error(
                    "Only Excel files are allowed."
                )

            );

        }

    }

});
