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

/**
 * Get audit logs with filtering and pagination
 */
async function getAuditLogs({
  userId,
  action,
  entity,
  entityId,
  startDate,
  endDate,
  page = 1,
  limit = 50
}) {
  const where = {};

  if (userId) where.userId = userId;
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (entityId) where.entityId = entityId;
  
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
  }

  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit
    }),
    prisma.auditLog.count({ where })
  ]);

  return { logs, total };
}

/**
 * Get chain of custody for specific evidence
 */
async function getEvidenceChainOfCustody(evidenceId) {
  return prisma.auditLog.findMany({
    where: {
      entity: 'EVIDENCE',
      entityId: evidenceId
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    },
    orderBy: { timestamp: 'asc' }
  });
}

/**
 * Get all audit logs for a case (including its evidence)
 */
async function getCaseAuditTrail(caseId) {
  // First, get all evidence IDs for this case
  const evidence = await prisma.evidence.findMany({
    where: { caseId },
    select: { id: true }
  });
  
  const evidenceIds = evidence.map(e => e.id);

  return prisma.auditLog.findMany({
    where: {
      OR: [
        { entity: 'CASE', entityId: caseId },
        { entity: 'EVIDENCE', entityId: { in: evidenceIds } }
      ]
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    },
    orderBy: { timestamp: 'asc' }
  });
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
  getAuditLogs,
  getEvidenceChainOfCustody,
  getCaseAuditTrail
};
