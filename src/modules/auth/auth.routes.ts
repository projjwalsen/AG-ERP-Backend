import { Router } from "express";
import * as authController from "./auth.controller";
import { authMiddleware } from "../../core/middleware/auth";

const router = Router();

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     summary: Signup company and first user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [masterName, name, email, password]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Company Manager
 *               email:
 *                 type: string
 *                 example: manager@example.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *               password:
 *                 type: string
 *                 example: Password@123
 *     responses:
 *       201:
 *         description: Signup successful and cookie set
 *       409:
 *         description: User already exists
 */
router.post(
    "/signup", 
    authController.signup
);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@ashtavinayaka.com
 *               password:
 *                 type: string
 *                 example: AGERP@2026
 *     responses:
 *       200:
 *         description: Login successful and cookie set
 *       401:
 *         description: Invalid email or password
 *       403:
 *         description: User or company inactive
 */
router.post(
    "/login", 
    authController.login
);

/**
 * @openapi
 * /api/auth/profile:
 *   get:
 *     summary: Get logged-in user profile
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile fetched successfully
 *       401:
 *         description: Missing or invalid authentication cookie
 *       403:
 *         description: User or company inactive
 */
router.get("/profile", authMiddleware, authController.getProfile);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logout successful and cookie cleared
 */
router.post(
    "/logout", 
    authController.logout
);

export default router;