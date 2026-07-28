/**
 * Audit Log Routes
 *
 * All endpoints are Admin + Supervisor only — investigators have no visibility
 * into the raw audit log (they can't know which files were downloaded by others).
 *
 * Permission Matrix:
 * | Route                           | Admin | Supervisor | Investigator |
 * |---------------------------------|-------|------------|--------------|
 * | GET /audit                      | ✓     | ✓          | ✗            |
 * | GET /audit/statistics           | ✓     | ✓          | ✗            |
 * | GET /audit/evidence/:id         | ✓     | ✓          | ✗            |
 * | GET /audit/case/:id             | ✓     | ✓          | ✗            |
 * | GET /audit/user/:id             | ✓     | ✓          | ✗            |
 * | GET /audit/export               | ✓     | ✓          | ✗            |
 */

const express = require('express');
const router = express.Router();

const auditController = require('../controllers/audit.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  validate,
  listAuditLogsQuerySchema,
  exportQuerySchema,
  evidenceIdParamSchema,
  caseIdParamSchema,
  userIdParamSchema
} = require('../validators/audit.validator');

const ALLOWED = ['ADMIN', 'SUPERVISOR'];

// =============================================================================
// SWAGGER SCHEMAS
// =============================================================================

/**
 * @swagger
 * components:
 *   schemas:
 *     AuditLog:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         timestamp:
 *           type: string
 *           format: date-time
 *         action:
 *           type: string
 *           enum: [LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGED,
 *                  USER_CREATED, USER_UPDATED, USER_DELETED,
 *                  CASE_CREATED, CASE_UPDATED, CASE_ASSIGNED, CASE_CLOSED, CASE_DELETED,
 *                  EVIDENCE_UPLOADED, EVIDENCE_DOWNLOADED, EVIDENCE_APPROVED,
 *                  EVIDENCE_REJECTED, EVIDENCE_DELETED,
 *                  EVIDENCE_INTEGRITY_CHECK, EVIDENCE_INTEGRITY_FAILED,
 *                  SYSTEM_ERROR]
 *         entity:
 *           type: string
 *           enum: [USER, CASE, EVIDENCE, SESSION, SYSTEM]
 *         entityId:
 *           type: string
 *           nullable: true
 *         ipAddress:
 *           type: string
 *           nullable: true
 *         details:
 *           type: object
 *           nullable: true
 *         user:
 *           type: object
 *           nullable: true
 *           properties:
 *             id: { type: string }
 *             name: { type: string }
 *             email: { type: string }
 *             role: { type: string }
 *
 *     ChainOfCustody:
 *       type: object
 *       properties:
 *         evidence:
 *           type: object
 *           description: Evidence metadata
 *         chainOfCustody:
 *           type: array
 *           items: { $ref: '#/components/schemas/AuditLog' }
 *         totalEvents:
 *           type: integer
 *
 *     AuditStatistics:
 *       type: object
 *       properties:
 *         totalLogs: { type: integer }
 *         logsToday: { type: integer }
 *         byAction:
 *           type: object
 *           additionalProperties: { type: integer }
 *         recentActivity:
 *           type: array
 *           items: { $ref: '#/components/schemas/AuditLog' }
 */

// =============================================================================
// ROUTES
// =============================================================================

/**
 * @swagger
 * /api/v1/audit:
 *   get:
 *     summary: List audit logs
 *     description: |
 *       Paginated, filterable list of all audit log entries.
 *       Admin and Supervisor only.
 *     tags: [Audit Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *       - in: query
 *         name: userId
 *         schema: { type: string, format: uuid }
 *         description: Filter by acting user
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [LOGIN, LOGOUT, EVIDENCE_UPLOADED, EVIDENCE_DOWNLOADED, ...]
 *       - in: query
 *         name: entity
 *         schema:
 *           type: string
 *           enum: [USER, CASE, EVIDENCE, SESSION, SYSTEM]
 *       - in: query
 *         name: entityId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Audit logs retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AuditLog' }
 *                 pagination: { type: object }
 *       403:
 *         description: Admin or Supervisor only
 */
router.get('/',
  authenticate,
  authorize(ALLOWED),
  validate(listAuditLogsQuerySchema, 'query'),
  auditController.getAuditLogs
);

/**
 * @swagger
 * /api/v1/audit/statistics:
 *   get:
 *     summary: Audit statistics
 *     description: Summary counts of audit log events
 *     tags: [Audit Logs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/AuditStatistics' }
 */
router.get('/statistics',
  authenticate,
  authorize(ALLOWED),
  auditController.getStatistics
);

/**
 * @swagger
 * /api/v1/audit/export:
 *   get:
 *     summary: Export audit logs as CSV
 *     description: |
 *       Downloads audit logs as a CSV file suitable for legal proceedings.
 *       Accepts the same filters as the list endpoint, plus an optional caseId
 *       to scope the export to a single case's full history.
 *     tags: [Audit Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv], default: csv }
 *       - in: query
 *         name: caseId
 *         schema: { type: string, format: uuid }
 *         description: Scope export to this case (case + evidence events)
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: userId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: entity
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema: { type: string, format: binary }
 */
router.get('/export',
  authenticate,
  authorize(ALLOWED),
  validate(exportQuerySchema, 'query'),
  auditController.exportAuditLogs
);

/**
 * @swagger
 * /api/v1/audit/evidence/{evidenceId}:
 *   get:
 *     summary: Chain of custody for one evidence item
 *     description: |
 *       Returns the complete chronological handling history of a specific
 *       piece of evidence — upload, downloads, integrity checks, approvals, etc.
 *     tags: [Audit Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: evidenceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Chain of custody
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/ChainOfCustody' }
 *       404:
 *         description: Evidence not found
 */
router.get('/evidence/:evidenceId',
  authenticate,
  authorize(ALLOWED),
  validate(evidenceIdParamSchema, 'params'),
  auditController.getEvidenceChainOfCustody
);

/**
 * @swagger
 * /api/v1/audit/case/{caseId}:
 *   get:
 *     summary: Full audit trail for a case
 *     description: |
 *       Returns all audit log entries related to a case — including
 *       all evidence events for every piece of evidence in the case.
 *       Sorted chronologically (oldest first).
 *     tags: [Audit Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Case audit trail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     case: { type: object }
 *                     evidenceItems:
 *                       type: array
 *                       items: { type: object }
 *                     auditTrail:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/AuditLog' }
 *                     totalEvents: { type: integer }
 *       404:
 *         description: Case not found
 */
router.get('/case/:caseId',
  authenticate,
  authorize(ALLOWED),
  validate(caseIdParamSchema, 'params'),
  auditController.getCaseAuditTrail
);

/**
 * @swagger
 * /api/v1/audit/user/{userId}:
 *   get:
 *     summary: All actions performed by a specific user
 *     description: Paginated activity log for one user
 *     tags: [Audit Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: User audit history
 */
router.get('/user/:userId',
  authenticate,
  authorize(ALLOWED),
  validate(userIdParamSchema, 'params'),
  validate(listAuditLogsQuerySchema, 'query'),
  auditController.getUserAuditHistory
);

module.exports = router;
