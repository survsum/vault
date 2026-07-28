/**
 * Audit Service
 * 
 * Handles chain of custody logging for all significant actions.
 * This is CRITICAL for forensic evidence systems - every action must be logged.
 * 
 * What gets logged:
 * - User authentication events
 * - Case operations (create, update, delete, assign)
 * - Evidence operations (upload, download, approve, reject, delete)
 * - User management operations
 * - System errors
 * 
 * Each log entry includes:
 * - WHO performed the action (user ID)
 * - WHAT action was performed
 * - WHAT entity was affected
 * - WHEN it happened (timestamp)
 * - WHERE the request came from (IP address)
 * - Additional context (details JSON)
 */

const { prisma } = require('../config/database');
const { logger, logAuditEvent } = require('../utils/logger');

/**
 * Create an audit log entry
 * 
 * @param {Object} params - Audit log parameters
 * @param {string} params.userId - ID of user performing action (null for system)
 * @param {string} params.action - Action type (from AuditAction enum)
 * @param {string} params.entity - Entity type (from AuditEntity enum)
 * @param {string} params.entityId - ID of affected entity
 * @param {string} params.ipAddress - Client IP address
 * @param {string} params.userAgent - Client user agent
 * @param {Object} params.details - Additional context
 * @returns {Promise<Object>} Created audit log
 */
async function createAuditLog({
  userId = null,
  action,
  entity,
  entityId = null,
  ipAddress = null,
  userAgent = null,
  details = null
}) {
  try {
    const auditLog = await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        ipAddress,
        userAgent,
        details
      }
    });

    // Also log to file for backup
    logAuditEvent({
      userId,
      action,
      entity,
      entityId,
      ipAddress,
      details
    });

    return auditLog;
  } catch (error) {
    // Audit logging should never fail silently
    logger.error('Failed to create audit log', {
      error: error.message,
      action,
      entity,
      entityId
    });
    
    // Don't throw - we don't want audit failures to break the main operation
    // But in a production system, you might want to alert on this
    return null;
  }
}

/**
 * Log a login event
 */
async function logLogin(userId, ipAddress, userAgent, success = true) {
  return createAuditLog({
    userId,
    action: success ? 'LOGIN' : 'LOGIN_FAILED',
    entity: 'SESSION',
    ipAddress,
    userAgent,
    details: { success }
  });
}

/**
 * Log a logout event
 */
async function logLogout(userId, ipAddress) {
  return createAuditLog({
    userId,
    action: 'LOGOUT',
    entity: 'SESSION',
    ipAddress
  });
}

/**
 * Log user creation
 */
async function logUserCreated(creatorId, newUser, ipAddress) {
  return createAuditLog({
    userId: creatorId,
    action: 'USER_CREATED',
    entity: 'USER',
    entityId: newUser.id,
    ipAddress,
    details: {
      email: newUser.email,
      name: newUser.name,
      role: newUser.role
    }
  });
}

/**
 * Log user update
 */
async function logUserUpdated(updaterId, userId, changes, ipAddress) {
  return createAuditLog({
    userId: updaterId,
    action: 'USER_UPDATED',
    entity: 'USER',
    entityId: userId,
    ipAddress,
    details: { changes }
  });
}

/**
 * Log user deletion
 * @param {string} deleterId - ID of admin performing deletion
 * @param {Object} deletedUser - The deleted user object
 * @param {string} ipAddress - Client IP
 */
async function logUserDeleted(deleterId, deletedUser, ipAddress) {
  return createAuditLog({
    userId: deleterId,
    action: 'USER_DELETED',
    entity: 'USER',
    entityId: deletedUser.id,
    ipAddress,
    details: { 
      deletedUserEmail: deletedUser.email,
      deletedUserName: deletedUser.name,
      deletedUserRole: deletedUser.role
    }
  });
}

/**
 * Log password change
 * @param {string} userId - ID of user whose password changed
 * @param {string} ipAddress - Client IP
 * @param {string} changedByUserId - ID of user who changed it (null if self)
 */
