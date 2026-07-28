/**
 * Evidence Service
 * 
 * Core business logic for evidence management:
 * - Upload evidence (file + metadata + SHA-256 hash)
 * - Download with integrity check
 * - Approve / reject workflow
 * - Soft delete
 * - Listing with role-based access control
 */

const path = require('path');
const fs = require('fs');
const { prisma } = require('../config/database');
const {
  NotFoundError,
  AuthorizationError,
  ValidationError,
  IntegrityError,
  ConflictError
} = require('../middleware/error.middleware');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');
const emailService = require('../utils/email.util');
const {
  computeFileHash,
  verifyFileIntegrity,
  deleteFile,
  fileExists,
  formatFileSize
} = require('../utils/file.util');
const { logger } = require('../utils/logger');

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if the current user can access evidence for a given case.
 * Rules mirror the case access rules:
 *   ADMIN / SUPERVISOR → full access
 *   INVESTIGATOR      → only their assigned case
 */
async function canAccessEvidence(user, evidenceOrCaseId) {
  if (user.role === 'ADMIN' || user.role === 'SUPERVISOR') return true;

  // For investigators, look up the case assignment
  const caseId = typeof evidenceOrCaseId === 'string'
    ? evidenceOrCaseId
    : evidenceOrCaseId.caseId;

  const caseData = await prisma.case.findUnique({
    where: { id: caseId },
    select: { assignedInvestigatorId: true }
  });

  return caseData?.assignedInvestigatorId === user.id;
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List evidence with pagination and filters
 *
 * @param {Object} options  - Query options from validated query params
 * @param {Object} user     - Current authenticated user
 */
async function getEvidence(options = {}, user) {
  const {
    page = 1,
    limit = 10,
    caseId,
    status,
    uploadedBy,
    fileType,
    sortBy = 'uploadedAt',
    sortOrder = 'desc'
  } = options;

  const pageNum = typeof page === 'string' ? parseInt(page, 10) : Number(page);
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);
  const skip = (pageNum - 1) * limitNum;

  const where = { deletedAt: null };

  // Investigators can only see evidence in their assigned cases
  if (user.role === 'INVESTIGATOR') {
    const assignedCases = await prisma.case.findMany({
      where: { assignedInvestigatorId: user.id, deletedAt: null },
      select: { id: true }
    });
    const assignedCaseIds = assignedCases.map(c => c.id);
    where.caseId = { in: assignedCaseIds };
  }

  if (caseId) where.caseId = caseId;
  if (status) where.status = status;
  if (uploadedBy) where.uploadedById = uploadedBy;
  if (fileType) where.fileType = { contains: fileType, mode: 'insensitive' };

  const [evidence, totalCount] = await Promise.all([
    prisma.evidence.findMany({
      where,
      select: {
        id: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        sha256Hash: true,
        status: true,
        description: true,
        rejectReason: true,
        uploadedAt: true,
        updatedAt: true,
        caseId: true,
        case: {
          select: {
            caseNumber: true,
            title: true
          }
        },
        uploadedBy: {
          select: { id: true, name: true, email: true }
        },
        reviewedBy: {
          select: { id: true, name: true, email: true }
        },
        reviewedAt: true
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limitNum
    }),
    prisma.evidence.count({ where })
  ]);

  // Convert BigInt fileSize to string for JSON serialisation
  const formatted = evidence.map(e => ({
    ...e,
    fileSize: e.fileSize.toString(),
    fileSizeFormatted: formatFileSize(e.fileSize)
  }));

  return {
    evidence: formatted,
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
 * Get a single evidence item by ID
 */
async function getEvidenceById(evidenceId, user) {
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null },
    include: {
      case: {
        select: {
          id: true,
          caseNumber: true,
          title: true,
          assignedInvestigatorId: true
        }
      },
      uploadedBy: {
        select: { id: true, name: true, email: true, role: true }
      },
      reviewedBy: {
        select: { id: true, name: true, email: true, role: true }
      }
    }
  });

  if (!evidence) throw new NotFoundError('Evidence');

  // Access check
  if (!(await canAccessEvidence(user, evidence))) {
    throw new AuthorizationError('You do not have access to this evidence');
  }

  return {
    ...evidence,
    fileSize: evidence.fileSize.toString(),
    fileSizeFormatted: formatFileSize(evidence.fileSize)
  };
}

