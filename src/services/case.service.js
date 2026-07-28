/**
 * Case Service
 * 
 * Business logic for case management operations.
 * 
 * Key Responsibilities:
 * - Case CRUD operations
 * - Case number generation
 * - Investigator assignment
 * - Status transitions
 * - Access control based on user role
 */

const { prisma } = require('../config/database');
const { 
  NotFoundError, 
  ConflictError,
  AuthorizationError,
  ValidationError
} = require('../middleware/error.middleware');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');
const { logger } = require('../utils/logger');

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a unique case number
 * Format: CASE-YYYY-NNNNN (e.g., CASE-2024-00001)
 * 
 * This uses the current year and a sequential number.
 * The sequence resets each year.
 */
async function generateCaseNumber() {
  const currentYear = new Date().getFullYear();
  const prefix = `CASE-${currentYear}-`;
  
  // Find the highest case number for this year
  const lastCase = await prisma.case.findFirst({
    where: {
      caseNumber: {
        startsWith: prefix
      }
    },
    orderBy: {
      caseNumber: 'desc'
    },
    select: {
      caseNumber: true
    }
  });

  let nextNumber = 1;
  
  if (lastCase) {
    // Extract the number part and increment
    const lastNumber = parseInt(lastCase.caseNumber.split('-')[2], 10);
    nextNumber = lastNumber + 1;
  }

  // Pad with zeros to 5 digits
  return `${prefix}${nextNumber.toString().padStart(5, '0')}`;
}

/**
 * Check if a user can access a specific case
 * 
 * Access rules:
 * - Admin: can access all cases
 * - Supervisor: can access all cases
 * - Investigator: can only access assigned cases
 */
function canAccessCase(user, caseData) {
  if (user.role === 'ADMIN' || user.role === 'SUPERVISOR') {
    return true;
  }
  
  // Investigators can only access their assigned cases
  return caseData.assignedInvestigatorId === user.id;
}

/**
 * Validate status transition
 * 
 * Valid transitions:
 * - OPEN → PENDING, CLOSED
 * - PENDING → OPEN, CLOSED
 * - CLOSED → OPEN (reopen), ARCHIVED
 * - ARCHIVED → (no transitions allowed)
 */
function isValidStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    OPEN: ['PENDING', 'CLOSED'],
    PENDING: ['OPEN', 'CLOSED'],
    CLOSED: ['OPEN', 'ARCHIVED'],
    ARCHIVED: [] // Archived cases cannot be changed
  };
  
  return validTransitions[currentStatus]?.includes(newStatus) ?? false;
}

// =============================================================================
// CASE QUERIES
// =============================================================================

/**
 * Get paginated list of cases
 * 
 * @param {Object} options - Query options
 * @param {Object} user - Current user (for access filtering)
 * @returns {Promise<Object>} { cases, pagination }
 */
async function getCases(options = {}, user) {
  const {
    page = 1,
    limit = 10,
    status,
    priority,
    assignedTo,
    createdBy,
    search,
    includeDeleted = false,
    createdAfter,
    createdBefore,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = options;

  // Calculate offset
  const pageNum = typeof page === 'string' ? parseInt(page, 10) : Number(page);
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  const where = {};

  // Soft delete filter
  if (!includeDeleted) {
    where.deletedAt = null;
  }

  // Role-based access control
  // Investigators can only see their assigned cases
  if (user.role === 'INVESTIGATOR') {
    where.assignedInvestigatorId = user.id;
  }

  // Status filter
  if (status) {
    where.status = status;
  }

  // Priority filter - ensure it's a number
  if (priority !== undefined && priority !== null) {
    const priorityNum = typeof priority === 'string' ? parseInt(priority, 10) : Number(priority);
    if (!Number.isNaN(priorityNum)) {
      where.priority = priorityNum;
    }
  }

  // Assigned investigator filter
  if (assignedTo) {
    where.assignedInvestigatorId = assignedTo;
  }

  // Created by filter
  if (createdBy) {
    where.createdById = createdBy;
  }

  // Search in title, description, or case number
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { caseNumber: { contains: search, mode: 'insensitive' } }
    ];
  }

  // Date range filter
  if (createdAfter || createdBefore) {
    where.createdAt = {};
    if (createdAfter) where.createdAt.gte = new Date(createdAfter);
    if (createdBefore) where.createdAt.lte = new Date(createdBefore);
  }

  // Execute query and count in parallel
  const [cases, totalCount] = await Promise.all([
    prisma.case.findMany({
      where,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
        deletedAt: true,
        assignedInvestigator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        _count: {
          select: {
            evidence: true
          }
        }
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limitNum
    }),
    prisma.case.count({ where })
  ]);

  // Flatten the evidence count
  const formattedCases = cases.map(c => ({
    ...c,
    evidenceCount: c._count.evidence,
    _count: undefined
  }));

  const totalPages = Math.ceil(totalCount / limitNum);

  return {
    cases: formattedCases,
    pagination: {
      currentPage: pageNum,
      totalPages,
      totalCount,
      limit: limitNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1
    }
  };
}

