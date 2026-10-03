import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth";
import { importExcel } from "./multer.import";
import {
    downloadImportErrorReport,
    importAgencyWorkbook,
    importJournalWorkbook,
    importOpeningBalanceJournalWorkbook,
    reconcileTdsAssetsWorkbook,
    reconcileAgencyLedgerWorkbook,
    importInwardDebitCreditNoteWorkbook,
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

/** Import only opening balances from a Tally Trial Balance workbook. */
router.post(
    "/import/opening-balance-journals",
    authMiddleware,
    importExcel.single("file"),
    importOpeningBalanceJournalWorkbook
);

/**
 * @openapi
 * /api/migration/import/tds-assets/reconcile:
 *   post:
 *     summary: Reconcile TDS Assets journal vouchers
 *     description: >
 *       Upload an ER TD ID Report to move existing TDS Assets journal
 *       postings onto the matching agency Sundry Debtor ledger. Use
 *       dryRun=true to validate without changing data.
 *     tags:
 *       - Import
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: dryRun
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Validate the workbook without applying changes.
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
 *                 description: ER TD ID Report Excel workbook.
 *     responses:
 *       200:
 *         description: TDS Assets reconciliation completed.
 *       400:
 *         description: Invalid workbook or unmatched voucher rows.
 *       401:
 *         description: Unauthorized.
 */
router.post(
    "/import/tds-assets/reconcile",
    authMiddleware,
    importExcel.single("file"),
    reconcileTdsAssetsWorkbook
);

/**
 * @openapi
 * /api/migration/import/agency-ledger/reconcile:
 *   post:
 *     summary: Reconcile an agency ledger workbook
 *     description: >
 *       Match the vouchers in an agency's Tally Ledger Account workbook to
 *       existing system vouchers and move a safely identified party posting
 *       to that agency's branch ledger. Missing or ambiguous vouchers are
 *       reported and are never created or guessed. Preview mode is the default;
 *       set apply=true to commit safe matches.
 *     tags:
 *       - Import
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: apply
 *         schema: { type: boolean, default: false }
 *         description: Apply safe reconciliation changes; defaults to preview only.
 *       - in: query
 *         name: branchId
 *         schema: { type: string }
 *         description: Required when the actor has access to all branches and the agency has multiple ledgers.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, agencyName]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               agencyName:
 *                 type: string
 *               branchId:
 *                 type: string
 *               apply:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Preview or reconciliation result.
 *       400:
 *         description: Invalid workbook, agency, or branch.
 *       409:
 *         description: Reconciliation contains ambiguous rows; no changes applied.
 */
router.post(
    "/import/agency-ledger/reconcile",
    authMiddleware,
    importExcel.single("file"),
    reconcileAgencyLedgerWorkbook
);

/**
 * @openapi
 * /api/migration/import/inward-debit-credit-notes:
 *   post:
 *     summary: Import inward and outward debit and credit notes
 *     description: >
 *       Upload an Excel workbook containing all four note types. Inward rows
 *       use sourceType PURCHASE and outward rows use sourceType SALE. The
 *       Purchase/Sale Invoice No. column is used to link each note to its
 *       approved source invoice. Each note is then approved through the
 *       Debit/Credit Note accounting workflow, which updates AgencyOutstanding
 *       and creates the party/adjustment ledger voucher entries. The Path
 *       column is persisted as categoryPath.
 *     tags:
 *       - Import
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
 *                 description: Excel file with Date, Particular, Voucher Type, Voucher No., Debit, Credit, and Path columns.
 *     responses:
 *       200:
 *         description: Import completed. Existing notes matching voucher number are skipped.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     processed: { type: integer }
 *                     success: { type: integer }
 *                     skipped: { type: integer, description: Existing notes skipped by voucher number }
 *                     failed: { type: integer }
 *       400:
 *         description: Invalid workbook or note data.
 *       401:
 *         description: Unauthorized.
 */
router.post(
    "/import/inward-debit-credit-notes",
    authMiddleware,
    importExcel.single("file"),
    importInwardDebitCreditNoteWorkbook
);

export default router;
