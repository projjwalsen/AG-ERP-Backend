import { Router } from "express";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";
import { auditLog } from "./accessLog.middleware";
import { exportAccessLogs, getAccessLogs } from "./accessLog.controller";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/access-logs:
 *   get:
 *     summary: List access logs
 *     description: Read-only audit trail of who performed which operation, when, and from which IP. Non-ALL-branch users only see their own branch.
 *     tags:
 *       - Access Logs
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *           maximum: 100
 *       - in: query
 *         name: performedById
 *         schema:
 *           type: string
 *       - in: query
 *         name: module
 *         schema:
 *           type: string
 *         description: PURCHASE, PURCHASE_ORDER, SALE, JOURNAL, MANUFACTURING, AGENCY, IMPORT
 *       - in: query
 *         name: operation
 *         schema:
 *           type: string
 *           enum: [CREATE, UPDATE, DELETE, APPROVE, REJECT, IMPORT, EXPORT, LOGIN, LOGOUT]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [SUCCESS, FAILED]
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *       - in: query
 *         name: ipAddress
 *         schema:
 *           type: string
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Matches description, user name or user email
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
 *         description: Access logs fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", checkPermission("ACCESS_LOG:VIEW"), getAccessLogs);

/**
 * @openapi
 * /api/access-logs/export:
 *   get:
 *     summary: Export access logs as Excel or CSV
 *     description: Downloads every log matching the filters (newest first, up to 50,000 rows). Accepts the same filters as the list endpoint; page and limit are ignored. Times are written in IST. The response header X-Export-Truncated is "true" when the 50,000 row cap was reached. Each export is itself recorded in the access log.
 *     tags:
 *       - Access Logs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [xlsx, csv]
 *           default: xlsx
 *       - in: query
 *         name: performedById
 *         schema:
 *           type: string
 *       - in: query
 *         name: module
 *         schema:
 *           type: string
 *       - in: query
 *         name: operation
 *         schema:
 *           type: string
 *           enum: [CREATE, UPDATE, DELETE, APPROVE, REJECT, IMPORT, EXPORT, LOGIN, LOGOUT]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [SUCCESS, FAILED]
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *       - in: query
 *         name: ipAddress
 *         schema:
 *           type: string
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
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
 *     responses:
 *       200:
 *         description: Excel or CSV file
 *       400:
 *         description: Invalid format or filter
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
    "/export",
    checkPermission("ACCESS_LOG:VIEW"),
    auditLog({ module: "ACCESS_LOG", operation: "EXPORT", entityType: "AccessLog", entityLabel: "Access Log" }),
    exportAccessLogs
);

export default router;