// =============================================================================
// UPLOAD
// =============================================================================

/**
 * Save uploaded evidence to the database
 *
 * Called AFTER multer has written the file to disk (req.file is populated).
 *
 * @param {Object} fileInfo     - From req.file (multer)
 * @param {Object} body         - Validated request body { caseId, description }
 * @param {Object} context      - { uploaderId, ipAddress }
 */
async function uploadEvidence(fileInfo, body, context) {
  const { caseId, description } = body;
  const { uploaderId, ipAddress } = context;

  // 1. Verify the case exists and user can upload to it
  const caseData = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      assignedInvestigatorId: true
    }
  });

  if (!caseData || caseData.deletedAt) throw new NotFoundError('Case');

  if (caseData.status === 'CLOSED' || caseData.status === 'ARCHIVED') {
    // Clean up the uploaded file before throwing
    await deleteFile(fileInfo.path).catch(() => {});
    throw new ValidationError(
      `Evidence cannot be added to a ${caseData.status.toLowerCase()} case`
    );
  }

  // Investigators can only upload to their assigned case
  const uploader = await prisma.user.findUnique({
    where: { id: uploaderId },
    select: { role: true }
  });

  if (
    uploader?.role === 'INVESTIGATOR' &&
    caseData.assignedInvestigatorId !== uploaderId
  ) {
    await deleteFile(fileInfo.path).catch(() => {});
    throw new AuthorizationError('You can only upload evidence to your assigned case');
  }

  // 2. Compute SHA-256 hash of the stored file
  const sha256Hash = await computeFileHash(fileInfo.path);

  // 3. Build relative storage path for portability
  const storagePath = path.relative(process.cwd(), fileInfo.path);

  // 4. Create evidence record in DB
  const evidence = await prisma.evidence.create({
    data: {
      fileName: fileInfo.filename,
      originalName: fileInfo.originalname,
      fileType: fileInfo.mimetype,
      fileSize: BigInt(fileInfo.size),
      storagePath,
      sha256Hash,
      description,
      status: 'PENDING',
      caseId,
      uploadedById: uploaderId
    },
    include: {
      case: { select: { caseNumber: true, title: true } },
      uploadedBy: { select: { id: true, name: true, email: true } }
    }
  });

  // 5. Audit log
  await auditService.logEvidenceUploaded(uploaderId, {
    id: evidence.id,
    originalName: evidence.originalName,
    fileType: evidence.fileType,
    fileSize: evidence.fileSize,
    sha256Hash: evidence.sha256Hash,
    caseId
  }, ipAddress);

  // Notify supervisors/admins that new evidence needs review
  await notificationService.notifyEvidenceUploaded(
    { id: evidence.id, originalName: evidence.originalName },
    evidence.uploadedBy.name
  );

  // Email notification (fire-and-forget)
  const supervisors = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPERVISOR'] }, deletedAt: null },
    select: { email: true }
  });
  const caseInfo = await prisma.case.findUnique({
    where: { id: caseId }, select: { caseNumber: true }
  });
  for (const sup of supervisors) {
    emailService.sendEvidenceUploadedEmail({
      to: sup.email,
      uploaderName: evidence.uploadedBy.name,
      evidenceName: evidence.originalName,
      caseNumber: caseInfo?.caseNumber || caseId,
      evidenceId: evidence.id
    }).catch(() => {});  // fire-and-forget
  }

  logger.info('Evidence uploaded', {
    evidenceId: evidence.id,
    caseId,
    uploadedBy: uploaderId,
    fileName: evidence.originalName,
    sha256Hash
  });

  return {
    ...evidence,
    fileSize: evidence.fileSize.toString(),
    fileSizeFormatted: formatFileSize(evidence.fileSize)
  };
}

// =============================================================================
// DOWNLOAD
// =============================================================================

/**
 * Prepare evidence for download
 *
 * 1. Verify user has access
 * 2. Re-compute SHA-256 and compare with stored hash
 * 3. Return the absolute file path + metadata for streaming
 *
 * @param {string} evidenceId
 * @param {Object} user
 * @param {string} ipAddress
 * @returns {{ evidence, absolutePath }} - Caller streams the file
 */
