/**
 * Case Management Routes
 * 
 * Routes for creating and managing investigation cases
 */

const express = require('express');
const router = express.Router();

/**
 * @swagger
 * /cases:
 *   get:
 *     summary: Get all cases
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     description: Returns cases based on user role. Investigators see only assigned cases.
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
 *           default: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, CLOSED, PENDING, ARCHIVED]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by case number or title
 *     responses:
 *       200:
 *         description: List of cases
 */
router.get('/', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

/**
 * @swagger
 * /cases/{id}:
 *   get:
 *     summary: Get case by ID
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Case details with evidence list
 *       404:
 *         description: Case not found
 */
router.get('/:id', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

/**
 * @swagger
 * /cases:
 *   post:
 *     summary: Create a new case
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     description: Supervisors and Admins can create cases
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *             properties:
 *               title:
 *                 type: string
 *                 example: Bank Robbery Investigation
 *               description:
 *                 type: string
 *                 example: Investigation into the robbery at First National Bank
 *               assignedInvestigatorId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional - assign an investigator immediately
 *     responses:
 *       201:
 *         description: Case created
 */
router.post('/', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

/**
 * @swagger
 * /cases/{id}:
 *   put:
 *     summary: Update a case
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [OPEN, CLOSED, PENDING, ARCHIVED]
 *               assignedInvestigatorId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Case updated
 */
router.put('/:id', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

/**
 * @swagger
 * /cases/{id}:
 *   delete:
 *     summary: Delete a case
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     description: Admin only. Soft deletes the case and all associated evidence.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Case deleted
 */
router.delete('/:id', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

module.exports = router;
