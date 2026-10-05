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
 *       Returns a Tally pending-bills report using the SRV1 AP or AR export.
 *       Select `PAYABLE` to read `APAR/AP.json` or
 *       `RECEIVABLE` to read `APAR/AR.json`.
 *
 *       The source provides pending amount, bill reference, party, bill date,
 *       due date, and overdue days. It does not include original invoice,
 *       paid, GST, or TDS totals; the response diagnostics identify this limit.
 *
 *       Use `export=DETAILS`, `export=AGING`, or `export=TRUE` to download
 *       the corresponding Excel layout used by the live outstanding report.
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
 *         description: Select the AP or AR JSON source.
 *       - in: query
 *         name: export
 *         required: false
 *         schema:
 *           type: string
 *           enum: [DETAILS, AGING, TRUE]
 *         description: Omit for JSON. DETAILS, AGING, or TRUE downloads the matching Excel report.
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
 *                   description: Outstanding report with summary, agency rows, aging buckets, source diagnostics, and invoice details.
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
