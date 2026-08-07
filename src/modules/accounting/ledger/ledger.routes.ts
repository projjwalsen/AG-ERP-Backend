import { Router } from "express";
import { 
    getLedgers, 
    getLedgerById, 
    getLedgerStatement, 
    setOpeningBalance, 
    getTrialBalance, 
    getLedgerGroups, 
    getLedgerByBranchId,
    getLedgerByAgencyId,
    getLedgerBySuspenseId,
    getCompanyLedger,
    getGSTLedger
} from "./ledger.controller";
import { authMiddleware, checkPermission } from "../../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/ledgers/groups:
 *   get:
 *     summary: Get all hierarchical ledger groups
 *     description: Returns the complete accounting ledger group hierarchy including Assets, Liabilities, Income and Expenses groups.
 *     tags:
 *       - Ledgers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Ledger groups fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *       401:
 *         description: Unauthorized
 */
router.get("/groups",checkPermission("LEDGER:VIEW") ,getLedgerGroups);


/**
 * @openapi
 * /api/ledgers/trial-balance:
 *   get:
 *     summary: Get Trial Balance Report
 *     description: Returns branch-wise or consolidated trial balance generated from all ledger postings.
 *     tags:
 *       - Ledgers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Branch ID filter
 *       - in: query
 *         name: groupCode
 *         schema:
 *           type: string
 *         description: Ledger group code filter
 *       - in: query
 *         name: includeZero
 *         schema:
 *           type: boolean
 *         description: Include zero balance ledgers
 *     responses:
 *       200:
 *         description: Trial balance generated successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/trial-balance", checkPermission("LEDGER:VIEW"), getTrialBalance);

/**
 * @openapi
 * /api/ledgers/get-all:
 *   get:
 *     summary: Get Ledger Masters
 *     description: Returns paginated ledger masters with filters by category, group and branch.
 *     tags:
 *       - Ledgers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by ledger name, code, GSTIN or PAN
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum:
 *             - CUSTOMER
 *             - VENDOR
 *             - BANK
 *             - CASH
 *             - GST
 *             - SALES
 *             - PURCHASE
 *             - PRODUCT
 *             - SUSPENSE
 *         description: Ledger category
 *       - in: query
 *         name: view
 *         schema:
 *           type: string
 *           enum:
 *            - BRANCH
 *            - AGENCY
 *            - SUSPENSE
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Branch filter
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Active status filter
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Ledgers fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/get-all", checkPermission("LEDGER:VIEW"), getLedgers);


/**
 * @openapi
 * /api/ledgers/company-ledger:
 *   get:
 *     summary: Company Ledger (Ashtavinayaka View)
 *     description: |
 *       Returns company level cashflow ledger from Ashtavinayaka's perspective.
 *
 *       This report is generated directly from APPROVED Transactions.
 *
 *       Features:
 *
 *       - All Approved Inward Transactions
 *       - All Approved Outward Transactions
 *       - Running Company Balance
 *       - Third Party Adjustments
 *       - Branch Filter
 *       - Date Range Filter
 *       - Excel Export
 *
 *       Third Party Example:
 *
 *       Tata Steel owes ₹5,000 to Ashtavinayaka.
 *
 *       Apex Technologies pays ₹5,000 on behalf of Tata Steel.
 *
 *       Ledger will show:
 *
 *       1. Income from Tata Steel
 *       2. Expense against Apex Technologies
 *
 *       This report is intended for Management / Directors.
 *
 *     tags:
 *       - Ledgers
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *
 *       - in: query
 *         name: branchId
 *         required: false
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
 *         name: export
 *         required: false
 *         schema:
 *           type: boolean
 *         example: true
 * 
 *       - in: query
 *         name: page
 *         required: true
 *         schema:
 *           type: integer
 *           default: 1
 * 
 *       - in: query
 *         name: limit
 *         required: true
 *         schema:
 *           type: integer
 *           default: 10
 *
 *     responses:
 *       200:
 *         description: Company ledger generated successfully
 *
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 company:
 *                   name: ASHTAVINAYAKA
 *
 *                 summary:
 *                   totalIncome: 250000
 *                   totalExpense: 180000
 *                   closingBalance: 70000
 *
 *                 entries:
 *                   - serialNo: 1
 *                     date: 22-Jun-2026
 *                     description: Amount received from Tata Steel Limited
 *                     income: 5000
 *                     expense: 0
 *                     balance: 5000
 *
 *                   - serialNo: 2
 *                     date: 22-Jun-2026
 *                     description: Amount paid by Apex Technologies on behalf of Tata Steel Limited
 *                     income: 0
 *                     expense: 5000
 *                     balance: 0
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Access denied
 */

router.get(
    "/company-ledger",
    checkPermission("LEDGER:VIEW"),
    getCompanyLedger
);

