/**
 * Report Routes — PDF generation
 *
 * Generates downloadable PDF reports:
 *   GET /reports/case/:caseId          — Case Summary PDF
 *   GET /reports/evidence/:evidenceId  — Chain of Custody PDF
 *
 * Admin and Supervisor only.
 */

const express = require('express');
const router  = express.Router();

const { authenticate, authorize } = require('../middleware/auth.middleware');
const { prisma }  = require('../config/database');
const auditService = require('../services/audit.service');
const {
  generateCaseSummaryPDF,
  generateChainOfCustodyPDF
} = require('../utils/pdf.util');
const { NotFoundError } = require('../middleware/error.middleware');
const { logger } = require('../utils/logger');
const { z } = require('zod');

const ALLOWED = ['ADMIN', 'SUPERVISOR'];

function validateParam(schema, param) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) throw result.error;
    req.params = result.data;
    next();
  };
}

const uuidParam = (name) =>
  z.object({ [name]: z.string().uuid(`Invalid ${name} format`) });

/**
 * @swagger
 * /api/v1/reports/case/{caseId}:
 *   get:
 *     summary: Generate Case Summary PDF
 *     description: Downloads a PDF with case details and evidence inventory
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PDF file download
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       403:
 *         description: Admin or Supervisor only
 *       404:
 *         description: Case not found
 */
router.get('/case/:caseId',
  authenticate,
  authorize(ALLOWED),
  validateParam(uuidParam('caseId'), 'caseId'),
  async (req, res) => {
    const { caseId } = req.params;

    const caseData = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      include: {
        createdBy:           { select: { id: true, name: true, email: true } },
        assignedInvestigator:{ select: { id: true, name: true, email: true } },
        evidence: {
          where: { deletedAt: null },
          include: {
            uploadedBy: { select: { name: true } },
            reviewedBy: { select: { name: true } }
          },
          orderBy: { uploadedAt: 'asc' }
        }
      }
    });

    if (!caseData) throw new NotFoundError('Case');

    const filename = `case-${caseData.caseNumber}-${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = await generateCaseSummaryPDF(caseData, req.user);
    doc.pipe(res);

    logger.info('Case summary PDF downloaded', { caseId, by: req.user.id });
  }
);

/**
 * @swagger
 * /api/v1/reports/evidence/{evidenceId}:
 *   get:
 *     summary: Generate Chain of Custody PDF
 *     description: Downloads a legal chain-of-custody document for a specific evidence item
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: evidenceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PDF file download
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       403:
 *         description: Admin or Supervisor only
 *       404:
 *         description: Evidence not found
 */
router.get('/evidence/:evidenceId',
  authenticate,
  authorize(ALLOWED),
  validateParam(uuidParam('evidenceId'), 'evidenceId'),
  async (req, res) => {
    const { evidenceId } = req.params;

    const evidence = await prisma.evidence.findFirst({
      where: { id: evidenceId, deletedAt: null },
      include: {
        case:       { select: { caseNumber: true, title: true } },
        uploadedBy: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } }
      }
    });

    if (!evidence) throw new NotFoundError('Evidence');

    // Get full chain of custody
    const custodyResult = await auditService.getEvidenceChainOfCustody(evidenceId);
    const auditLogs = custodyResult?.chainOfCustody || [];

    const filename = `custody-${evidenceId.slice(0, 8)}-${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = await generateChainOfCustodyPDF(
      { ...evidence, fileSize: evidence.fileSize.toString() },
      auditLogs,
      req.user
    );
    doc.pipe(res);

    logger.info('Chain of custody PDF downloaded', { evidenceId, by: req.user.id });
  }
);

module.exports = router;
