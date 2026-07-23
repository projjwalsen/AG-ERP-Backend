import { Express } from "express";
import { AgencyImportService } from "./agencyImport.service";
import { ProductMasterImportService } from "./productImport.service";
import { ImportService } from "./multer.import";

export interface IImportService {

    importWorkbook(
        ...args: any[]
    ): Promise<any>;

}

export enum ImportModule {

    AGENCY = "AGENCY",

    PRODUCT = "PRODUCT",

    PURCHASE = "PURCHASE",

    SALES = "SALES",

    TRANSACTION = "TRANSACTION"

}

export class ImportRegistry {

    static resolve(
        module: ImportModule
    ): IImportService {

        switch (module) {

            case ImportModule.AGENCY:

                return AgencyImportService;

            case ImportModule.PRODUCT:

                return ProductMasterImportService;

            case ImportModule.PURCHASE:

            case ImportModule.SALES:

                return ImportService;

            // case ImportModule.TRANSACTION:
            //
            //     return TransactionImportService;

            default:

                throw new Error(
                    `No Import Service registered for ${module}`
                );

        }

    }

}