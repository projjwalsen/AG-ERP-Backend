import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth";
import { importExcel } from "./multer.import";
import { importJournalWorkbook, importProductWorkbook, importWorkbook } from "./import.controller";

const router = Router();

/**
 * @openapi
 * /api/migration/import:
 *   post:
 *     summary: Import Purchase or Sale Register
 *     description: |
 *       Upload a Purchase Register or Sale Register Excel file exported from Tally.
 *
 *       The importer automatically:
 *
 *       - Creates Agencies if not found
 *       - Creates Products if not found
 *       - Creates Branches if not found
 *       - Imports Purchase or Sale vouchers
 *       - Imports Transport details
 *       - Creates Inventory Batches for Purchases
 *       - Consumes Inventory FIFO for Sales
 *       - Ignores RCM Purchase vouchers
 *
 *     tags:
 *       - Import
 *
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - type
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Purchase Register or Sale Register Excel (.xlsx/.xls)
 *
 *               type:
 *                 type: string
 *                 enum:
 *                   - PURCHASE
 *                   - SALE
 *                 description: Type of register being imported.
 * 
 *               fromDate:
 *                type: date
 *                format: date
 *                description: Start date for filtering vouchers.
 *
 *               toDate:
 *                type: date
 *                format: date
 *                description: End date for filtering vouchers.
 *
 *     responses:
 *       200:
 *         description: Import completed.
 *
 *       400:
 *         description: Invalid file or invalid import type.
 *
 *       401:
 *         description: Unauthorized.
 *
 *       500:
 *         description: Internal server error.
 */

router.post(
    "/import",
    authMiddleware,
    importExcel.single("file"),
    importWorkbook
)


/**
 * @openapi
 * /api/migration/product:
 *   post:
 *     tags:
 *       - Import
 *     summary: Import Product Master Excel
 *     description: Imports Product Master opening stock from an Excel file.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Product Master imported successfully.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Internal server error.
 */



router.post(

    "/product",

    authMiddleware,

    importExcel.single("file"),

    importProductWorkbook

);


/**
 * @openapi
 * /api/migration/import/journal:
 *   post:
 *     summary: Import Journal Register
 *     description: |
 *       Upload a Journal Register Excel file exported from Tally.
 *
 *       The importer automatically:
 *
 *       - Reads the Journal Register worksheet
 *       - Skips Purchase and Tax Invoice vouchers
 *       - Creates Journal Heads if they do not exist
 *       - Creates Journal entries
 *       - Automatically approves imported Journals
 *       - Generates Accounting Vouchers and Ledger Entries
 *       - Reports import progress through Server-Sent Events (SSE)
 *
 *     tags:
 *       - Import
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - JOURNAL
 *             - TRANSACTION
 *         description: Type of journal being imported.
 *
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Journal Register Excel (.xlsx/.xls)
 * 
 *               fromDate:
 *                type: date
 *                format: date
 *                description: Start date for filtering journal vouchers.
 *
 *               toDate:
 *                type: date
 *                format: date
 *                description: End date for filtering journal vouchers.
 *
 *     responses:
 *       200:
 *         description: Journal import completed successfully.
 *
 *       400:
 *         description: Invalid Excel file or unsupported format.
 *
 *       401:
 *         description: Unauthorized.
 *
 *       500:
 *         description: Internal server error.
 */

router.post(
    "/import/journal",
    authMiddleware,
    importExcel.single("file"),
    importJournalWorkbook
);

export default router;