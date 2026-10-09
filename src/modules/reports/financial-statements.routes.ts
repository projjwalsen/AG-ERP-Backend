import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth";
import {
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
