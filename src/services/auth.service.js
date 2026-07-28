/**
 * Authentication Service
 * 
 * Handles user authentication business logic:
 * - Login validation
 * - Token generation and refresh
 * - Password management
 * 
 * This service is used by the auth controller and keeps
 * the business logic separate from HTTP concerns.
 */

const { prisma } = require('../config/database');
const { hashPassword, verifyPassword } = require('../utils/password.util');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt.util');
const { 
  AuthenticationError, 
  NotFoundError, 
  ConflictError 
} = require('../middleware/error.middleware');
const auditService = require('./audit.service');
const { logger } = require('../utils/logger');

/**
 * Register a new user
 * 
 * @param {Object} userData - User registration data
 * @param {string} userData.email - User email
 * @param {string} userData.password - Plain text password
 * @param {string} userData.name - User full name
 * @param {string} userData.role - User role
 * @param {Object} context - Request context
 * @param {string} context.creatorId - ID of user creating this account
 * @param {string} context.ipAddress - Client IP address
 * @returns {Promise<Object>} Created user (without password)
 */
async function register({ email, password, name, role }, context) {
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    throw new ConflictError('A user with this email already exists');
  }

  // Hash the password
  const passwordHash = await hashPassword(password);

  // Create the user
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

  // Log the user creation
  await auditService.logUserCreated(context.creatorId, user, context.ipAddress);

  logger.info('User registered', { userId: user.id, email: user.email, role: user.role });

  return user;
}

/**
 * Login a user
 * 
 * @param {string} email - User email
 * @param {string} password - Plain text password
 * @param {Object} context - Request context
 * @param {string} context.ipAddress - Client IP address
 * @param {string} context.userAgent - Client user agent
 * @returns {Promise<Object>} { user, accessToken, refreshToken }
 */
async function login(email, password, context) {
  // Find user by email (including deleted check)
  const user = await prisma.user.findUnique({
    where: { email }
  });

  // Check if user exists
  if (!user) {
    // Log failed attempt (no user ID to log)
    await auditService.logLogin(null, context.ipAddress, context.userAgent, false);
    throw new AuthenticationError('Invalid email or password');
  }

  // Check if user is deleted (soft delete)
  if (user.deletedAt) {
    await auditService.logLogin(user.id, context.ipAddress, context.userAgent, false);
    throw new AuthenticationError('This account has been deactivated');
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.passwordHash);

  if (!isValidPassword) {
    await auditService.logLogin(user.id, context.ipAddress, context.userAgent, false);
    throw new AuthenticationError('Invalid email or password');
  }

  // Generate tokens
  const tokens = generateTokenPair({
    id: user.id,
    email: user.email,
    role: user.role
  });

  // Update user's last login and store refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      refreshToken: tokens.refreshToken
    }
  });

  // First, revoke any existing active refresh tokens for this user
  // This prevents duplicate token issues and ensures clean token rotation
  await prisma.refreshToken.updateMany({
    where: {
      userId: user.id,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });

  // Then store new refresh token in RefreshToken table for token management
  await prisma.refreshToken.create({
    data: {
      token: tokens.refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    }
  });

  // Log successful login
  await auditService.logLogin(user.id, context.ipAddress, context.userAgent, true);

  logger.info('User logged in', { userId: user.id, email: user.email });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
}

/**
 * Logout a user (invalidate refresh token)
 * 
 * @param {string} userId - User ID
 * @param {string} refreshToken - Current refresh token
 * @param {Object} context - Request context
 */
async function logout(userId, refreshToken, context) {
  // Clear the user's refresh token
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null }
  });

  // Revoke the refresh token in the token table
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: {
        token: refreshToken,
        userId: userId
      },
      data: {
        revokedAt: new Date()
      }
    });
  }

  // Log the logout
  await auditService.logLogout(userId, context.ipAddress);

  logger.info('User logged out', { userId });
}

/**
 * Refresh access token using refresh token
 * 
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} { accessToken, refreshToken }
 */
async function refreshAccessToken(refreshToken) {
  // Verify the refresh token
  const decoded = verifyRefreshToken(refreshToken);

  if (!decoded) {
    throw new AuthenticationError('Invalid or expired refresh token');
  }

  // Check if token exists in database and is not revoked
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken }
  });

  if (!storedToken || storedToken.revokedAt) {
    throw new AuthenticationError('Refresh token has been revoked');
  }

  if (storedToken.expiresAt < new Date()) {
    throw new AuthenticationError('Refresh token has expired');
  }

  // Get the user
  const user = await prisma.user.findUnique({
    where: { id: decoded.sub }
  });

  if (!user || user.deletedAt) {
    throw new AuthenticationError('User not found or deactivated');
  }

  // Generate new token pair
  const tokens = generateTokenPair({
    id: user.id,
    email: user.email,
    role: user.role
  });

  // Revoke old refresh token
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() }
  });

  // Store new refresh token
  await prisma.refreshToken.create({
    data: {
      token: tokens.refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  // Update user's stored refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: tokens.refreshToken }
  });

  logger.debug('Tokens refreshed', { userId: user.id });

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
}

/**
 * Change user password
 * 
 * @param {string} userId - User ID
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @param {Object} context - Request context
 */
async function changePassword(userId, currentPassword, newPassword, context) {
  // Get user with password hash
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  // Verify current password
  const isValid = await verifyPassword(currentPassword, user.passwordHash);

  if (!isValid) {
    throw new AuthenticationError('Current password is incorrect');
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newPasswordHash,
      // Invalidate all refresh tokens by clearing the stored one
      refreshToken: null
    }
  });

  // Revoke all user's refresh tokens
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });

  // Log password change
  await auditService.logPasswordChanged(userId, context.ipAddress);

  logger.info('Password changed', { userId });
}

/**
 * Get user by ID
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User object (without password)
 */
async function getUserById(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastLoginAt: true
    }
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  return user;
}

/**
 * Clean up expired refresh tokens (call periodically)
 */
async function cleanupExpiredTokens() {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { not: null } }
      ]
    }
  });

  logger.info('Cleaned up expired tokens', { count: result.count });
  return result.count;
}

module.exports = {
  register,
  login,
  logout,
  refreshAccessToken,
  changePassword,
  getUserById,
  cleanupExpiredTokens
};