async function prepareDownload(evidenceId, user, ipAddress) {
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null },
    include: {
      case: { select: { assignedInvestigatorId: true, caseNumber: true } }
    }
  });

  if (!evidence) throw new NotFoundError('Evidence');

  if (!(await canAccessEvidence(user, evidence))) {
    throw new AuthorizationError('You do not have access to this evidence');
  }

  // Resolve absolute path
  const absolutePath = path.resolve(process.cwd(), evidence.storagePath);

  if (!fileExists(absolutePath)) {
    logger.error('Evidence file missing from disk', {
      evidenceId,
      storagePath: evidence.storagePath
    });
    throw new NotFoundError('Evidence file not found on disk');
  }

  // Integrity check — re-hash the file every download
  const isIntact = await verifyFileIntegrity(absolutePath, evidence.sha256Hash);

  // Audit log regardless of outcome
  await auditService.logEvidenceDownloaded(user.id, evidenceId, evidence.sha256Hash, ipAddress);
  await auditService.logEvidenceIntegrityCheck(user.id, evidenceId, isIntact, ipAddress);

  if (!isIntact) {
    logger.error('Evidence integrity check FAILED on download', {
      evidenceId,
      storagePath: evidence.storagePath
    });
    throw new IntegrityError(
      'Evidence file integrity check failed — the file may have been tampered with'
    );
  }

  logger.info('Evidence download prepared', {
    evidenceId,
    downloadedBy: user.id,
    caseNumber: evidence.case?.caseNumber
  });

  return {
    evidence: {
      ...evidence,
      fileSize: evidence.fileSize.toString()
    },
    absolutePath
  };
}

// =============================================================================
// REVIEW WORKFLOW
// =============================================================================

/**
 * Approve pending evidence
 */
async function approveEvidence(evidenceId, user, ipAddress) {
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null }
  });

  if (!evidence) throw new NotFoundError('Evidence');

  if (evidence.status !== 'PENDING') {
    throw new ConflictError(`Evidence is already ${evidence.status.toLowerCase()}`);
  }

  const updated = await prisma.evidence.update({
    where: { id: evidenceId },
    data: {
      status: 'APPROVED',
      reviewedById: user.id,
      reviewedAt: new Date()
    },
    include: {
      uploadedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } }
    }
  });

  await auditService.logEvidenceApproved(user.id, evidenceId, ipAddress);

  // Notify the uploader
  await notificationService.notifyEvidenceApproved(
    { id: evidenceId, originalName: evidence.originalName, uploadedById: evidence.uploadedById },
    user.name
  );

  // Email the uploader
  const uploader = await prisma.user.findUnique({
    where: { id: evidence.uploadedById },
    select: { email: true, name: true }
  });
  const caseInfo = await prisma.case.findUnique({
    where: { id: evidence.caseId }, select: { caseNumber: true }
  });
  if (uploader) {
    emailService.sendEvidenceApprovedEmail({
      to: uploader.email,
      recipientName: uploader.name,
      evidenceName: evidence.originalName,
      reviewerName: user.name,
      caseNumber: caseInfo?.caseNumber || evidence.caseId
    }).catch(() => {});
  }

  logger.info('Evidence approved', { evidenceId, approvedBy: user.id });

  return {
    ...updated,
    fileSize: updated.fileSize.toString()
  };
}

/**
 * Reject pending evidence with a mandatory reason
 */
async function rejectEvidence(evidenceId, reason, user, ipAddress) {
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null }
  });

  if (!evidence) throw new NotFoundError('Evidence');

  if (evidence.status !== 'PENDING') {
    throw new ConflictError(`Evidence is already ${evidence.status.toLowerCase()}`);
  }

  const updated = await prisma.evidence.update({
    where: { id: evidenceId },
    data: {
      status: 'REJECTED',
      rejectReason: reason,
      reviewedById: user.id,
      reviewedAt: new Date()
    },
    include: {
      uploadedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } }
    }
  });

  await auditService.logEvidenceRejected(user.id, evidenceId, reason, ipAddress);

  // Notify the uploader
  await notificationService.notifyEvidenceRejected(
    { id: evidenceId, originalName: evidence.originalName, uploadedById: evidence.uploadedById },
    user.name,
    reason
  );

  // Email the uploader
  const uploader = await prisma.user.findUnique({
    where: { id: evidence.uploadedById },
    select: { email: true, name: true }
  });
  const caseInfo = await prisma.case.findUnique({
    where: { id: evidence.caseId }, select: { caseNumber: true }
  });
  if (uploader) {
    emailService.sendEvidenceRejectedEmail({
      to: uploader.email,
      recipientName: uploader.name,
      evidenceName: evidence.originalName,
      reviewerName: user.name,
      reason,
      caseNumber: caseInfo?.caseNumber || evidence.caseId
    }).catch(() => {});
  }

  logger.info('Evidence rejected', { evidenceId, rejectedBy: user.id, reason });

  return {
    ...updated,
    fileSize: updated.fileSize.toString()
  };
}

