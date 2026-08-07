import { Router } from "express";
import * as JournalController from "./journal.controller";
import { authMiddleware, checkPermission } from "../../core/middleware/auth";

const router = Router();
router.use(authMiddleware);

/**
 * @openapi
 * /api/journal/head/create:
 *   post:
 *     tags:
 *       - Journal
 *     summary: Create Journal Head
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *                 example: Salary Payable
 *               type:
 *                 type: string
 *                 enum:
 *                   - INWARD
 *                   - OUTWARD
 *               ledgerId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Journal Head created successfully
 */
router.post("/head/create", checkPermission("JOURNAL:WRITE"), JournalController.createJournalHead);


/**
 * @openapi
 * /api/journal/head/{journalHeadId}:
 *   put:
 *     tags:
 *       - Journal
 *     summary: Update Journal Head
 *     parameters:
 *       - in: path
 *         name: journalHeadId
 *         required: true
 *         schema:
 *           type: string
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
 *                 enum:
 *                   - INWARD
 *                   - OUTWARD
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated successfully
 */

router.put("/head/:journalHeadId", checkPermission("JOURNAL:WRITE"), JournalController.updateJournalHead);


/**
 * @openapi
 * /api/journal/head/{journalHeadId}:
 *   delete:
 *     tags:
 *       - Journal
 *     summary: Delete Journal Head
 *     parameters:
 *       - in: path
 *         name: journalHeadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted successfully
 */

router.delete("/head/:journalHeadId", checkPermission("JOURNAL:WRITE"), JournalController.deleteJournalHead);


/**
 * @openapi
 * /api/journal/head/{journalHeadId}:
 *   get:
 *     tags:
 *       - Journal
 *     summary: Get Journal Head
 *     parameters:
 *       - in: path
 *         name: journalHeadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Journal Head
 */

router.get("/head/:journalHeadId", checkPermission("JOURNAL:VIEW"), JournalController.getJournalHeadById);


/**
 * @openapi
 * /api/journal/heads:
 *   get:
 *     tags:
 *       - Journal
 *     summary: List Journal Heads
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum:
 *             - INWARD
 *             - OUTWARD
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Journal Heads List
 */

router.get("/heads", checkPermission("JOURNAL:VIEW"), JournalController.listJournalHeads);



/** ------------------- CREATE JOURNAL --------------------- */



/**
 * @openapi
 * /api/journal/create:
 *   post:
 *     tags:
 *       - Journal
 *     summary: Create Journal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - branchId
 *               - journalHeadId
 *               - amount
 *               - paymentMode
 *             properties:
 *               branchId:
 *                 type: string
 *                 format: uuid
 *               journalHeadId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 example: 1200
 *               paymentMode:
 *                 type: string
 *                 enum:
 *                   - ONLINE
 *                   - OFFLINE
 *               paymentThrough:
 *                 type: string
 *                 enum:
 *                   - CASH
 *                   - NEFT
 *                   - RTGS
 *                   - UPI
 *                   - CHEQUE
 *                   - DD
 *                   - BANK_DEPOSIT
 *               remarks:
 *                 type: string
 *               journalDate:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Journal created successfully
 */

router.post("/create", checkPermission("JOURNAL:WRITE"), JournalController.createJournal);

/**
 * @openapi
 * /api/journal/all:
 *   get:
 *     tags:
 *       - Journal
 *     summary: List Journals
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - PENDING
 *             - APPROVED
 *             - REJECTED
 *       - in: query
 *         name: journalHeadId
 *         schema:
 *           type: string
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Journal List
 */

router.get("/all", checkPermission("JOURNAL:VIEW"), JournalController.listJournals);


/**
 * @openapi
 * /api/journal/{journalId}:
 *   put:
 *     tags:
 *       - Journal
 *     summary: Update Journal
 *     parameters:
 *       - in: path
 *         name: journalId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               branchId:
 *                 type: string
 *               journalHeadId:
 *                 type: string
 *               amount:
 *                 type: number
 *               paymentMode:
 *                 type: string
 *               paymentThrough:
 *                 type: string
 *               remarks:
 *                 type: string
 *               journalDate:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Updated successfully
 */

router.put("/:journalId", checkPermission("JOURNAL:WRITE"), JournalController.updateJournal);


/**
 * @openapi
 * /api/journal/{journalId}:
 *   get:
 *     tags:
 *       - Journal
 *     summary: Get Journal By Id
 *     parameters:
 *       - in: path
 *         name: journalId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Journal Details
 */

router.get("/:journalId", checkPermission("JOURNAL:VIEW"), JournalController.getJournalById);





/**
 * @openapi
 * /api/journal/{journalId}/approve:
 *   patch:
 *     tags:
 *       - Journal
 *     summary: Approve Journal
 *     parameters:
 *       - in: path
 *         name: journalId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Journal approved successfully
 */

router.patch("/:journalId/approve", checkPermission("JOURNAL:APPROVE"), JournalController.approveJournal);


/**
 * @openapi
 * /api/journal/{journalId}/reject:
 *   patch:
 *     tags:
 *       - Journal
 *     summary: Reject Journal
 *     parameters:
 *       - in: path
 *         name: journalId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               remarks:
 *                 type: string
 *                 example: Incorrect amount entered
 *     responses:
 *       200:
 *         description: Journal rejected successfully
 */

router.patch("/:journalId/reject", checkPermission("JOURNAL:APPROVE"), JournalController.rejectJournal);


export default router;