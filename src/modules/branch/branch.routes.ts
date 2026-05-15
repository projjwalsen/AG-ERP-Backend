import { Router } from "express";
import * as branchController from "./branch.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware)


/**
 * @openapi
 * tags:
 *   - name: Branches
 *     description: Branch management APIs
 */

/**
 * @openapi
 * /api/branches/create:
 *   post:
 *     summary: Create branch
 *     tags: [Branches]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Kolkata Depot
 *               code:
 *                 type: string
 *                 example: KOL_DEPOT
 *               gstin:
 *                 type: string
 *                 example: 19ABCDE1234F1Z5
 *               stateCode:
 *                 type: string
 *                 example: "19"
 *               addressLine1:
 *                 type: string
 *                 example: Main Road
 *               addressLine2:
 *                 type: string
 *                 example: Near Industrial Area
 *               city:
 *                 type: string
 *                 example: Kolkata
 *               state:
 *                 type: string
 *                 example: West Bengal
 *               pinCode:
 *                 type: string
 *                 example: "700001"
 *     responses:
 *       201:
 *         description: Branch created successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Permission denied
 *       409:
 *         description: Branch code or GSTIN already exists
 */
router.post(
    "/create",
    checkPermission("BRANCH:WRITE"),
    branchController.createBranch
)

/**
 * @openapi
 * /api/branches/all:
 *   get:
 *     summary: Get all branches
 *     tags: [Branches]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Branches fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Permission denied
 */
router.get(
    "/all",
    checkPermission("BRANCH:VIEW"),
    branchController.getAllBranches
)

/**
 * @openapi
 * /api/branches/selection:
 *   get:
 *     summary: Get active branches for dropdown selection
 *     tags: [Branches]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Branch selection fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Permission denied
 */
router.get(
    "/selection",
    checkPermission("BRANCH:VIEW"),
    branchController.getBranchesForSelection
)

/**
 * @openapi
 * /api/branches/{branchId}:
 *   get:
 *     summary: Get branch by ID
 *     tags: [Branches]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *         example: branch_id_1
 *     responses:
 *       200:
 *         description: Branch fetched successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Permission denied
 *       404:
 *         description: Branch not found
 */
router.get(
    "/:branchId",
    checkPermission("BRANCH:VIEW"),
    branchController.getBranchById
)

/**
 * @openapi
 * /api/branches/update/{branchId}:
 *   patch:
 *     summary: Update branch
 *     tags: [Branches]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *         example: branch_id_1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Kolkata Main Depot
 *               code:
 *                 type: string
 *                 example: KOL_MAIN
 *               gstin:
 *                 type: string
 *                 example: 19ABCDE1234F1Z5
 *               stateCode:
 *                 type: string
 *                 example: "19"
 *               addressLine1:
 *                 type: string
 *                 example: Updated Main Road
 *               addressLine2:
 *                 type: string
 *                 example: Near GST Office
 *               city:
 *                 type: string
 *                 example: Kolkata
 *               state:
 *                 type: string
 *                 example: West Bengal
 *               pinCode:
 *                 type: string
 *                 example: "700001"
 *     responses:
 *       200:
 *         description: Branch updated successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Permission denied
 *       404:
 *         description: Branch not found
 *       409:
 *         description: Branch code or GSTIN already exists
 */
router.patch(
    "/update/:branchId",
    checkPermission("BRANCH:WRITE"),
    branchController.updateBranch
)

/**
 * @openapi
 * /api/branches/update-status/{branchId}:
 *   patch:
 *     summary: Activate or deactivate branch
 *     tags: [Branches]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *         example: branch_id_1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       200:
 *         description: Branch status updated successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Permission denied
 *       404:
 *         description: Branch not found
 */
router.patch(
    "/update-status/:branchId",
    checkPermission("BRANCH:WRITE"),
    branchController.toggleBranchStatus
)

export default router;