// =============================================================================
// DELETE
// =============================================================================

/**
 * Soft-delete evidence (Admin only)
 * The file on disk is NOT removed so the audit trail stays intact.
 */
async function deleteEvidence(evidenceId, context) {
  const { adminId, ipAddress } = context;

  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null }
  });

  if (!evidence) throw new NotFoundError('Evidence');

  const deleted = await prisma.evidence.update({
    where: { id: evidenceId },
    data: {
      deletedAt: new Date(),
      deletedById: adminId
    },
    select: {
      id: true,
      originalName: true,
      caseId: true,
      deletedAt: true
    }
  });

  await auditService.logEvidenceDeleted(adminId, evidenceId, evidence.originalName, ipAddress);

  logger.info('Evidence soft-deleted', {
    evidenceId,
    originalName: evidence.originalName,
    deletedBy: adminId
  });

  return deleted;
}

// =============================================================================
// INTEGRITY CHECK (on-demand)
// =============================================================================

/**
 * Run an integrity check on a specific evidence item without downloading
 */
async function verifyEvidence(evidenceId, user, ipAddress) {
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, deletedAt: null },
    include: {
      case: { select: { assignedInvestigatorId: true } }
    }
  });

  if (!evidence) throw new NotFoundError('Evidence');

  if (!(await canAccessEvidence(user, evidence))) {
    throw new AuthorizationError('You do not have access to this evidence');
  }

  const absolutePath = path.resolve(process.cwd(), evidence.storagePath);

  if (!fileExists(absolutePath)) {
    await auditService.logEvidenceIntegrityCheck(user.id, evidenceId, false, ipAddress);
    return { intact: false, reason: 'File not found on disk' };
  }

  const currentHash = await computeFileHash(absolutePath);
  const intact = currentHash === evidence.sha256Hash;

  await auditService.logEvidenceIntegrityCheck(user.id, evidenceId, intact, ipAddress);

  return {
    intact,
    storedHash: evidence.sha256Hash,
    currentHash,
    reason: intact ? 'Integrity verified' : 'Hash mismatch — file may be tampered'
  };
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Evidence statistics (scoped to user's accessible cases)
 */
async function getEvidenceStatistics(user) {
  const baseWhere = { deletedAt: null };

  if (user.role === 'INVESTIGATOR') {
    const assignedCases = await prisma.case.findMany({
      where: { assignedInvestigatorId: user.id, deletedAt: null },
      select: { id: true }
    });
    baseWhere.caseId = { in: assignedCases.map(c => c.id) };
  }

  const [total, byStatus, byType, recent] = await Promise.all([
    prisma.evidence.count({ where: baseWhere }),
    prisma.evidence.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: true
    }),
    prisma.evidence.groupBy({
      by: ['fileType'],
      where: baseWhere,
      _count: true,
      orderBy: { _count: { fileType: 'desc' } },
      take: 10
    }),
    prisma.evidence.findMany({
      where: baseWhere,
      select: {
        id: true,
        originalName: true,
        fileType: true,
        status: true,
        uploadedAt: true,
        case: { select: { caseNumber: true } }
      },
      orderBy: { uploadedAt: 'desc' },
      take: 5
    })
  ]);

  return {
    total,
    byStatus: byStatus.reduce((acc, s) => {
      acc[s.status.toLowerCase()] = s._count;
      return acc;
    }, {}),
    byFileType: byType.map(t => ({ fileType: t.fileType, count: t._count })),
    recentUploads: recent
  };
}

module.exports = {
  getEvidence,
  getEvidenceById,
  uploadEvidence,
  prepareDownload,
  approveEvidence,
  rejectEvidence,
  deleteEvidence,
  verifyEvidence,
  getEvidenceStatistics
};
