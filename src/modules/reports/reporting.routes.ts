import { Router } from "express";
import * as ReportingController from "./reporting.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();
router.use(authMiddleware)

/**
 * @openapi
 * /api/reports/trial-balance:
 *   get:
 *     summary: Trial Balance Report
 *     description: |
 *       Generates a Tally-style Trial Balance using accounting LedgerEntry rows.
 *
 *       The report includes:
 *       - Transaction Debit / Credit and a signed Closing Balance (Dr/Cr)
 *       - `tree`: expandable accounting-header -> group -> ledger nodes for the UI
 *       - `accountGroups`: backwards-compatible alias of `tree`
 *       - Balanced status and closing difference
 *
 *       Date filtering is based on Voucher voucherDate.
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional branch filter. Non-ALL users are restricted to their own branch.
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         example: 2026-07-01
 *         description: Optional period start date. Entries before this date become opening balance.
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         example: 2026-07-31
 *         description: Period end date. Defaults to today.
 *       - in: query
 *         name: includeZero
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Include ledgers with no opening, movement, or closing balance.
 *       - in: query
 *         name: export
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Set true to download Excel.
 *     responses:
 *       200:
 *         description: Trial balance generated successfully.
 *       400:
 *         description: Invalid date range.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Branch access denied.
 */
router.get(
    "/trial-balance",
    checkPermission("TRIAL_BALANCE:VIEW"),
    ReportingController.getTrialBalanceReport
)

/**
 * @openapi
 * /api/reports/branch/{branchId}/day-book:
 *   get:
 *     summary: Branch Wise Day Book / Cash Book
 *     description: |
 *       Returns a chronological cash and bank movement report for a branch.
 *
 *       Features:
 *       - Cash Receipts (Inward)
 *       - Cash Payments (Outward)
 *       - Online / Offline Payment Mode
 *       - Transaction Reference Number (UTR / Cheque / DD)
 *       - Routed Transactions (Via Secondary Agency)
 *       - Invoice Allocations
 *       - Date Range Filtering
 *
 *       This is an operational report generated from Transactions and Transaction Allocations.
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 1548c22a-8751-4de9-8161-df6baad75d95
 *
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         example: 2026-06-01
 *
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         example: 2026-06-30
 * 
 *       - in: query
 *         name: bankAccountId
 *         required: false
 *         example: 1548c22a-8751-4de9-8161-df6baad75d95
 *
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *          type: integer
 *          default: 1
 *
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *          type: integer
 *          default: 25
 *
 *       - in: query
 *         name: export
 *         required: false
 *         schema:
 *          type: string
 *         description: Flag to indicate if the report should be exported.
 *
 *     responses:
 *       200:
 *         description: Day Book generated successfully
 *
 *       400:
 *         description: Invalid date range
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Access denied for branch
 *
 *       404:
 *         description: Branch not found
 */

router.get(
    "/branch/:branchId/day-book",
    checkPermission("DAY_BOOK:VIEW"),
    ReportingController.getBranchDayBook
)


/**
 * @openapi
 * /api/reports/gstr1:
 *   get:
 *     summary: Generate GSTR-1 Outward Supplies Report
 *     description: |
 *       Generates the statutory GSTR-1 outward supplies report for approved sales invoices.
 *
 *       Features:
 *       - B2B / B2C classification
 *       - GSTIN based reporting
 *       - Place of Supply (POS)
 *       - Taxable value calculation
 *       - CGST / SGST / IGST breakup
 *       - Branch-wise filtering
 *       - Date range filtering
 *
 *     tags:
 *       - Reports
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Branch ID to filter report.
 *
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *           example: 2026-06-01
 *         description: Start date of reporting period.
 *
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *           example: 2026-06-30
 *         description: End date of reporting period.
 *
 *     responses:
 *       200:
 *         description: GSTR-1 report generated successfully.
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       500:
 *         description: Internal server error
 */

router.get(
    "/gstr1",
    checkPermission("GSTR1:VIEW"),
    ReportingController.getGSTR1Report
)


/**
 * @openapi
 * /api/reports/gst-suspense-log:
 *   get:
 *     summary: GST Suspense Account Clearing Log
 *     description: |
 *       Returns all transactions marked as suspense entries.
 *
 *       Suspense transactions represent unidentified or anonymous funds
 *       received by a branch that have not yet been mapped to a valid
 *       customer/vendor agency.
 *
 *       Business Workflow:
 *       - Transaction enters with suspenseAccount = true
 *       - Funds remain in holding state
 *       - Supervisor verifies source
 *       - Agency is linked
 *       - Entry becomes AUTHENTICATED
 *
 *       This report helps accountants track pending suspense entries
 *       awaiting authentication and reconciliation.
 *
 *     tags:
 *       - Reports
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Branch ID filter.
 *
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *           example: 2026-06-01
 *         description: Start date filter.
 *
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *           example: 2026-06-30
 *         description: End date filter.
 *
 *     responses:
 *       200:
 *         description: GST Suspense Account Clearing Log generated successfully.
 *    
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       500:
 *         description: Internal Server Error
 */

