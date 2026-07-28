/**
 * User Service
 * 
 * Business logic for user management operations.
 * 
 * Service Layer Responsibilities:
 * - Enforce business rules
 * - Coordinate database operations
 * - Handle authorization logic
 * - Trigger audit logging
 * 
 * This layer is independent of HTTP concerns (no req/res).
 * It can be reused by different controllers or even CLI tools.
 */

const { prisma } = require('../config/database');
const { hashPassword } = require('../utils/password.util');
const { 
  NotFoundError, 
  ConflictError,
  AuthorizationError
} = require('../middleware/error.middleware');
const auditService = require('./audit.service');
const { logger } = require('../utils/logger');

// =============================================================================
// USER QUERIES
// =============================================================================

/**
 * Get paginated list of users
 * 
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Items per page
 * @param {string} options.role - Filter by role
 * @param {string} options.search - Search in name or email
 * @param {boolean} options.includeDeleted - Include soft-deleted users
 * @param {string} options.sortBy - Field to sort by
 * @param {string} options.sortOrder - Sort direction (asc/desc)
 * @returns {Promise<Object>} { users, pagination }
 */
async function getUsers(options = {}) {
  const {
    page = 1,
    limit = 10,
    role,
    search,
    includeDeleted = false,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = options;

  // Calculate offset for pagination - ensure integers
  const pageNum = typeof page === 'string' ? parseInt(page, 10) : Number(page);
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  const where = {};

  // Filter by deletion status
  if (!includeDeleted) {
    where.deletedAt = null;
  }

  // Filter by role
  if (role) {
    where.role = role;
  }

  // Search in name or email
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } }
    ];
  }

  // Execute query and count in parallel
  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
        deletedAt: true
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limitNum
    }),
    prisma.user.count({ where })
  ]);

  // Calculate pagination metadata
  const totalPages = Math.ceil(totalCount / limitNum);

  return {
    users,
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
 * Get a single user by ID
 * 
 * @param {string} userId - User ID
 * @param {boolean} includeDeleted - Include if soft-deleted
 * @returns {Promise<Object>} User object
 * @throws {NotFoundError} If user not found
 */
async function getUserById(userId, includeDeleted = false) {
  const where = { id: userId };
  
  if (!includeDeleted) {
    where.deletedAt = null;
  }

  const user = await prisma.user.findFirst({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
      deletedAt: true,
      // Include some statistics
      _count: {
        select: {
          assignedCases: true,
          uploadedEvidence: true
        }
      }
    }
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  // Flatten the statistics
  return {
    ...user,
    assignedCasesCount: user._count.assignedCases,
    uploadedEvidenceCount: user._count.uploadedEvidence,
    _count: undefined
  };
}

/**
 * Get user by email
 * 
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      deletedAt: true
    }
  });
}

// =============================================================================
// USER MUTATIONS
// =============================================================================

/**
 * Create a new user (Admin only)
 * 
 * @param {Object} userData - User data
 * @param {Object} context - Request context
 * @param {string} context.adminId - ID of admin creating the user
 * @param {string} context.ipAddress - Client IP
 * @returns {Promise<Object>} Created user
 * @throws {ConflictError} If email already exists
 */
async function createUser(userData, context) {
  const { email, password, name, role } = userData;

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    throw new ConflictError('A user with this email already exists');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true
    }
  });

  // Log the action
  await auditService.logUserCreated(context.adminId, user, context.ipAddress);

  logger.info('User created', { 
    createdBy: context.adminId, 
    userId: user.id, 
    email: user.email 
  });

  return user;
}

/**
 * Update a user (Admin or self-update)
 * 
 * @param {string} userId - User to update
 * @param {Object} updateData - Fields to update
 * @param {Object} context - Request context
 * @param {string} context.requesterId - ID of user making the request
 * @param {string} context.requesterRole - Role of requester
 * @param {string} context.ipAddress - Client IP
 * @returns {Promise<Object>} Updated user
 * @throws {NotFoundError} If user not found
 * @throws {AuthorizationError} If trying to self-promote
 * @throws {ConflictError} If email already taken
 */
