/**
 * Evidence Controller
 *
 * Thin HTTP layer — extracts request data, calls the service, sends the response.
 * File streaming for downloads is handled here because it involves the
 * HTTP response object directly (res.sendFile / pipe).
 */

const fs = require('fs');
const path = require('path');
const evidenceService = require('../services/evidence.service');
const { logger } = require('../utils/logger');

/**
 * GET /api/v1/evidence
 * List evidence with pagination and filters
 */
async function getEvidence(req, res) {
  const result = await evidenceService.getEvidence(req.query, req.user);

  res.json({
    success: true,
    message: 'Evidence retrieved successfully',
    data: result.evidence,
    pagination: result.pagination
  });
}

/**
 * GET /api/v1/evidence/statistics
 */
async function getStatistics(req, res) {
  const stats = await evidenceService.getEvidenceStatistics(req.user);

  res.json({
    success: true,
    message: 'Evidence statistics retrieved successfully',
    data: stats
  });
}

/**
 * GET /api/v1/evidence/:id
 * Get evidence details
 */
async function getEvidenceById(req, res) {
  const evidence = await evidenceService.getEvidenceById(req.params.id, req.user);

  res.json({
    success: true,
    message: 'Evidence retrieved successfully',
    data: evidence
  });
}

/**
 * POST /api/v1/evidence/upload
 * Upload a file as evidence
 * req.file is populated by the handleUpload middleware
 */
async function uploadEvidence(req, res) {
  const context = {
    uploaderId: req.user.id,
    ipAddress: req.ip
  };

  const evidence = await evidenceService.uploadEvidence(req.file, req.body, context);

  res.status(201).json({
    success: true,
    message: 'Evidence uploaded successfully. Awaiting supervisor review.',
    data: evidence
  });
}

/**
 * GET /api/v1/evidence/:id/download
 * Stream the evidence file to the client after integrity verification
 */
async function downloadEvidence(req, res) {
  const { absolutePath, evidence } = await evidenceService.prepareDownload(
    req.params.id,
    req.user,
    req.ip
  );

  // Set download headers
  res.setHeader('Content-Type', evidence.fileType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(evidence.originalName)}"`
  );
  res.setHeader('X-SHA256-Hash', evidence.sha256Hash);
  res.setHeader('Content-Length', evidence.fileSize);

  // Stream the file — never loads the whole file into memory
  const readStream = fs.createReadStream(absolutePath);

  readStream.on('error', (err) => {
    logger.error('Stream error during evidence download', {
      evidenceId: req.params.id,
      error: err.message
    });
    // Headers already sent via setHeader; can't send a JSON error body now
    res.destroy(err);
  });

  readStream.pipe(res);
}

/**
 * GET /api/v1/evidence/:id/verify
 * On-demand integrity check (no download)
 */
async function verifyEvidence(req, res) {
  const result = await evidenceService.verifyEvidence(
    req.params.id,
    req.user,
    req.ip
  );

  res.json({
    success: true,
    message: result.intact ? 'Integrity verified' : 'Integrity check failed',
    data: result
  });
}

/**
 * PUT /api/v1/evidence/:id/approve
 * Supervisor approves pending evidence
 */
async function approveEvidence(req, res) {
  const evidence = await evidenceService.approveEvidence(
    req.params.id,
    req.user,
    req.ip
  );

  res.json({
    success: true,
    message: 'Evidence approved successfully',
    data: evidence
  });
}

/**
 * PUT /api/v1/evidence/:id/reject
 * Supervisor rejects pending evidence with a reason
 */
async function rejectEvidence(req, res) {
  const { reason } = req.body;

  const evidence = await evidenceService.rejectEvidence(
    req.params.id,
    reason,
    req.user,
    req.ip
  );

  res.json({
    success: true,
    message: 'Evidence rejected',
    data: evidence
  });
}

/**
 * DELETE /api/v1/evidence/:id
 * Soft delete (Admin only)
 */
async function deleteEvidence(req, res) {
  const context = {
    adminId: req.user.id,
    ipAddress: req.ip
  };

  const deleted = await evidenceService.deleteEvidence(req.params.id, context);

  res.json({
    success: true,
    message: 'Evidence deleted successfully',
    data: { id: deleted.id, deletedAt: deleted.deletedAt }
  });
}

/**
 * GET /api/v1/evidence/:id/qrcode
 * Return QR code PNG for evidence verification
 */
async function getEvidenceQRCode(req, res) {
  const { generateEvidenceQRCode } = require('../utils/qrcode.util');
  const evidenceService = require('../services/evidence.service');

  const evidence = await evidenceService.getEvidenceById(req.params.id, req.user);

  const qrBuffer = await generateEvidenceQRCode({
    id: evidence.id,
    sha256Hash: evidence.sha256Hash,
    originalName: evidence.originalName
  });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `inline; filename="evidence-${evidence.id}.png"`);
  res.send(qrBuffer);
}

module.exports = {
  getEvidence,
  getStatistics,
  getEvidenceById,
  uploadEvidence,
  downloadEvidence,
  verifyEvidence,
  approveEvidence,
  rejectEvidence,
  deleteEvidence,
  getEvidenceQRCode
};
