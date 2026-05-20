import { Router } from "express";
import * as LocationController from "./meta.controller";
import { authMiddleware } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/meta/states:
 *   get:
 *     summary: Get all Indian states
 *     tags: [Meta]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Indian states fetched successfully
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
 *                   example: Indian states fetched successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     states:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                             example: West Bengal
 *                           isoCode:
 *                             type: string
 *                             example: WB
 *                           stateCode:
 *                             type: string
 *                             example: "19"
 */
router.get(
    "/states",
    LocationController.getIndianStates
);

/**
 * @openapi
 * /api/meta/cities/{isoCode}:
 *   get:
 *     summary: Get cities by state ISO code
 *     tags: [Meta]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: isoCode
 *         required: true
 *         schema:
 *           type: string
 *         example: WB
 *         description: State ISO Code
 *     responses:
 *       200:
 *         description: Cities fetched successfully
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
 *                   example: Cities fetched successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     cities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                             example: Kolkata
 */
router.get(
    "/cities/:isoCode",
    LocationController.getCitiesByState
);

export default router;