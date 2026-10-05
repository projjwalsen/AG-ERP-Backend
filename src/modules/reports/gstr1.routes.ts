import { Router } from "express";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";
import { getSrv1GSTR1Report } from "./gstr1.controller";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/reports/srv1-gstr1:
 *   get:
 *     summary: SRV1 GSTR-1 Summary Report
 *     description: |
 *       Returns the GSTR-1 report summary from the SRV1
 *       `GSTR-1/GSTR-1 (1).json` Tally export. The source contains
 *       summarized B2B and registered credit/debit note figures, return
 *       status counts, GST registration, and the reporting period.
 *
 *       The source does not contain voucher-level invoice data, so `rows` is
 *       empty and the response diagnostics indicate that detail is unavailable.
 *       Set `export=true` to download the Tally-style GSTR-1 summary workbook.
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
 *         description: SRV1 GSTR-1 summary generated successfully.
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
 *                   example: SRV1 GSTR-1 report generated successfully
 *                 data:
 *                   type: object
 *                   description: GSTR-1 report including period, summary, B2B summary, registered credit/debit note summary, status counts, and diagnostics.
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 */
router.get("/", checkPermission("GSTR1:VIEW"), getSrv1GSTR1Report);

export default router;
