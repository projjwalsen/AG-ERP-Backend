import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth";
import { importExcel } from "./multer.import";
import {
    downloadImportErrorReport,
    importAgencyWorkbook,
    importJournalWorkbook,
    importProductWorkbook,
    importWorkbook
} from "./import.controller";

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
 * /api/migration/import/error-report/{reportId}:
 *   get:
 *     summary: Download Import Error Report
 *     description: |
 *       Downloads an Excel report containing failed purchase, sale, journal,
 *       or transaction-import rows.
 *       The report preserves the original import columns and adds Import Error,
 *       Error Code, and Error Meta columns.
 *
 *       Reports are stored temporarily and expire after 24 hours.
 *     tags:
 *       - Import
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         description: Error report identifier returned in the completed import event.
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Sale import error report Excel file.
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized.
 *       404:
 *         description: Report not found or expired.
 */
router.get(
    "/import/error-report/:reportId",
    authMiddleware,
    downloadImportErrorReport
);


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
 * /api/migration/agency:
 *   post:
 *     summary: Import Agency Master
 *     description: |
 *       Upload a Sundry Debtors or Sundry Creditors Excel exported from Tally.
 *
 *       The importer automatically:
 *
 *       - Creates Agencies if they do not exist
 *       - Updates existing Agencies based on GSTIN or Agency Name
 *       - Updates Agency Master information
 *       - Updates Ledger Opening Balance
 *       - Skips duplicate agencies within the same import
 *       - Streams import progress using Server-Sent Events (SSE)
 *
 *       Supported Excel Sources:
 *
 *       - Sundry Debtors
 *       - Sundry Creditors
 *
 *       Notes:
 *
 *       - Agency Name is read from the **Particulars** column.
 *       - GSTIN, PAN and Address are imported when available.
 *       - Agencies having no Opening Balance are ignored.
 *       - This import only creates/updates Agency Masters and Opening Balances.
 *       - No Purchase, Sale, Inventory, Transaction or Voucher is created.
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
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Sundry Debtors or Sundry Creditors Excel (.xls/.xlsx)
 *
 *     responses:
 *       200:
 *         description: Agency Master imported successfully.
 *
 *       400:
 *         description: Excel file is missing or invalid.
 *
 *       401:
 *         description: Unauthorized.
 *
 *       500:
 *         description: Internal server error.
 */

router.post(
    "/agency",
    authMiddleware,
    importExcel.single("file"),
    importAgencyWorkbook
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
 *             - BOTH
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
