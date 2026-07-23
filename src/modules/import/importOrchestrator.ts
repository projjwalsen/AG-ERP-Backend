import { Express } from "express";
import { ImportModule, ImportRegistry } from "./importRegistry";
import { ImportContext, ImportDatabase } from "../../core/utils/db_utils/context";

export class ImportOrchestrator {

    static async execute(

        actor: any,

        file: Express.Multer.File,

        module: ImportModule,

        onProgress?: (progress: any) => void

    ) {

        return ImportContext.run(
            ImportDatabase.STAGING,

            async () => {

                const importer =
                    ImportRegistry.resolve(module);

                return importer.importWorkbook(
                    actor,
                    file,
                    module,
                    onProgress
                );

            }

        );

    }

}