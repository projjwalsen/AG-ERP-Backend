import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import pLimit from "p-limit";
import { ImportModule } from "./importRegistry";
import { Express } from "express";
import { AgencyType } from "@prisma/client";


export class AgencyImportService {

    static async importWorkbook(
        actor: any,
        file: Express.Multer.File,
        onProgress?: (summary:any)=>void
    ){

        ImportResolver.clearCache();

        const workbook =
            ExcelImportService.readExcel(file.buffer);

        const worksheet =
            ExcelImportService.getWorkSheet(workbook);

        const sheetName = workbook.SheetNames[0] || "";
        const defaultType = /sundry\s+creditors?/i.test(sheetName)
            ? AgencyType.VENDOR
            : /sundry\s+debtors?/i.test(sheetName)
                ? AgencyType.CLIENT
                : AgencyType.BOTH;

        const rows =
            ExcelImportService.readRows(worksheet, { headerRow: 8 });

        const agencies =
            ExcelImportService.parseAgencyRows(rows, defaultType);

//             console.table(
//     agencies.map(x => ({
//         agency: x.agencyName,
//         gstin: x.agencyGSTIN,
//         opening: x.openingBalance
//     }))
// );

        const summary = {
            total: agencies.length,
            processed:0,
            success:0,
            failed:0,
            percentage:0,
            errors:[]
        };

        const limit = pLimit(1);

        await Promise.all(

            agencies.map(dto=>

                limit(async()=>{

                    try{

                        await ImportResolver.resolveOrCreateAgencyMaster(dto);

                        summary.success++;

                    }
                    catch(error:any){

                        summary.failed++;

                        summary.errors.push({

                            agency:dto.agencyName,

                            error:error.message

                        });

                    }
                    finally{

                        summary.processed++;

                        summary.percentage=

                            Number(

                                (

                                    summary.processed/

                                    summary.total*

                                    100

                                ).toFixed(2)

                            );

                        onProgress?.(summary);

                    }

                })

            )

        );

        return summary;

    }

}