async function updateUser(userId, updateData, context) {
  const { requesterId, requesterRole, ipAddress } = context;
  const isSelfUpdate = requesterId === userId;
  const isAdmin = requesterRole === 'ADMIN';

  // Get current user
  const currentUser = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!currentUser || currentUser.deletedAt) {
    throw new NotFoundError('User');
  }

  // Business Rules:
  // 1. Users can only update their own profile (name, email) unless they're admin
  // 2. Users cannot change their own role (privilege escalation protection)
  // 3. Only admins can change roles

  if (isSelfUpdate && updateData.role && updateData.role !== currentUser.role) {
    throw new AuthorizationError('You cannot change your own role');
  }

  if (!isAdmin && !isSelfUpdate) {
    throw new AuthorizationError('You can only update your own profile');
  }

  // Non-admins cannot update role
  if (!isAdmin && updateData.role) {
    delete updateData.role;
  }

  // If email is being changed, check for conflicts
  if (updateData.email && updateData.email !== currentUser.email) {
    const existingUser = await getUserByEmail(updateData.email);
    if (existingUser) {
      throw new ConflictError('A user with this email already exists');
    }
  }

  // Build update data (only include defined fields)
  const dataToUpdate = {};
  if (updateData.name !== undefined) dataToUpdate.name = updateData.name;
  if (updateData.email !== undefined) dataToUpdate.email = updateData.email;
  if (updateData.role !== undefined) dataToUpdate.role = updateData.role;

  // Update the user
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: dataToUpdate,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true
    }
  });

  // Log the action
  await auditService.logUserUpdated(requesterId, userId, {
    before: {
      name: currentUser.name,
      email: currentUser.email,
      role: currentUser.role
    },
    after: {
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role
    }
  }, ipAddress);

  logger.info('User updated', { 
    updatedBy: requesterId, 
    userId, 
    changes: Object.keys(dataToUpdate)
  });

  return updatedUser;
}

/**
 * Soft delete a user (Admin only)
 * 
 * Why soft delete?
 * - Preserves audit trail
 * - Allows recovery
 * - Maintains referential integrity in cases/evidence
 * 
 * @param {string} userId - User to delete
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Deleted user
 * @throws {NotFoundError} If user not found
 * @throws {AuthorizationError} If trying to self-delete
 */
async function deleteUser(userId, context) {
  const { adminId, ipAddress } = context;

  // Prevent self-deletion
  if (adminId === userId) {
    throw new AuthorizationError('You cannot delete your own account');
  }

  // Get user
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  if (user.deletedAt) {
    throw new NotFoundError('User'); // Already deleted
  }

  // Soft delete by setting deletedAt
  const deletedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      // Also invalidate their tokens
      refreshToken: null
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      deletedAt: true
    }
  });

  // Revoke all refresh tokens
  await prisma.refreshToken.updateMany({
    where: { 
      userId,
      revokedAt: null 
    },
    data: { revokedAt: new Date() }
  });

  // Log the action
  await auditService.logUserDeleted(adminId, deletedUser, ipAddress);

  logger.info('User deleted (soft)', { 
    deletedBy: adminId, 
    userId, 
    email: deletedUser.email 
  });

  return deletedUser;
}

/**
 * Restore a soft-deleted user (Admin only)
 * 
 * @param {string} userId - User to restore
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Restored user
 */
async function restoreUser(userId, context) {
  const { adminId, ipAddress } = context;

  // Get user including deleted
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  if (!user.deletedAt) {
    throw new ConflictError('User is not deleted');
  }

  // Restore the user
  const restoredUser = await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true
    }
  });

  // Log the action (as user update with restore details)
  await auditService.logUserUpdated(adminId, userId, {
    action: 'RESTORE',
    email: restoredUser.email
  }, ipAddress);

  logger.info('User restored', { 
    restoredBy: adminId, 
    userId, 
    email: restoredUser.email 
  });

  return restoredUser;
}

/**
 * Admin reset user's password
 * 
 * Use case: User forgot password, admin resets it
 * 
 * @param {string} userId - User whose password to reset
 * @param {string} newPassword - New password
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Updated user (without password)
 */
async function adminResetPassword(userId, newPassword, context) {
  const { adminId, ipAddress } = context;

  // Get user
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user || user.deletedAt) {
    throw new NotFoundError('User');
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update password and invalidate tokens
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      refreshToken: null
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true
    }
  });

  // Revoke all refresh tokens
  await prisma.refreshToken.updateMany({
    where: { 
      userId,
      revokedAt: null 
    },
    data: { revokedAt: new Date() }
  });

  // Log the action
  await auditService.logPasswordChanged(userId, ipAddress, adminId);

  logger.info('Password reset by admin', { 
    adminId, 
    userId, 
    email: updatedUser.email 
  });

  return updatedUser;
}

/**
 * Get user statistics for dashboard
 * 
 * @returns {Promise<Object>} User statistics
 */
async function getUserStatistics() {
  const [
    totalUsers,
    activeUsers,
    deletedUsers,
    roleDistribution
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: { not: null } } }),
    prisma.user.groupBy({
      by: ['role'],
      where: { deletedAt: null },
      _count: true
    })
  ]);

  return {
    total: totalUsers,
    active: activeUsers,
    deleted: deletedUsers,
    byRole: roleDistribution.reduce((acc, item) => {
      acc[item.role] = item._count;
      return acc;
    }, {})
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Queries
  getUsers,
  getUserById,
  getUserByEmail,
  getUserStatistics,
  
  // Mutations
  createUser,
  updateUser,
  deleteUser,
  restoreUser,
  adminResetPassword
};