/**
 * Get a single case by ID
 * 
 * @param {string} caseId - Case ID
 * @param {Object} user - Current user (for access check)
 * @param {boolean} includeDeleted - Include soft-deleted cases
 * @returns {Promise<Object>} Case object with details
 */
async function getCaseById(caseId, user, includeDeleted = false) {
  const where = { id: caseId };
  
  if (!includeDeleted) {
    where.deletedAt = null;
  }

  const caseData = await prisma.case.findFirst({
    where,
    include: {
      assignedInvestigator: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      evidence: {
        where: { deletedAt: null },
        select: {
          id: true,
          originalName: true,
          fileType: true,
          fileSize: true,
          status: true,
          uploadedAt: true
        },
        orderBy: { uploadedAt: 'desc' },
        take: 10 // Limit to recent 10 evidence items
      },
      _count: {
        select: {
          evidence: {
            where: { deletedAt: null }
          }
        }
      }
    }
  });

  if (!caseData) {
    throw new NotFoundError('Case');
  }

  // Check access
  if (!canAccessCase(user, caseData)) {
    throw new AuthorizationError('You do not have access to this case');
  }

  return {
    ...caseData,
    totalEvidenceCount: caseData._count.evidence,
    _count: undefined
  };
}

/**
 * Get case by case number (alternative lookup)
 */