async function logPasswordChanged(userId, ipAddress, changedByUserId = null) {
  return createAuditLog({
    userId: changedByUserId || userId,
    action: 'PASSWORD_CHANGED',
    entity: 'USER',
    entityId: userId,
    ipAddress,
    details: {
      changedBySelf: !changedByUserId || changedByUserId === userId,
      changedByAdmin: changedByUserId && changedByUserId !== userId
    }
  });
}

/**
 * Log case creation
 */
async function logCaseCreated(userId, caseData, ipAddress) {
  return createAuditLog({
    userId,
    action: 'CASE_CREATED',
    entity: 'CASE',
    entityId: caseData.id,
    ipAddress,
    details: {
      caseNumber: caseData.caseNumber,
      title: caseData.title
    }
  });
}

/**
 * Log case update
 */
async function logCaseUpdated(userId, caseId, changes, ipAddress) {
  return createAuditLog({
    userId,
    action: 'CASE_UPDATED',
    entity: 'CASE',
    entityId: caseId,
    ipAddress,
    details: { changes }
  });
}

/**
 * Log case assignment
 */
async function logCaseAssigned(userId, caseId, assigneeId, assigneeEmail, ipAddress) {
  return createAuditLog({
    userId,
    action: 'CASE_ASSIGNED',
    entity: 'CASE',
    entityId: caseId,
    ipAddress,
    details: {
      assignedToId: assigneeId,
      assignedToEmail: assigneeEmail
    }
  });
}

/**
 * Log case closed
 */
async function logCaseClosed(userId, caseId, caseNumber, ipAddress) {
  return createAuditLog({
    userId,
    action: 'CASE_CLOSED',
    entity: 'CASE',
    entityId: caseId,
    ipAddress,
    details: { caseNumber }
  });
}

/**
 * Log evidence upload
 */
async function logEvidenceUploaded(userId, evidence, ipAddress) {
  return createAuditLog({
    userId,
    action: 'EVIDENCE_UPLOADED',
    entity: 'EVIDENCE',
    entityId: evidence.id,
    ipAddress,
    details: {
      originalName: evidence.originalName,
      fileType: evidence.fileType,
      fileSize: evidence.fileSize.toString(),
      sha256Hash: evidence.sha256Hash,
      caseId: evidence.caseId
    }
  });
}

/**
 * Log evidence download
 */
async function logEvidenceDownloaded(userId, evidenceId, sha256Hash, ipAddress) {
  return createAuditLog({
    userId,
    action: 'EVIDENCE_DOWNLOADED',
    entity: 'EVIDENCE',
    entityId: evidenceId,
    ipAddress,
    details: { sha256Hash }
  });
}

/**
 * Log evidence approval
 */
async function logEvidenceApproved(userId, evidenceId, ipAddress) {
  return createAuditLog({
    userId,
    action: 'EVIDENCE_APPROVED',
    entity: 'EVIDENCE',
    entityId: evidenceId,
    ipAddress
  });
}

/**
 * Log evidence rejection
 */
async function logEvidenceRejected(userId, evidenceId, reason, ipAddress) {
  return createAuditLog({
    userId,
    action: 'EVIDENCE_REJECTED',
    entity: 'EVIDENCE',
    entityId: evidenceId,
    ipAddress,
    details: { reason }
  });
}

/**
 * Log evidence deletion
 */
async function logEvidenceDeleted(userId, evidenceId, originalName, ipAddress) {
  return createAuditLog({
    userId,
    action: 'EVIDENCE_DELETED',
    entity: 'EVIDENCE',
    entityId: evidenceId,
    ipAddress,
    details: { originalName }
  });
}

/**
 * Log evidence integrity check
 */
async function logEvidenceIntegrityCheck(userId, evidenceId, passed, ipAddress) {
  return createAuditLog({
    userId,
    action: passed ? 'EVIDENCE_INTEGRITY_CHECK' : 'EVIDENCE_INTEGRITY_FAILED',
    entity: 'EVIDENCE',
    entityId: evidenceId,
    ipAddress,
    details: { integrityPassed: passed }
  });
}

