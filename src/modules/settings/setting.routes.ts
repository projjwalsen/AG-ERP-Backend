import { Router } from "express";
import * as SettingController from "./setting.controller";
import { authMiddleware } from "../../core/middleware/auth";

const router = Router();
router.use(authMiddleware)

/**
 * @openapi
 * tags:
 *   - name: Settings
 *     description: Application settings management
 */

/**
 * @openapi
 * /api/settings/get-all:
 *   get:
 *     summary: Get system settings
 *     tags: [Settings]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Settings fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: SYSTEM
 *                     allowNegativeInventory:
 *                       type: boolean
 *                       example: false
 *                     allowNegativeTransaction:
 *                       type: boolean
 *                       example: false
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 */
router.get(
    "/get-all",
    SettingController.getSettings
);

/**
 * @openapi
 * /api/settings/update:
 *   patch:
 *     summary: Update system settings
 *     tags: [Settings]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowNegativeInventory:
 *                 type: boolean
 *                 example: true
 *               allowNegativeTransaction:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Settings updated successfully
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
 *                   example: Settings updated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: SYSTEM
 *                     allowNegativeInventory:
 *                       type: boolean
 *                       example: true
 *                     allowNegativeTransaction:
 *                       type: boolean
 *                       example: false
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.patch(
    "/update",
    SettingController.updateSettings
);

export default router;