async function getCaseByCaseNumber(caseNumber, user) {
  const caseData = await prisma.case.findUnique({
    where: { caseNumber },
    include: {
      assignedInvestigator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  if (!caseData || caseData.deletedAt) {
    throw new NotFoundError('Case');
  }

  if (!canAccessCase(user, caseData)) {
    throw new AuthorizationError('You do not have access to this case');
  }

  return caseData;
}

// =============================================================================
// CASE MUTATIONS
// =============================================================================

/**
 * Create a new case
 * 
 * @param {Object} caseData - Case data
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Created case
 */
async function createCase(caseData, context) {
  const { title, description, priority, assignedInvestigatorId } = caseData;
  const { creatorId, ipAddress } = context;

  // Validate assigned investigator if provided
  if (assignedInvestigatorId) {
    const investigator = await prisma.user.findUnique({
      where: { id: assignedInvestigatorId },
      select: { id: true, role: true, deletedAt: true }
    });

    if (!investigator || investigator.deletedAt) {
      throw new NotFoundError('Investigator');
    }

    // Only investigators can be assigned to cases
    if (investigator.role !== 'INVESTIGATOR') {
      throw new ValidationError('Only users with INVESTIGATOR role can be assigned to cases');
    }
  }

  // Generate unique case number
  const caseNumber = await generateCaseNumber();

  // Create the case
  const newCase = await prisma.case.create({
    data: {
      caseNumber,
      title,
      description,
      priority: priority || 3,
      status: 'OPEN',
      createdById: creatorId,
      assignedInvestigatorId
    },
    include: {
      assignedInvestigator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  // Log the creation
  await auditService.logCaseCreated(creatorId, newCase, ipAddress);

  // If assigned, log the assignment
  if (assignedInvestigatorId) {
    await auditService.logCaseAssigned(
      creatorId,
      newCase.id,
      assignedInvestigatorId,
      newCase.assignedInvestigator?.email,
      ipAddress
    );
    // Notify the investigator
    const creator = await prisma.user.findUnique({
      where: { id: creatorId }, select: { name: true }
    });
    await notificationService.notifyCaseAssigned(
      { id: newCase.id, caseNumber: newCase.caseNumber, title: newCase.title },
      assignedInvestigatorId,
      creator?.name || 'A supervisor'
    );
  }

  logger.info('Case created', { 
    caseId: newCase.id, 
    caseNumber: newCase.caseNumber,
    createdBy: creatorId 
  });

  return newCase;
}

/**
 * Update a case
 * 
 * @param {string} caseId - Case ID
 * @param {Object} updateData - Fields to update
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Updated case
 */
async function updateCase(caseId, updateData, context) {
  const { userId, userRole, ipAddress } = context;

  // Get current case
  const currentCase = await prisma.case.findUnique({
    where: { id: caseId }
  });

  if (!currentCase || currentCase.deletedAt) {
    throw new NotFoundError('Case');
  }

  // Check access
  const hasAccess = userRole === 'ADMIN' || userRole === 'SUPERVISOR' ||
    (userRole === 'INVESTIGATOR' && currentCase.assignedInvestigatorId === userId);

  if (!hasAccess) {
    throw new AuthorizationError('You do not have access to update this case');
  }

  // Investigators can only update description
  if (userRole === 'INVESTIGATOR') {
    const allowedFields = ['description'];
    const attemptedFields = Object.keys(updateData);
    const invalidFields = attemptedFields.filter(f => !allowedFields.includes(f));
    
    if (invalidFields.length > 0) {
      throw new AuthorizationError(
        `Investigators can only update: ${allowedFields.join(', ')}`
      );
    }
  }

  // Validate status transition if status is being changed
  if (updateData.status && updateData.status !== currentCase.status) {
    if (!isValidStatusTransition(currentCase.status, updateData.status)) {
      throw new ValidationError(
        `Invalid status transition from ${currentCase.status} to ${updateData.status}`
      );
    }
  }

  // Archived cases cannot be modified
  if (currentCase.status === 'ARCHIVED') {
    throw new ValidationError('Archived cases cannot be modified');
  }

  // Build update data
  const dataToUpdate = {};
  if (updateData.title !== undefined) dataToUpdate.title = updateData.title;
  if (updateData.description !== undefined) dataToUpdate.description = updateData.description;
  if (updateData.priority !== undefined) dataToUpdate.priority = updateData.priority;
  if (updateData.status !== undefined) {
    dataToUpdate.status = updateData.status;
    // Set closedAt if closing, clear if reopening
    if (updateData.status === 'CLOSED') {
      dataToUpdate.closedAt = new Date();
    } else if (updateData.status === 'OPEN' && currentCase.status === 'CLOSED') {
      dataToUpdate.closedAt = null;
    }
  }

  // Update the case
  const updatedCase = await prisma.case.update({
    where: { id: caseId },
    data: dataToUpdate,
    include: {
      assignedInvestigator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  // Log the update
  await auditService.logCaseUpdated(userId, caseId, {
    before: {
      title: currentCase.title,
      description: currentCase.description,
      priority: currentCase.priority,
      status: currentCase.status
    },
    after: {
      title: updatedCase.title,
      description: updatedCase.description,
      priority: updatedCase.priority,
      status: updatedCase.status
    }
  }, ipAddress);

  // Log specific status changes
  if (updateData.status === 'CLOSED' && currentCase.status !== 'CLOSED') {
    await auditService.logCaseClosed(userId, caseId, updatedCase.caseNumber, ipAddress);
  }

  logger.info('Case updated', { 
    caseId, 
    updatedBy: userId,
    changes: Object.keys(dataToUpdate)
  });

  return updatedCase;
}

/**
 * Assign an investigator to a case
 * 
 * @param {string} caseId - Case ID
 * @param {string|null} investigatorId - Investigator ID (null to unassign)
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Updated case
 */
async function assignInvestigator(caseId, investigatorId, context) {
  const { userId, ipAddress } = context;

  // Get current case
  const currentCase = await prisma.case.findUnique({
    where: { id: caseId }
  });

  if (!currentCase || currentCase.deletedAt) {
    throw new NotFoundError('Case');
  }

  if (currentCase.status === 'ARCHIVED') {
    throw new ValidationError('Cannot assign investigator to an archived case');
  }

  // Validate investigator if provided
  let investigator = null;
  if (investigatorId) {
    investigator = await prisma.user.findUnique({
      where: { id: investigatorId },
      select: { id: true, name: true, email: true, role: true, deletedAt: true }
    });

    if (!investigator || investigator.deletedAt) {
      throw new NotFoundError('Investigator');
    }

    if (investigator.role !== 'INVESTIGATOR') {
      throw new ValidationError('Only users with INVESTIGATOR role can be assigned to cases');
    }
  }

  // Update the case
  const updatedCase = await prisma.case.update({
    where: { id: caseId },
    data: { assignedInvestigatorId: investigatorId },
    include: {
      assignedInvestigator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  // Log the assignment
  await auditService.logCaseAssigned(
    userId, 
    caseId, 
    investigatorId,
    investigator?.email || 'Unassigned',
    ipAddress
  );

  // Notify the new investigator (if assigning, not unassigning)
  if (investigatorId) {
    const assigner = await prisma.user.findUnique({
      where: { id: userId }, select: { name: true }
    });
    await notificationService.notifyCaseAssigned(
      { id: caseId, caseNumber: updatedCase.caseNumber, title: updatedCase.title },
      investigatorId,
      assigner?.name || 'A supervisor'
    );
  }

  logger.info('Case assignment updated', { 
    caseId, 
    assignedTo: investigatorId,
    assignedBy: userId 
  });

  return updatedCase;
}

/**
 * Close a case
 * 
 * @param {string} caseId - Case ID
 * @param {string} reason - Optional closure reason
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Updated case
 */
async function closeCase(caseId, reason, context) {
  const { userId, ipAddress } = context;

  // Get current case
  const currentCase = await prisma.case.findUnique({
    where: { id: caseId }
  });

  if (!currentCase || currentCase.deletedAt) {
    throw new NotFoundError('Case');
  }

  if (currentCase.status === 'CLOSED') {
    throw new ConflictError('Case is already closed');
  }

  if (currentCase.status === 'ARCHIVED') {
    throw new ValidationError('Archived cases cannot be closed');
  }

  // Update the case
  const updatedCase = await prisma.case.update({
    where: { id: caseId },
    data: { 
      status: 'CLOSED',
      closedAt: new Date()
    },
    include: {
      assignedInvestigator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  // Log the closure
  await auditService.logCaseClosed(userId, caseId, updatedCase.caseNumber, ipAddress);

  // Notify the assigned investigator
  const closer = await prisma.user.findUnique({
    where: { id: userId }, select: { name: true }
  });
  await notificationService.notifyCaseClosed(
    { id: caseId, caseNumber: updatedCase.caseNumber, title: updatedCase.title, assignedInvestigatorId: currentCase.assignedInvestigatorId },
    closer?.name || 'A supervisor'
  );

  logger.info('Case closed', { caseId, closedBy: userId, reason });

  return updatedCase;
}

/**
 * Reopen a closed case
 * 
 * @param {string} caseId - Case ID
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Updated case
 */
async function reopenCase(caseId, context) {
  const { userId, ipAddress } = context;

  const currentCase = await prisma.case.findUnique({
    where: { id: caseId }
  });

  if (!currentCase || currentCase.deletedAt) {
    throw new NotFoundError('Case');
  }

  if (currentCase.status !== 'CLOSED') {
    throw new ConflictError('Only closed cases can be reopened');
  }

  const updatedCase = await prisma.case.update({
    where: { id: caseId },
    data: { 
      status: 'OPEN',
      closedAt: null
    },
    include: {
      assignedInvestigator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  // Log the reopening
  await auditService.logCaseUpdated(userId, caseId, {
    action: 'REOPEN',
    previousStatus: 'CLOSED',
    newStatus: 'OPEN'
  }, ipAddress);

  // Notify the assigned investigator
  const reopener = await prisma.user.findUnique({
    where: { id: userId }, select: { name: true }
  });
  await notificationService.notifyCaseReopened(
    { id: caseId, caseNumber: updatedCase.caseNumber, title: updatedCase.title, assignedInvestigatorId: currentCase.assignedInvestigatorId },
    reopener?.name || 'A supervisor'
  );

  logger.info('Case reopened', { caseId, reopenedBy: userId });

  return updatedCase;
}

/**
 * Soft delete a case (Admin only)
 * 
 * @param {string} caseId - Case ID
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Deleted case
 */
async function deleteCase(caseId, context) {
  const { adminId, ipAddress } = context;

  const caseData = await prisma.case.findUnique({
    where: { id: caseId }
  });

  if (!caseData) {
    throw new NotFoundError('Case');
  }

  if (caseData.deletedAt) {
    throw new NotFoundError('Case'); // Already deleted
  }

  // Soft delete the case
  const deletedCase = await prisma.case.update({
    where: { id: caseId },
    data: { deletedAt: new Date() },
    select: {
      id: true,
      caseNumber: true,
      title: true,
      deletedAt: true
    }
  });

  // Log the deletion
  await auditService.logCaseUpdated(adminId, caseId, {
    action: 'DELETE',
    caseNumber: deletedCase.caseNumber,
    title: deletedCase.title
  }, ipAddress);

  logger.info('Case deleted (soft)', { 
    caseId, 
    caseNumber: deletedCase.caseNumber,
    deletedBy: adminId 
  });

  return deletedCase;
}

/**
 * Get case statistics
 * 
 * @param {Object} user - Current user
 * @returns {Promise<Object>} Case statistics
 */
async function getCaseStatistics(user) {
  const baseWhere = { deletedAt: null };
  
  // Investigators only see stats for their cases
  if (user.role === 'INVESTIGATOR') {
    baseWhere.assignedInvestigatorId = user.id;
  }

  const [
    totalCases,
    openCases,
    closedCases,
    pendingCases,
    archivedCases,
    priorityDistribution,
    recentCases
  ] = await Promise.all([
    prisma.case.count({ where: baseWhere }),
    prisma.case.count({ where: { ...baseWhere, status: 'OPEN' } }),
    prisma.case.count({ where: { ...baseWhere, status: 'CLOSED' } }),
    prisma.case.count({ where: { ...baseWhere, status: 'PENDING' } }),
    prisma.case.count({ where: { ...baseWhere, status: 'ARCHIVED' } }),
    prisma.case.groupBy({
      by: ['priority'],
      where: baseWhere,
      _count: true
    }),
    prisma.case.findMany({
      where: baseWhere,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    })
  ]);

  return {
    total: totalCases,
    byStatus: {
      open: openCases,
      closed: closedCases,
      pending: pendingCases,
      archived: archivedCases
    },
    byPriority: priorityDistribution.reduce((acc, item) => {
      acc[item.priority] = item._count;
      return acc;
    }, {}),
    recentCases
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Queries
  getCases,
  getCaseById,
  getCaseByCaseNumber,
  getCaseStatistics,
  
  // Mutations
  createCase,
  updateCase,
  assignInvestigator,
  closeCase,
  reopenCase,
  deleteCase,
  
  // Helpers (for testing)
  generateCaseNumber,
  isValidStatusTransition
};