/**
 * Log system error
 */
async function logSystemError(error, context = {}) {
  return createAuditLog({
    userId: null,
    action: 'SYSTEM_ERROR',
    entity: 'SYSTEM',
    details: {
      error: error.message,
      stack: error.stack,
      ...context
    }
  });
}

// =============================================================================
// READ / QUERY FUNCTIONS
// =============================================================================

/**
 * Get audit logs with filtering and pagination
 *
 * @param {Object} options - From validated query params
 * @returns {{ logs, pagination }}
 */
async function getAuditLogs({
  userId,
  action,
  entity,
  entityId,
  startDate,
  endDate,
  page = 1,
  limit = 50,
  sortOrder = 'desc'
}) {
  const pageNum = typeof page === 'string' ? parseInt(page, 10) : Number(page);
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);

  const where = {};
  if (userId)   where.userId   = userId;
  if (action)   where.action   = action;
  if (entity)   where.entity   = entity;
  if (entityId) where.entityId = entityId;

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate)   where.timestamp.lte = new Date(endDate);
  }

  const skip = (pageNum - 1) * limitNum;

  const [logs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } }
      },
      orderBy: { timestamp: sortOrder },
      skip,
      take: limitNum
    }),
    prisma.auditLog.count({ where })
  ]);

  return {
    logs,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      totalCount,
      limit: limitNum,
      hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
      hasPrevPage: pageNum > 1
    }
  };
}

/**
 * Get chain of custody for specific evidence item
 * Returns logs in chronological order (oldest first) for legal review
 *
 * @param {string} evidenceId
 * @returns {Promise<Array>} Ordered log entries
 */
async function getEvidenceChainOfCustody(evidenceId) {
  // Verify the evidence exists first
  const evidence = await prisma.evidence.findUnique({
    where: { id: evidenceId },
    select: {
      id: true,
      originalName: true,
      sha256Hash: true,
      fileType: true,
      fileSize: true,
      status: true,
      uploadedAt: true,
      caseId: true,
      case: { select: { caseNumber: true, title: true } }
    }
  });

  if (!evidence) return null;

  const logs = await prisma.auditLog.findMany({
    where: { entity: 'EVIDENCE', entityId: evidenceId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } }
    },
    orderBy: { timestamp: 'asc' }
  });

  return {
    evidence: {
      ...evidence,
      fileSize: evidence.fileSize.toString()
    },
    chainOfCustody: logs,
    totalEvents: logs.length
  };
}

/**
 * Get all audit logs for a case (case events + all its evidence events)
 * Sorted chronologically — this is the full chain of custody for a case
 *
 * @param {string} caseId
 * @returns {Promise<Object>}
 */
async function getCaseAuditTrail(caseId) {
  // Verify case exists
  const caseData = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      caseNumber: true,
      title: true,
      status: true,
      createdAt: true,
      closedAt: true
    }
  });

  if (!caseData) return null;

  // Collect all evidence IDs in this case (including deleted — full history)
  const evidenceList = await prisma.evidence.findMany({
    where: { caseId },
    select: { id: true, originalName: true }
  });

  const evidenceIds = evidenceList.map(e => e.id);

  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entity: 'CASE',     entityId: caseId },
        { entity: 'EVIDENCE', entityId: { in: evidenceIds } }
      ]
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } }
    },
    orderBy: { timestamp: 'asc' }
  });

  return {
    case: caseData,
    evidenceItems: evidenceList,
    auditTrail: logs,
    totalEvents: logs.length
  };
}

/**
 * Get audit history for a specific user
 *
 * @param {string} targetUserId
 * @param {{ page, limit, sortOrder }} options
 */
