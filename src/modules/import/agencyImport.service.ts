import { ExcelImportService } from "./excelImport.service";
import { ImportResolver } from "./import.resolver";
import pLimit from "p-limit";
import { ImportModule } from "./importRegistry";

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

        const rows =
            ExcelImportService.readRows(worksheet, { headerRow: 1 });

        const agencies =
            ExcelImportService.parseAgencyRows(rows);

        const summary = {
            total: agencies.length,
            processed:0,
            success:0,
            failed:0,
            percentage:0,
            errors:[]
        };

        const limit = pLimit(5);

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