import { Router } from "express";
import * as AgencyController from "./agency.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/agencies/create:
 *   post:
 *     summary: Create agency
 *     tags: [Agencies]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type]
 *             properties:
 *               name:
 *                 type: string
 *                 example: ABC Petrochem
 *               type:
 *                 type: string
 *                 enum: [VENDOR, CLIENT, BOTH]
 *                 example: VENDOR
 *               gstin:
 *                 type: string
 *                 example: 19ABCDE1234F1Z5
 *               contactPerson:
 *                 type: string
 *                 example: Raj Sharma
 *               mobileNumber:
 *                 type: string
 *                 example: "9876543210"
 *               email:
 *                 type: string
 *                 example: agency@example.com
 *               addressLine1:
 *                 type: string
 *                 example: Park Street
 *               addressLine2:
 *                 type: string
 *                 example: Near Petrol Pump
 *               city:
 *                 type: string
 *                 example: Kolkata
 *               state:
 *                 type: string
 *                 example: West Bengal
 *               pinCode:
 *                 type: string
 *                 example: "700001"
 *               branches:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [branchId]
 *                   properties:
 *                     branchId:
 *                       type: string
 *                       example: 0c6dbf7f-1234-4567-8901-abcdef123456
 *                     openingBalance:
 *                       type: number
 *                       example: 50000
 *     responses:
 *       201:
 *         description: Agency created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: GSTIN already exists
 */

router.post(
    "/create",
    checkPermission("AGENCY:WRITE"),
    AgencyController.createAgency
)

/**
 * @openapi
 * /api/agencies/all:
 *   get:
 *     summary: Get all agencies
 *     tags: [Agencies]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by agency name, GSTIN, mobile number or contact person
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [VENDOR, CLIENT, BOTH]
 *         description: Filter by agency type
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         description: Filter by branch name or branch code
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Agencies fetched successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Agencies retrieved successfully
 *               data:
 *                 agencies: []
 *                 meta:
 *                   total: 100
 *                   page: 1
 *                   limit: 10
 *                   totalPages: 10
 *                   hasNextPage: true
 *                   hasPrevPage: false
 *       401:
 *         description: Unauthorized
 */

router.get(
    "/all",
    checkPermission("AGENCY:VIEW"),
    AgencyController.getAllAgencies
)

/**
 * @openapi
 * /api/agencies/{agencyId}:
 *   get:
 *     summary: Get agency by ID
 *     tags: [Agencies]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: agencyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agency ID
 *     responses:
 *       200:
 *         description: Agency fetched successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Agency not found
 */

router.get(
    "/:agencyId",
    checkPermission("AGENCY:VIEW"),
    AgencyController.getAgencyById
)

/**
 * @openapi
 * /api/agencies/update/{agencyId}:
 *   patch:
 *     summary: Update agency
 *     tags: [Agencies]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: agencyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agency ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [VENDOR, CLIENT, BOTH]
 *               gstin:
 *                 type: string
 *               contactPerson:
 *                 type: string
 *               mobileNumber:
 *                 type: string
 *               email:
 *                 type: string
 *               addressLine1:
 *                 type: string
 *               addressLine2:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               pinCode:
 *                 type: string
 *               branches:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     branchId:
 *                       type: string
 *                     openingBalance:
 *                       type: number
 *     responses:
 *       200:
 *         description: Agency updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Agency not found
 */

router.patch(
    "/update/:agencyId",
    checkPermission("AGENCY:WRITE"),
    AgencyController.updateAgency
)

/**
 * @openapi
 * /api/agencies/update-status/{agencyId}:
 *   patch:
 *     summary: Update agency active status
 *     tags: [Agencies]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: agencyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agency ID
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
 *         description: Agency status updated successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Agency not found
 */

router.patch(
    "/update-status/:agencyId",
    checkPermission("AGENCY:WRITE"),
    AgencyController.toggleAgencyStatus
)

export default router;