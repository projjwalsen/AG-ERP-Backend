import { Express } from "express";
import pLimit from "p-limit";

import { prisma } from "../../config/db";
import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import { ImportModule } from "./importRegistry";

export class ProductMasterImportService {

    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        onProgress?: (summary: any) => void
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

        const rows =
            ExcelImportService.readProductRows(
                worksheet
            );

        const products =
            ExcelImportService.parseProductRows(
                rows
            );

        const branch =
            await prisma.branch.findFirst({

                where: {

                    isActive: true

                },

                select: {

                    id: true,
                    name: true

                }

            });

        if (!branch) {

            throw new Error(
                "No active branch found."
            );

        }

        const summary = {

            total: products.length,

            processed: 0,

            success: 0,

            failed: 0,

            percentage: 0,

            errors: [] as any[]

        };

        const limit =
            pLimit(1);

        await Promise.all(

            products.map(dto =>

                limit(async () => {

                    try {

                        await ImportResolver.resolveOrCreateProductMaster(

                            branch.id,

                            dto

                        );

                        summary.success++;

                    }

                    catch (error: any) {

                        summary.failed++;

                        summary.errors.push({

                            product: dto.productName,

                            error: error.message

                        });

                    }

                    finally {

                        summary.processed++;

                        summary.percentage = Number(

                            (

                                summary.processed /

                                summary.total *

                                100

                            ).toFixed(2)

                        );

                        onProgress?.({

                            processed:
                                summary.processed,

                            total:
                                summary.total,

                            success:
                                summary.success,

                            failed:
                                summary.failed,

                            percentage:
                                summary.percentage,

                            currentProduct:
                                dto.productName

                        });

                    }

                })

            )

        );

        return summary;

    }

}