/**
 * @openapi
 * /api/ledgers/gst-ledger:
 *   get:
 *     summary: GST Ledger Register
 *     description: |
 *       Returns the complete GST Ledger Report for the selected period.
 *
 *       The report is generated from approved Purchase and Sale transactions
 *       and provides:
 *
 *       ### Input GST Ledger
 *       - GST paid on Purchases
 *       - Taxable Value
 *       - CGST
 *       - SGST
 *       - IGST
 *       - Total GST Credit Available
 *
 *       ### Output GST Ledger
 *       - GST collected on Sales
 *       - Taxable Value
 *       - CGST
 *       - SGST
 *       - IGST
 *       - Total GST Liability Generated
 *
 *       ### GST Liability Summary
 *       Calculates net GST payable after adjusting input tax credit.
 *
 *       Formula:
 *
 *       Net GST Payable = Output GST - Input GST
 *
 *       Supports:
 *       - Branch-wise filtering
 *       - Date range filtering
 *       - Excel export
 *
 *     tags:
 *       - Ledgers
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *
 *       - in: query
 *         name: branchId
 *         required: false
 *         description: Branch ID for branch-specific GST ledger
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 1548c22a-8751-4de9-8161-df6baad75d95
 *
 *       - in: query
 *         name: startDate
 *         required: false
 *         description: Report start date
 *         schema:
 *           type: string
 *           format: date
 *         example: 2026-06-01
 *
 *       - in: query
 *         name: endDate
 *         required: false
 *         description: Report end date
 *         schema:
 *           type: string
 *           format: date
 *         example: 2026-06-30
 *
 *       - in: query
 *         name: export
 *         required: false
 *         description: Export GST Ledger to Excel
 *         schema:
 *           type: boolean
 *         example: true
 *
 *     responses:
 *
 *       200:
 *         description: GST Ledger generated successfully
 *
 *       400:
 *         description: Invalid date range supplied
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Branch access denied
 *
 *       404:
 *         description: Branch not found
 *
 *       500:
 *         description: Internal server error
 */

router.get(
    "/gst-ledger",
    checkPermission("LEDGER:VIEW"),
    getGSTLedger
)



/**
 * @openapi
 * /api/ledgers/{ledgerId}:
 *   get:
 *     summary: Get Ledger Details By Id
 *     description: Returns ledger master information along with calculated balances.
 *     tags:
 *       - Ledgers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ledgerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Ledger ID
 *     responses:
 *       200:
 *         description: Ledger fetched successfully
 *       404:
 *         description: Ledger not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:ledgerId", checkPermission("LEDGER:VIEW"), getLedgerById);

/**
 * @openapi
 * /api/ledgers/branch/{branchId}:
 *   get:
 *    summary: Get Ledgers By Branch ID
 *    description: Returns all ledgers associated with a specific branch, optionally filtered by category.
 *    tags:
 *      - Ledgers
 *    security:
 *      - bearerAuth: []
 *   parameters:
 *     - in: path
 *       name: branchId
 *       required: true
 *       schema:
 *         type: string
 *     - in: query
 *       name: category
 *       schema:
 *         type: string
 *         enum:
 *           - ACCOUNTING_LEDGER
 *           - CASH
 *           - GST
 *           - DEBTORS
 *           - CREDITORS
 *           
 *   responses:
 *     200:
 *       description: Ledgers fetched successfully
 *     401:
 *       description: Unauthorized
 */
router.get(
    "/branch/:branchId",
    checkPermission("LEDGER:VIEW"),
    getLedgerByBranchId
)


/**
 * @openapi
 * /api/ledgers/agency/{agencyId}:
 *   get:
 *    summary: Get Ledgers By Agency ID
 *    description: Returns all ledgers associated with a specific agency, optionally filtered by category.
 *    tags:
 *      - Ledgers
 *    security:
 *      - bearerAuth: []
 *   parameters:
 *     - in: path
 *       name: agencyId
 *       required: true
 *       schema:
 *         type: string
 *     - in: query
 *       name: category
 *       schema:
 *         type: string
 *         enum:
 *           - ACCOUNTING_LEDGER
 *           - CASH
 *           - DEBTORS
 *           - CREDITORS
 *   responses:
 *     200:
 *       description: Ledgers fetched successfully
 *     401:
 *       description: Unauthorized
*/

router.get(
    "/agency/:agencyId",
    checkPermission("LEDGER:VIEW"),
    getLedgerByAgencyId
)


/**
 * @openapi
 * /api/ledgers/suspense/{branchId}:
 *   get:
 *     summary: Get Suspense Ledger By Branch
 *     description: |
 *       Returns suspense transactions for a branch.
 *
 *       Suspense transactions are transactions where:
 *
 *       suspenseAccount = true
 *
 *       Supports category wise filtering:
 *
 *       - ACCOUNTING_LEDGER → All suspense inward and outward transactions.
 *       - CASH → Only suspense cash transactions.
 *
 *     tags:
 *       - Ledgers
 *
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *         description: Branch ID
 *
 *       - in: query
 *         name: category
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - ACCOUNTING_LEDGER
 *             - CASH
 *         description: Suspense category filter
 *
 *     responses:
 *       200:
 *         description: Suspense ledger fetched successfully
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Access denied for this branch
 *
 *       404:
 *         description: Branch not found
 */

router.get(
    "/suspense/:branchId",
    checkPermission("LEDGER:VIEW"),
    getLedgerBySuspenseId
);




/**
 * @openapi
 * /api/ledgers/{ledgerId}/opening-balance:
 *   post:
 *     summary: Set Opening Balance
 *     description: Set or update ledger opening balance.
 *     tags:
 *       - Ledgers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ledgerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - openingBalance
 *             properties:
 *               openingBalance:
 *                 type: number
 *                 example: 15000
 *     responses:
 *       200:
 *         description: Opening balance updated successfully
 *       400:
 *         description: Invalid balance
 *       404:
 *         description: Ledger not found
 */
router.post("/:ledgerId/opening-balance", checkPermission("LEDGER:VIEW"), setOpeningBalance);




/**
 * @openapi
 * /api/ledgers/{ledgerId}/statement:
 *   get:
 *     summary: Get Ledger Statement
 *     description: Returns passbook-style ledger statement with debit, credit and running balances.
 *     tags:
 *       - Ledgers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ledgerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Ledger statement fetched successfully
 *       404:
 *         description: Ledger not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:ledgerId/statement",checkPermission("LEDGER:VIEW"), getLedgerStatement);

export default router;