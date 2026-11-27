import { Router } from "express";
import { requireInternalApiKey } from "./internalSync.auth";
import * as controller from "./internalSync.controller";

const router = Router();

// Machine-to-machine only. No ERP user session auth.
router.use(requireInternalApiKey);

/**
 * @openapi
 * tags:
 *   - name: InternalSync
 *     description: Srv1 → Srv2 silent export and watermark ACK APIs
 */

/**
 * @openapi
 * /api/internal-sync:
 *   get:
 *     summary: Export one entity page for Srv2 sync workers
 *     tags: [InternalSync]
 *     parameters:
 *       - in: header
 *         name: X-Internal-Api-Key
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: entity
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: updatedAt
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: id
 *         schema:
 *           type: string
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Entity page exported
 */
router.get("/", controller.exportEntityPage);

/**
 * @openapi
 * /api/internal-sync/ack:
 *   post:
 *     summary: Silently advance SyncWatermark after Srv2 upsert
 *     tags: [InternalSync]
 *     parameters:
 *       - in: header
 *         name: X-Internal-Api-Key
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity]
 *             properties:
 *               entity:
 *                 type: string
 *               cursor:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   updatedAt:
 *                     type: string
 *                   id:
 *                     type: string
 *               acknowledged:
 *                 type: integer
 *               runId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Watermark ack accepted
 */
router.post("/ack", controller.acknowledgePage);

/**
 * @openapi
 * /api/internal-sync/watermarks:
 *   get:
 *     summary: List SyncWatermark rows
 *     tags: [InternalSync]
 *     parameters:
 *       - in: header
 *         name: X-Internal-Api-Key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Watermark list
 */
router.get("/watermarks", controller.listWatermarks);

export default router;
