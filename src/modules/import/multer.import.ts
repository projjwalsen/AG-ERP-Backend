import { prisma } from "../../config/db";
import { PurchaseService } from "../purchase/purchase.service";
import { SalesService } from "../sales/sales.service";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import multer from "multer";

export class ImportService {

    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        type: "PURCHASE" | "SALE"
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
                worksheet
            );

        const parsedRows =
            ExcelImportService.parseRows(
                rawRows
            );

        const vouchers =
            ExcelImportService
                .groupAndValidateVouchers(
                    parsedRows
                );

        const summary = {

            total: vouchers.length,

            success: 0,

            failed: 0,

            errors: [] as any[]

        };

        const BATCH_SIZE = 50;

        for (
            let i = 0;
            i < vouchers.length;
            i += BATCH_SIZE
        ) {

            const batch =
                vouchers.slice(
                    i,
                    i + BATCH_SIZE
                );

            await prisma.$transaction(async () => {

                for (const voucher of batch) {

                    try {

                        if (type === "PURCHASE") {

                            const payload =
                                await ImportResolver
                                    .buildPurchasePayload(
                                        voucher
                                    );

                            await PurchaseService.createPurchase(
                                actor,
                                payload
                            );

                        }

                        else {

                            const payload =
                                await ImportResolver
                                    .buildSalePayload(
                                        voucher
                                    );

                            await SalesService.createSale(
                                actor,
                                payload
                            );

                        }

                        summary.success++;

                    }

                    catch (error: any) {

                        summary.failed++;

                        summary.errors.push({

                            voucherNo:
                                voucher.voucherNo,

                            invoiceNo:
                                voucher.invoiceNo,

                            error:
                                error.message

                        });

                    }

                }

            });

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