router.get(
    "/gst-suspense-log",
    checkPermission("GST_SUSPENSE_LOG:VIEW"),
    ReportingController.getGSTSuspenseAccountLog
)

/**
 * @openapi
 * /api/reports/stock-inventory:
 *   get:
 *     summary: Stock Inventory Report
 *     description: |
 *       Generates a stock and inventory report showing current stock position
 *       batch-wise and product-wise for a branch.
 *
 *       This report provides:
 *       - Product Code
 *       - Product Name
 *       - Batch Number
 *       - Branch Details
 *       - Current Stock (KG/LTR)
 *       - Batch Creation Date
 *       - Last Updated Date
 *
 *       Used by warehouse managers and accountants to monitor available stock.
 *
 *     tags:
 *       - Reports
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter inventory by branch.
 *
 *       - in: query
 *         name: productId
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter inventory by product.
 *
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-06-01"
 *         description: Filter batches created on or after this date.
 *
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-06-30"
 *         description: Filter batches created on or before this date.
 *
 *     responses:
 *       200:
 *         description: Stock inventory report generated successfully
 *         
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       500:
 *         description: Internal Server Error
 */

router.get(
    "/stock-inventory",
    checkPermission("STOCK_INVENTORY:VIEW"),
    ReportingController.getStockInventoryReport
);

/**
 * @openapi
 * /api/reports/outstanding-report:
 *   get:
 *     summary: Accounts Receivable / Payable Outstanding Report
 *     description: |
 *       Generates an Accounts Receivable (AR) and Accounts Payable (AP)
 *       Outstanding Report.
 *
 *       This report shows:
 *       - Agency ID
 *       - Agency Name
 *       - Agency Type
 *       - Total Outstanding Amount
 *       - Outstanding Type (Receivable / Payable)
 *
 *       Receivable = Agency owes money to the company.
 *       Payable = Company owes money to the agency.
 *
 *       Data is sourced from Agency Outstanding balances maintained
 *       within the accounting system.
 *
 *     tags:
 *       - Reports
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter report for a specific branch.
 *
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - RECEIVABLE
 *             - PAYABLE
 *         description: |
 *           RECEIVABLE = Customer owes money.
 *           PAYABLE = Company owes money.
 *
 *     responses:
 *       200:
 *         description: Outstanding report generated successfully.
 * 
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       500:
 *         description: Internal Server Error
 */


router.get(
    "/outstanding-report",
    checkPermission("OUTSTANDING_REPORT:VIEW"),
    ReportingController.getOutstandingReport
);

/**
 * @openapi
 *  /api/reports/outstanding-report/agency/export:
 *   get:
 *     tags:
 *       - Reports
 *     summary: Export Agency Outstanding Report
 *     description: |
 *       Exports the outstanding invoice report for a single agency in Excel format.
 *
 *       The report supports both:
 *       - **PAYABLE** → Purchase Outstanding (Accounts Payable)
 *       - **RECEIVABLE** → Sales Outstanding (Accounts Receivable)
 *
 *       The generated Excel contains invoice-level details including:
 *       - Agency Name
 *       - Invoice Number
 *       - Invoice Date
 *       - Due Date
 *       - Invoice Amount
 *       - GST Amount
 *       - Paid Amount
 *       - Outstanding Amount
 *       - Aging Days
 *       - Aging Bucket
 *       - Remarks
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: agencyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Agency ID whose outstanding invoices are to be exported.
 *
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: |
 *           Branch ID. Required only for users having access to multiple branches.
 *
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - PAYABLE
 *             - RECEIVABLE
 *         description: |
 *           Report type.
 *           - PAYABLE → Purchase Outstanding
 *           - RECEIVABLE → Sales Outstanding
 * 
 *       - in: query
 *         name: export
 *         required: true
 *         schema:
 *           type: string
 *         example: DETAILS
 *
 *     responses:
 *       200:
 *         description: Excel file generated successfully.
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *
 *       400:
 *         description: Invalid request parameters.
 *
 *       401:
 *         description: Unauthorized.
 *
 *       403:
 *         description: Branch access denied.
 *
 *       404:
 *         description: Agency not found.
 */

router.get(
    "/outstanding-report/agency/export",
    checkPermission("OUTSTANDING_REPORT:VIEW"),
    ReportingController.getOutstandingReport
);


export default router;
