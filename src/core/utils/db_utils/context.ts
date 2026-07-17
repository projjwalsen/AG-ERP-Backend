import { AsyncLocalStorage } from "async_hooks";
import { prisma } from "../../../config/db";
import { importPrisma } from "../../../config/import.db";

export enum ImportDatabase {
    PRIMARY,
    STAGING
}

export class ImportContext {

    private static storage = new AsyncLocalStorage<ImportDatabase>();

    static async run(
        db: ImportDatabase,
        callback: () => Promise<any>
    ) {
        return await this.storage.run(db, callback);
    }

    static get prisma() {

        const database = this.storage.getStore();

        return database === ImportDatabase.STAGING
            ? importPrisma
            : prisma;
    }

}