async function getUserAuditHistory(targetUserId, { page = 1, limit = 50, sortOrder = 'desc' } = {}) {
  const pageNum = typeof page === 'string' ? parseInt(page, 10) : Number(page);
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);

  const where = { userId: targetUserId };
  const skip = (pageNum - 1) * limitNum;

  const [logs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } }
      },
      orderBy: { timestamp: sortOrder },
      skip,
      take: limitNum
    }),
    prisma.auditLog.count({ where })
  ]);

  return {
    logs,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      totalCount,
      limit: limitNum,
      hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
      hasPrevPage: pageNum > 1
    }
  };
}

/**
 * Get audit statistics — summary counts useful for the dashboard
 */
async function getAuditStatistics() {
  const [
    totalLogs,
    logsToday,
    actionCounts,
    recentActivity
  ] = await Promise.all([
    // Total log entries ever
    prisma.auditLog.count(),

    // Logs from the last 24 hours
    prisma.auditLog.count({
      where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    }),

    // Count by action type
    prisma.auditLog.groupBy({
      by: ['action'],
      _count: true,
      orderBy: { _count: { action: 'desc' } }
    }),

    // Most recent 10 entries
    prisma.auditLog.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { timestamp: 'desc' },
      take: 10
    })
  ]);

  return {
    totalLogs,
    logsToday,
    byAction: actionCounts.reduce((acc, a) => {
      acc[a.action] = a._count;
      return acc;
    }, {}),
    recentActivity
  };
}

// =============================================================================
// CSV EXPORT
// =============================================================================

/**
 * Escape a CSV field — wrap in quotes and escape internal quotes
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Build a CSV row from an audit log entry
 */
function logToCsvRow(log) {
  const fields = [
    log.id,
    log.timestamp ? new Date(log.timestamp).toISOString() : '',
    log.action,
    log.entity,
    log.entityId || '',
    log.user ? log.user.name  : 'System',
    log.user ? log.user.email : '',
    log.user ? log.user.role  : '',
    log.ipAddress || '',
    log.details ? JSON.stringify(log.details) : ''
  ];
  return fields.map(escapeCsvField).join(',');
}

/**
 * Export audit logs as a CSV string
 *
 * @param {Object} filters - Same filter options as getAuditLogs, plus optional caseId
 * @returns {Promise<string>} CSV content
 */
async function exportAuditLogsCsv(filters = {}) {
  const { caseId, userId, action, entity, startDate, endDate } = filters;

  let where = {};

  // If scoped to a case, pull case events + all evidence events for that case
  if (caseId) {
    const evidenceList = await prisma.evidence.findMany({
      where: { caseId },
      select: { id: true }
    });
    const evidenceIds = evidenceList.map(e => e.id);

    where.OR = [
      { entity: 'CASE',     entityId: caseId },
      { entity: 'EVIDENCE', entityId: { in: evidenceIds } }
    ];
  }

  if (userId)   where.userId   = userId;
  if (action)   where.action   = action;
  if (entity)   where.entity   = entity;

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate)   where.timestamp.lte = new Date(endDate);
  }

  // Fetch all matching logs (no pagination — this is a full export)
  const logs = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { timestamp: 'asc' }
  });

  const header = [
    'ID', 'Timestamp', 'Action', 'Entity', 'Entity ID',
    'User Name', 'User Email', 'User Role', 'IP Address', 'Details'
  ].map(escapeCsvField).join(',');

  const rows = logs.map(logToCsvRow);

  return [header, ...rows].join('\n');
}

module.exports = {
  createAuditLog,
  logLogin,
  logLogout,
  logUserCreated,
  logUserUpdated,
  logUserDeleted,
  logPasswordChanged,
  logCaseCreated,
  logCaseUpdated,
  logCaseAssigned,
  logCaseClosed,
  logEvidenceUploaded,
  logEvidenceDownloaded,
  logEvidenceApproved,
  logEvidenceRejected,
  logEvidenceDeleted,
  logEvidenceIntegrityCheck,
  logSystemError,
  // Read / query
  getAuditLogs,
  getEvidenceChainOfCustody,
  getCaseAuditTrail,
  getUserAuditHistory,
  getAuditStatistics,
  // Export
  exportAuditLogsCsv
};
