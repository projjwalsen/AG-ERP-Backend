import { Router } from "express";
import * as ReportingController from "./reporting.controller";
import { authMiddleware } from "../../core/middleware/auth";

const router = Router();
router.use(authMiddleware)

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
    ReportingController.getBranchDayBook
)



export default router;