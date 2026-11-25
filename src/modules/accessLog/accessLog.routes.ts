import { Router } from "express";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";
import { getAccessLogs } from "./accessLog.controller";

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

export default router;
