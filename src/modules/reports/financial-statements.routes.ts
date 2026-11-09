import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth";
import {
    getLiveBalanceSheetReport,
    getLiveProfitAndLossReport,
    getSrv1BalanceSheetReport,
    getSrv1ProfitAndLossReport
} from "./financial-statements.controller";

const router = Router();
router.use(authMiddleware);

/**
 * @openapi
 * '/api/reports/srv1-profit&loss':
 *   get:
 *     summary: SRV1 Profit and Loss Statement
 *     description: Returns the Profit & Loss statement from the imported financial statement source rows. Use export=true to download an Excel workbook.
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: export
 *         schema:
 *           type: string
 *           enum: ["true", xlsx]
 *         description: Set true or xlsx to download the Excel report.
 *     responses:
 *       200:
 *         description: Profit and Loss JSON report or Excel workbook.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reportName: { type: string, example: Profit & Loss A/c }
 *                     company: { type: string }
 *                     period: { type: string, example: 1-Apr-25 to 31-Mar-26 }
 *                     rows: { type: array, items: { type: array, items: {} } }
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       401:
 *         description: Unauthorized.
 */
router.get("/srv1-profit&loss", getSrv1ProfitAndLossReport);

/**
 * @openapi
 * /api/reports/profit-and-loss:
 *   get:
 *     summary: Live Profit and Loss Statement
 *     description: |
 *       Builds a Tally-style Profit & Loss A/c from the live Trial Balance tree
 *       plus product opening stock (openingStockKG × sellPricePerUnit)
 *       and closing stock from Product.tempClosingBalance.
 *       Optional startDate/endDate are passed through to Trial Balance and
 *       drive the statement period label and movement windows.
 *       Use export=true to download an Excel workbook in the same layout as srv1-profit&loss.
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema: { type: string }
 *         description: Optional branch scope for the live Trial Balance.
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *         example: 2025-04-01
 *         description: >
 *           Inclusive period start (YYYY-MM-DD). Forwarded to
 *           GET /api/reports/trial-balance. When omitted, Trial Balance default period is used.
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *         example: 2026-03-31
 *         description: >
 *           Inclusive period end (YYYY-MM-DD). Forwarded to
 *           GET /api/reports/trial-balance. When omitted, Trial Balance default period is used.
 *       - in: query
 *         name: includeZero
 *         schema: { type: boolean, default: false }
 *         description: When true, include zero-balance Trial Balance rows used to build the statement.
 *       - in: query
 *         name: export
 *         schema:
 *           type: string
 *           enum: ["true", xlsx]
 *     responses:
 *       200:
 *         description: Live Profit and Loss JSON report or Excel workbook.
 *       401:
 *         description: Unauthorized.
 */
router.get("/profit-and-loss", getLiveProfitAndLossReport);

/**
 * @openapi
 * /api/reports/balance-sheet:
 *   get:
 *     summary: Live Balance Sheet
 *     description: |
 *       Builds a Tally-style Balance Sheet from the live Trial Balance tree.
 *       Classification is dynamic from each TB root closing:
 *       net Cr (closingDebit - closingCredit < 0) → Liabilities (left),
 *       net Dr (closingDebit - closingCredit > 0) → Assets (right).
 *       Skips P&L trading heads (Purchase/Sales/Direct/Indirect).
 *       Special cases: Suspense A/c (left), Profit & Loss A/c (opening from TB +
 *       Current Period = Nett Profit), Current Assets Opening Stock replaced by
 *       Closing Stock from Product.tempClosingBalance.
 *       Optional startDate/endDate are passed through to Trial Balance and
 *       drive the statement period label and as-at date.
 *       Use export=true to download an Excel workbook in the same layout as srv1-BlSheet.
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema: { type: string }
 *         description: Optional branch scope for the live Trial Balance.
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *         example: 2025-04-01
 *         description: >
 *           Inclusive period start (YYYY-MM-DD). Forwarded to
 *           GET /api/reports/trial-balance. When omitted, Trial Balance default period is used.
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *         example: 2026-03-31
 *         description: >
 *           Inclusive period end (YYYY-MM-DD). Forwarded to
 *           GET /api/reports/trial-balance. When omitted, Trial Balance default period is used.
 *       - in: query
 *         name: includeZero
 *         schema: { type: boolean, default: false }
 *         description: When true, include zero-balance Trial Balance rows used to build the statement.
 *       - in: query
 *         name: export
 *         schema:
 *           type: string
 *           enum: ["true", xlsx]
 *     responses:
 *       200:
 *         description: Live Balance Sheet JSON report or Excel workbook.
 *       401:
 *         description: Unauthorized.
 */
router.get("/balance-sheet", getLiveBalanceSheetReport);

/**
 * @openapi
 * /api/reports/srv1-BlSheet:
 *   get:
 *     summary: SRV1 Balance Sheet
 *     description: Returns the Balance Sheet from the imported financial statement source rows. Use export=true to download an Excel workbook.
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: export
 *         schema:
 *           type: string
 *           enum: ["true", xlsx]
 *         description: Set true or xlsx to download the Excel report.
 *     responses:
 *       200:
 *         description: Balance Sheet JSON report or Excel workbook.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reportName: { type: string, example: Balance Sheet }
 *                     company: { type: string }
 *                     period: { type: string, example: 1-Apr-25 to 31-Mar-26 }
 *                     rows: { type: array, items: { type: array, items: {} } }
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       401:
 *         description: Unauthorized.
 */
router.get("/srv1-BlSheet", getSrv1BalanceSheetReport);

export default router;
