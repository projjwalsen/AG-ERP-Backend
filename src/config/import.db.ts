import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.IMPORT_DB_URL
});

const adapter = new PrismaPg(pool);

export const importPrisma =
    new PrismaClient({

        adapter,

        transactionOptions: {

            maxWait: 80000,

            timeout: 90000

        }

    });