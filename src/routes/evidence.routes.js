/**
 * Evidence Routes
 *
 * Permission Matrix:
 * | Route                        | Admin | Supervisor | Investigator |
 * |------------------------------|-------|------------|--------------|
 * | GET  /evidence               | ✓ All | ✓ All      | Assigned only|
 * | GET  /evidence/:id           | ✓     | ✓          | Assigned only|
 * | POST /evidence/upload        | ✓     | ✓          | Assigned only|
 * | GET  /evidence/:id/download  | ✓     | ✓          | Assigned only|
 * | GET  /evidence/:id/verify    | ✓     | ✓          | Assigned only|
 * | PUT  /evidence/:id/approve   | ✓     | ✓          | ✗            |
 * | PUT  /evidence/:id/reject    | ✓     | ✓          | ✗            |
 * | DELETE /evidence/:id         | ✓     | ✗          | ✗            |
 */

const express = require('express');
const router = express.Router();

const evidenceController = require('../controllers/evidence.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { handleUpload } = require('../middleware/upload.middleware');
const {
  validate,
  uploadEvidenceSchema,
  rejectEvidenceSchema,
  listEvidenceQuerySchema,
  evidenceIdParamSchema
} = require('../validators/evidence.validator');
// =============================================================================
// SWAGGER SCHEMAS
// =============================================================================

/**
 * @swagger
 * components:
 *   schemas:
 *     Evidence:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         originalName:
 *           type: string
 *         fileType:
 *           type: string
 *           example: "image/jpeg"
 *         fileSize:
 *           type: string
 *           description: File size in bytes (as string due to BigInt)
 *         fileSizeFormatted:
 *           type: string
 *           example: "1.5 MB"
 *         sha256Hash:
 *           type: string
 *           description: SHA-256 hash for integrity verification
 *         status:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *         description:
 *           type: string
 *           nullable: true
 *         rejectReason:
 *           type: string
 *           nullable: true
 *         caseId:
 *           type: string
 *           format: uuid
 *         uploadedAt:
 *           type: string
 *           format: date-time
 *         uploadedBy:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             email:
 *               type: string
 *         reviewedBy:
 *           type: object
 *           nullable: true
 *         reviewedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 *     EvidenceIntegrityResult:
 *       type: object
 *       properties:
 *         intact:
 *           type: boolean
 *         storedHash:
 *           type: string
 *         currentHash:
 *           type: string
 *         reason:
 *           type: string
 */

// =============================================================================
// ROUTES
// =============================================================================

/**
 * @swagger
 * /api/v1/evidence:
 *   get:
 *     summary: List evidence
 *     description: Returns paginated evidence. Role-based access applies.
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *       - in: query
 *         name: caseId
 *         schema: { type: string, format: uuid }
 *         description: Filter by case
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [uploadedAt, fileSize, originalName, status]
 *           default: uploadedAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Evidence list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Evidence' }
 *                 pagination: { type: object }
 */
router.get('/',
  authenticate,
  validate(listEvidenceQuerySchema, 'query'),
  evidenceController.getEvidence
);

/**
 * @swagger
 * /api/v1/evidence/statistics:
 *   get:
 *     summary: Evidence statistics
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics object
 */
router.get('/statistics',
  authenticate,
  evidenceController.getStatistics
);

/**
 * @swagger
 * /api/v1/evidence/upload:
 *   post:
 *     summary: Upload evidence file
 *     description: |
 *       Uploads a file as evidence for a case.
 *       - SHA-256 hash is computed automatically
 *       - Evidence starts in PENDING status awaiting supervisor review
 *       - Use multipart/form-data with field name "file"
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - caseId
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               caseId:
 *                 type: string
 *                 format: uuid
 *               description:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Evidence uploaded and pending review
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Evidence' }
 *       400:
 *         description: Missing file, invalid type, or case not found
 *       403:
 *         description: Not authorized for this case
 */
router.post('/upload',
  authenticate,
  handleUpload,              // multer writes file to disk, populates req.file
  validate(uploadEvidenceSchema, 'body'),
  evidenceController.uploadEvidence
);

/**
 * @swagger
 * /api/v1/evidence/{id}:
 *   get:
 *     summary: Get evidence details
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Evidence details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Evidence' }
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Evidence not found
 */
router.get('/:id',
  authenticate,
  validate(evidenceIdParamSchema, 'params'),
  evidenceController.getEvidenceById
);

/**
 * @swagger
 * /api/v1/evidence/{id}/download:
 *   get:
 *     summary: Download evidence file
 *     description: |
 *       Streams the evidence file.
 *       - SHA-256 hash is re-verified before every download
 *       - Returns 422 if the file has been tampered with
 *       - Response header X-SHA256-Hash contains the verified hash
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Binary file stream
 *         headers:
 *           X-SHA256-Hash:
 *             schema: { type: string }
 *             description: SHA-256 hash of the downloaded file
 *         content:
 *           application/octet-stream:
 *             schema: { type: string, format: binary }
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Evidence not found
 *       422:
 *         description: Integrity check failed
 */
router.get('/:id/download',
  authenticate,
  validate(evidenceIdParamSchema, 'params'),
  evidenceController.downloadEvidence
);

/**
 * @swagger
 * /api/v1/evidence/{id}/verify:
 *   get:
 *     summary: Verify evidence integrity (no download)
 *     description: Re-computes the SHA-256 hash and compares with stored value
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Integrity check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/EvidenceIntegrityResult' }
 */
router.get('/:id/verify',
  authenticate,
  validate(evidenceIdParamSchema, 'params'),
  evidenceController.verifyEvidence
);

/**
 * @swagger
 * /api/v1/evidence/{id}/approve:
 *   put:
 *     summary: Approve pending evidence
 *     description: Admin or Supervisor approves a pending evidence item
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Evidence approved
 *       403:
 *         description: Admin or Supervisor only
 *       409:
 *         description: Evidence is not pending
 */
/**
 * @swagger
 * /api/v1/evidence/{id}/qrcode:
 *   get:
 *     summary: Get QR code for evidence verification
 *     description: Returns a PNG QR code encoding the verification URL for this evidence item
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PNG QR code image
 *         content:
 *           image/png:
 *             schema: { type: string, format: binary }
 */
router.get('/:id/qrcode',
  authenticate,
  validate(evidenceIdParamSchema, 'params'),
  evidenceController.getEvidenceQRCode
);

router.put('/:id/approve',
  authenticate,
  authorize(['ADMIN', 'SUPERVISOR']),
  validate(evidenceIdParamSchema, 'params'),
  evidenceController.approveEvidence
);

/**
 * @swagger
 * /api/v1/evidence/{id}/reject:
 *   put:
 *     summary: Reject pending evidence
 *     description: Admin or Supervisor rejects a pending evidence item with a reason
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Evidence rejected
 *       403:
 *         description: Admin or Supervisor only
 *       409:
 *         description: Evidence is not pending
 */
router.put('/:id/reject',
  authenticate,
  authorize(['ADMIN', 'SUPERVISOR']),
  validate(evidenceIdParamSchema, 'params'),
  validate(rejectEvidenceSchema, 'body'),
  evidenceController.rejectEvidence
);

/**
 * @swagger
 * /api/v1/evidence/{id}:
 *   delete:
 *     summary: Soft delete evidence
 *     description: Admin only. Marks evidence as deleted. File is kept on disk for audit purposes.
 *     tags: [Evidence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Evidence deleted
 *       403:
 *         description: Admin only
 *       404:
 *         description: Evidence not found
 */
router.delete('/:id',
  authenticate,
  authorize('ADMIN'),
  validate(evidenceIdParamSchema, 'params'),
  evidenceController.deleteEvidence
);

module.exports = router;
