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
 *       Returns the Trial Balance from `Trial/NEWTRIAL.json`, with opening
 *       debit/credit sides and the account hierarchy supplemented from
 *       `Trial/TALLYTRIALBAL.json`.
 *
 *       Rows include opening debit/credit, transaction debit/credit, and the
 *       calculated closing balance. Set `export=true` to download the report
 *       with the same figures and Tally-style formatting.
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
