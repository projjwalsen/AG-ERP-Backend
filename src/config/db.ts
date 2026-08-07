import "dotenv/config";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// Initialize the Prisma Client with PostgreSQL adapter and connection pooling
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
})

const adapter = new PrismaPg(pool);// Using Prisma's PostgreSQL adapter with connection pooling for efficient database interactions

export const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 80000,// Adjusted to 16 seconds to accommodate longer transactions
    timeout: 90000, // Adjusted to 20 seconds to prevent premature transaction failures
  },
});