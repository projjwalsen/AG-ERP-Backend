import { prisma } from "../../config/db";
import { Express } from "express";
import { PurchaseService } from "../purchase/purchase.service";
import { SalesService } from "../sales/sales.service";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import multer from "multer";
import pLimit from "p-limit";

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


        const vouchers =
            ExcelImportService
                .groupAndValidateVouchers(
                    rowsToImport,
                    type
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
        const summary = {

            total: uniqueVouchers.length,

            processed: 0,

            success: 0,

            failed: 0,

            percentage: 0,

            errors: [] as any[]

        };


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