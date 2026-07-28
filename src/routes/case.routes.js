/**
 * Case Routes
 * 
 * RESTful endpoints for case management.
 * 
 * Permission Matrix:
 * | Route                  | Admin | Supervisor | Investigator |
 * |------------------------|-------|------------|--------------|
 * | GET /cases             | ✓ All | ✓ All      | Assigned only|
 * | GET /cases/:id         | ✓     | ✓          | Assigned only|
 * | POST /cases            | ✓     | ✓          | ✗            |
 * | PUT /cases/:id         | ✓     | ✓          | Limited      |
 * | PUT /cases/:id/assign  | ✓     | ✓          | ✗            |
 * | POST /cases/:id/close  | ✓     | ✓          | ✗            |
 * | POST /cases/:id/reopen | ✓     | ✓          | ✗            |
 * | DELETE /cases/:id      | ✓     | ✗          | ✗            |
 */

const express = require('express');
const router = express.Router();

const caseController = require('../controllers/case.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { 
  validate,
  createCaseSchema,
  updateCaseSchema,
  assignInvestigatorSchema,
  closeCaseSchema,
  listCasesQuerySchema,
  caseIdParamSchema,
  caseNumberParamSchema
} = require('../validators/case.validator');

// =============================================================================
// SWAGGER SCHEMAS
// =============================================================================

/**
 * @swagger
 * components:
 *   schemas:
 *     Case:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         caseNumber:
 *           type: string
 *           example: "CASE-2024-00001"
 *         title:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [OPEN, CLOSED, PENDING, ARCHIVED]
 *         priority:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           description: "1=Critical, 5=Low"
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         closedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         assignedInvestigator:
 *           type: object
 *           nullable: true
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *         createdBy:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *         evidenceCount:
 *           type: integer
 *
 *     CreateCaseRequest:
 *       type: object
 *       required:
 *         - title
 *       properties:
 *         title:
 *           type: string
 *           minLength: 3
 *           maxLength: 200
 *         description:
 *           type: string
 *           maxLength: 5000
 *         priority:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           default: 3
 *         assignedInvestigatorId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *       example:
 *         title: "Cyber Fraud Investigation - ABC Corp"
 *         description: "Investigation into suspected cyber fraud at ABC Corporation"
 *         priority: 2
 *         assignedInvestigatorId: "550e8400-e29b-41d4-a716-446655440000"
 *
 *     UpdateCaseRequest:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *           minLength: 3
 *           maxLength: 200
 *         description:
 *           type: string
 *           maxLength: 5000
 *         priority:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *         status:
 *           type: string
 *           enum: [OPEN, CLOSED, PENDING, ARCHIVED]
 *       example:
 *         title: "Updated Case Title"
 *         priority: 1
 *
 *     AssignInvestigatorRequest:
 *       type: object
 *       required:
 *         - investigatorId
 *       properties:
 *         investigatorId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           description: "Set to null to unassign"
 *
 *     CaseStatistics:
 *       type: object
 *       properties:
 *         total:
 *           type: integer
 *         byStatus:
 *           type: object
 *           properties:
 *             open:
 *               type: integer
 *             closed:
 *               type: integer
 *             pending:
 *               type: integer
 *             archived:
 *               type: integer
 *         byPriority:
 *           type: object
 *           additionalProperties:
 *             type: integer
 *         recentCases:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               caseNumber:
 *                 type: string
 *               title:
 *                 type: string
 *               status:
 *                 type: string
 *               createdAt:
 *                 type: string
 *                 format: date-time
 */

// =============================================================================
// ROUTES
// =============================================================================

/**
 * @swagger
 * /api/v1/cases:
 *   get:
 *     summary: Get all cases
 *     description: |
 *       Retrieve a paginated list of cases.
 *       - Admin/Supervisor: See all cases
 *       - Investigator: Only assigned cases
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, CLOSED, PENDING, ARCHIVED]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *       - in: query
 *         name: assignedTo
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by assigned investigator
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in title, description, case number
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [title, caseNumber, createdAt, updatedAt, priority, status]
 *           default: createdAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Cases retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Case'
 *                 pagination:
 *                   type: object
 *       401:
 *         description: Not authenticated
 */
router.get('/',
  authenticate,
  validate(listCasesQuerySchema, 'query'),
  caseController.getCases
);

/**
 * @swagger
 * /api/v1/cases/statistics:
 *   get:
 *     summary: Get case statistics
 *     description: Get aggregate statistics about cases
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/CaseStatistics'
 */
