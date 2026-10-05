import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth";
import { getSrv1TrialBalanceReport } from "./trial-balance.controller";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/reports/srv1-trial-balance:
 *   get:
 *     summary: SRV1 Trial Balance Report
 *     description: |
 *       Returns a Tally-style Trial Balance built from the SRV1 JSON
 *       fixture at `Trial/TALLYTRIALBAL.json`. The report includes the opening and closing
 *       balances, flat ledger rows, and an expandable account hierarchy.
 *
 *       The JSON source has no transaction movement totals. Transaction
 *       debit and credit values are therefore zero/blank in the report and
 *       the diagnostics indicate that movements are unavailable.
 *
 *       Set `export=true` to download the same report as an Excel workbook.
 *     tags:
 *       - Reports
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: export
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Set true to download the Excel report.
 *     responses:
 *       200:
 *         description: SRV1 Trial Balance generated successfully. Returns JSON unless export=true, in which case it returns an Excel workbook.
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
 *                   example: SRV1 Trial Balance report generated successfully
 *                 data:
 *                   type: object
 *                   description: Trial Balance report with period, summary, diagnostics, rows, tree, and accountGroups.
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized.
 */
router.get("/", getSrv1TrialBalanceReport);

export default router;
