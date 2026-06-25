import { Router } from "express"
import * as KPIController from "./kpi.controller"
import { authMiddleware } from "../../core/middleware/auth";

const router = Router();
router.use(authMiddleware);


/**
 * @openapi
 * /api/dashboard/kpi:
 *   get:
 *     summary: Get Dashboard KPIs
 *     description: >
 *       Returns the dashboard overview including KPI summary,
 *       branch-wise revenue graph, stock distribution and
 *       recent approved transactions.
 *
 *     tags:
 *       - Dashboard
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
 *         description: Branch ID (Only applicable for users with ALL branch access)
 *
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter dashboard from this date
 *
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter dashboard till this date
 *
 *     responses:
 *       200:
 *         description: Dashboard KPIs fetched successfully
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
    "/kpi",
    KPIController.getDashboardKPIs
);



export default router