router.get('/statistics',
  authenticate,
  caseController.getStatistics
);

/**
 * @swagger
 * /api/v1/cases/number/{caseNumber}:
 *   get:
 *     summary: Get case by case number
 *     description: Retrieve a case using its case number (e.g., CASE-2024-00001)
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caseNumber
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^CASE-\d{4}-\d{5}$'
 *         description: Case number (e.g., CASE-2024-00001)
 *     responses:
 *       200:
 *         description: Case retrieved successfully
 *       403:
 *         description: Not authorized to access this case
 *       404:
 *         description: Case not found
 */
router.get('/number/:caseNumber',
  authenticate,
  validate(caseNumberParamSchema, 'params'),
  caseController.getCaseByCaseNumber
);

/**
 * @swagger
 * /api/v1/cases/{id}:
 *   get:
 *     summary: Get a case by ID
 *     description: Retrieve detailed information about a specific case
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
 *         description: Case retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Case'
 *       403:
 *         description: Not authorized to access this case
 *       404:
 *         description: Case not found
 */
router.get('/:id',
  authenticate,
  validate(caseIdParamSchema, 'params'),
  caseController.getCase
);

/**
 * @swagger
 * /api/v1/cases:
 *   post:
 *     summary: Create a new case
 *     description: Create a new investigation case. Admin and Supervisor only.
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCaseRequest'
 *     responses:
 *       201:
 *         description: Case created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Case'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Not authorized
 */
router.post('/',
  authenticate,
  authorize(['ADMIN', 'SUPERVISOR']),
  validate(createCaseSchema, 'body'),
  caseController.createCase
);

/**
 * @swagger
 * /api/v1/cases/{id}:
 *   put:
 *     summary: Update a case
 *     description: |
 *       Update case details.
 *       - Admin/Supervisor: Can update all fields
 *       - Investigator: Can only update description
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
 *             $ref: '#/components/schemas/UpdateCaseRequest'
 *     responses:
 *       200:
 *         description: Case updated successfully
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Case not found
 */
router.put('/:id',
  authenticate,
  validate(caseIdParamSchema, 'params'),
  validate(updateCaseSchema, 'body'),
  caseController.updateCase
);

/**
 * @swagger
 * /api/v1/cases/{id}/assign:
 *   put:
 *     summary: Assign an investigator to a case
 *     description: Assign or unassign an investigator. Admin and Supervisor only.
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
 *             $ref: '#/components/schemas/AssignInvestigatorRequest'
 *     responses:
 *       200:
 *         description: Investigator assigned successfully
 *       400:
 *         description: Invalid investigator
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Case or investigator not found
 */
router.put('/:id/assign',
  authenticate,
  authorize(['ADMIN', 'SUPERVISOR']),
  validate(caseIdParamSchema, 'params'),
  validate(assignInvestigatorSchema, 'body'),
  caseController.assignInvestigator
);

/**
 * @swagger
 * /api/v1/cases/{id}/close:
 *   post:
 *     summary: Close a case
 *     description: Mark a case as closed. Admin and Supervisor only.
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Optional closure reason
 *     responses:
 *       200:
 *         description: Case closed successfully
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Case not found
 *       409:
 *         description: Case is already closed
 */
router.post('/:id/close',
  authenticate,
  authorize(['ADMIN', 'SUPERVISOR']),
  validate(caseIdParamSchema, 'params'),
  validate(closeCaseSchema, 'body'),
  caseController.closeCase
);

/**
 * @swagger
 * /api/v1/cases/{id}/reopen:
 *   post:
 *     summary: Reopen a closed case
 *     description: Reopen a previously closed case. Admin and Supervisor only.
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
 *         description: Case reopened successfully
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Case not found
 *       409:
 *         description: Only closed cases can be reopened
 */
router.post('/:id/reopen',
  authenticate,
  authorize(['ADMIN', 'SUPERVISOR']),
  validate(caseIdParamSchema, 'params'),
  caseController.reopenCase
);

/**
 * @swagger
 * /api/v1/cases/{id}:
 *   delete:
 *     summary: Delete a case (soft delete)
 *     description: Soft delete a case. Admin only.
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
 *         description: Case deleted successfully
 *       403:
 *         description: Admin only
 *       404:
 *         description: Case not found
 */
router.delete('/:id',
  authenticate,
  authorize('ADMIN'),
  validate(caseIdParamSchema, 'params'),
  caseController.deleteCase
);

module.exports = router;
