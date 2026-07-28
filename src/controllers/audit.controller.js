/**
 * Audit Log Controller
 *
 * Thin HTTP layer for audit log read operations.
 * All write operations are handled internally by auditService.
 */

const auditService = require('../services/audit.service');
const { NotFoundError } = require('../middleware/error.middleware');
const { logger } = require('../utils/logger');

/**
 * GET /api/v1/audit
 * Paginated list of audit logs with optional filters
 */
async function getAuditLogs(req, res) {
  const result = await auditService.getAuditLogs(req.query);

  res.json({
    success: true,
    message: 'Audit logs retrieved successfully',
    data: result.logs,
    pagination: result.pagination
  });
}

/**
 * GET /api/v1/audit/statistics
 * Summary counts for dashboard
 */
async function getStatistics(req, res) {
  const stats = await auditService.getAuditStatistics();

  res.json({
    success: true,
    message: 'Audit statistics retrieved successfully',
    data: stats
  });
}

/**
 * GET /api/v1/audit/evidence/:evidenceId
 * Chain of custody for a specific evidence item
 */
async function getEvidenceChainOfCustody(req, res) {
  const { evidenceId } = req.params;

  const result = await auditService.getEvidenceChainOfCustody(evidenceId);

  if (!result) throw new NotFoundError('Evidence');

  res.json({
    success: true,
    message: 'Evidence chain of custody retrieved successfully',
    data: result
  });
}

/**
 * GET /api/v1/audit/case/:caseId
 * Full audit trail for a case (case events + all evidence events)
 */
async function getCaseAuditTrail(req, res) {
  const { caseId } = req.params;

  const result = await auditService.getCaseAuditTrail(caseId);

  if (!result) throw new NotFoundError('Case');

  res.json({
    success: true,
    message: 'Case audit trail retrieved successfully',
    data: result
  });
}

/**
 * GET /api/v1/audit/user/:userId
 * All actions performed by a specific user
 */
async function getUserAuditHistory(req, res) {
  const { userId } = req.params;

  const result = await auditService.getUserAuditHistory(userId, req.query);

  res.json({
    success: true,
    message: 'User audit history retrieved successfully',
    data: result.logs,
    pagination: result.pagination
  });
}

/**
 * GET /api/v1/audit/export
 * Download audit logs as CSV — for legal submissions
 */
async function exportAuditLogs(req, res) {
  const filters = req.query; // already validated

  const csv = await auditService.exportAuditLogsCsv(filters);

  const filename = `audit-export-${new Date().toISOString().split('T')[0]}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Add BOM so Excel opens UTF-8 correctly
  res.send('\uFEFF' + csv);

  logger.info('Audit log exported as CSV', {
    exportedBy: req.user.id,
    filters: JSON.stringify(filters)
  });
}

module.exports = {
  getAuditLogs,
  getStatistics,
  getEvidenceChainOfCustody,
  getCaseAuditTrail,
  getUserAuditHistory,
  exportAuditLogs
};
