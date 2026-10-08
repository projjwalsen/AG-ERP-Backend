import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth";
import { getSrv1APARReport } from "./ap-ar.controller";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/reports/srv1-ap-ar:
 *   get:
 *     summary: SRV1 Accounts Payable / Receivable Report
 *     description: |
 *       Returns the Tally Sundry Creditors or Sundry Debtors ledger summary.
 *       Select `PAYABLE` to read `APAR/crs31.03.2026.json` or
 *       `RECEIVABLE` to read `APAR/drs31.03.2026.json`.
 *
 *       The response includes each ledger's opening balance, transaction debit
 *       and credit, closing balance, and Grand Total. It also includes
 *       `agingRows`, which groups pending bills by party and reports the
 *       summed outstanding amount and oldest overdue age in days.
 *
 *       Use `export=DETAILS`, `export=AGING`, or `export=TRUE` to download the
 *       party-level outstanding and aging report as an Excel workbook.
 *     tags:
 *       - Reports
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [PAYABLE, RECEIVABLE]
 *         description: PAYABLE uses Sundry Creditors; RECEIVABLE uses Sundry Debtors.
 *       - in: query
 *         name: export
 *         required: false
 *         schema:
 *           type: string
 *           enum: [DETAILS, AGING, TRUE]
 *         description: Omit for JSON. Any listed value downloads the source-based ledger report.
 *     responses:
 *       200:
 *         description: Report returned as JSON or as an Excel workbook.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: SRV1 AP / AR report generated successfully
 *                 data:
 *                   type: object
 *                   description: Ledger rows with opening, transaction, closing, and source Grand Total balances.
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: type is missing or invalid.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 */
router.get("/", getSrv1APARReport);

export default router;
