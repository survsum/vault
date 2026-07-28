/**
 * Authentication Middleware
 * 
 * Protects routes by verifying JWT tokens and checking user permissions.
 * 
 * Middleware Chain:
 * 1. authenticate - Verifies JWT and attaches user to request
 * 2. authorize - Checks if user has required role(s)
 * 
 * Usage:
 * // Require authentication
 * router.get('/protected', authenticate, controller.method);
 * 
 * // Require specific role
 * router.delete('/admin-only', authenticate, authorize('ADMIN'), controller.method);
 * 
 * // Require one of several roles
 * router.post('/create', authenticate, authorize(['ADMIN', 'SUPERVISOR']), controller.method);
 */

const { verifyAccessToken, extractTokenFromHeader } = require('../utils/jwt.util');
const { prisma } = require('../config/database');
const { AuthenticationError, AuthorizationError } = require('./error.middleware');
const { logger } = require('../utils/logger');

/**
 * Authentication middleware
 * Verifies the JWT access token and attaches the user to the request
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authenticate(req, res, next) {
  try {
    // Extract token from Authorization header
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      throw new AuthenticationError('No token provided');
    }

    // Verify the token
    const decoded = verifyAccessToken(token);
    
    if (!decoded) {
      throw new AuthenticationError('Invalid or expired token');
    }

    // Fetch the user from database to ensure they still exist and are active
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        deletedAt: true
      }
    });

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    if (user.deletedAt) {
      throw new AuthenticationError('User account has been deactivated');
    }

    // Attach user to request for use in controllers
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };

    // Also attach the token for potential use (e.g., logging)
    req.token = token;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Authorization middleware factory
 * Checks if the authenticated user has the required role(s)
 * 
 * @param {string|string[]} allowedRoles - Role or array of roles allowed
 * @returns {Function} Express middleware
 * 
 * @example
 * // Single role
 * authorize('ADMIN')
 * 
 * // Multiple roles
 * authorize(['ADMIN', 'SUPERVISOR'])
 */
function authorize(allowedRoles) {
  // Normalize to array
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    try {
      // User must be authenticated first
      if (!req.user) {
        throw new AuthenticationError('User not authenticated');
      }

      // Check if user's role is in allowed roles
      if (!roles.includes(req.user.role)) {
        logger.warn('Authorization failed', {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: roles,
          path: req.path
        });

        throw new AuthorizationError(
          `This action requires one of the following roles: ${roles.join(', ')}`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Self or Admin middleware
 * Allows users to access their own resources or admins to access any
 * 
 * @param {string} paramName - Name of the route parameter containing user ID
 * @returns {Function} Express middleware
 * 
 * @example
 * // User can view their own profile or admin can view any
 * router.get('/users/:userId', authenticate, selfOrAdmin('userId'), controller.getUser);
 */
function selfOrAdmin(paramName = 'id') {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError('User not authenticated');
      }

      const targetUserId = req.params[paramName];
      const isOwnResource = req.user.id === targetUserId;
      const isAdmin = req.user.role === 'ADMIN';

      if (!isOwnResource && !isAdmin) {
        throw new AuthorizationError('You can only access your own resources');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Optional authentication middleware
 * Attaches user to request if valid token provided, but doesn't fail if not
 * Useful for routes that behave differently for authenticated users
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return next();
    }

    const decoded = verifyAccessToken(token);
    
    if (!decoded) {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        deletedAt: true
      }
    });

    if (user && !user.deletedAt) {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      };
    }

    next();
  } catch (error) {
    // Don't fail, just continue without user
    next();
  }
}

/**
 * Check if user has specific permission
 * More granular than role-based authorization
 */
const PERMISSIONS = {
  // User permissions
  'users:read': ['ADMIN'],
  'users:write': ['ADMIN'],
  'users:delete': ['ADMIN'],
  
  // Case permissions
  'cases:read': ['ADMIN', 'SUPERVISOR', 'INVESTIGATOR'],
  'cases:write': ['ADMIN', 'SUPERVISOR'],
  'cases:delete': ['ADMIN'],
  'cases:assign': ['ADMIN', 'SUPERVISOR'],
  
  // Evidence permissions
  'evidence:read': ['ADMIN', 'SUPERVISOR', 'INVESTIGATOR'],
  'evidence:upload': ['ADMIN', 'SUPERVISOR', 'INVESTIGATOR'],
  'evidence:approve': ['ADMIN', 'SUPERVISOR'],
  'evidence:reject': ['ADMIN', 'SUPERVISOR'],
  'evidence:delete': ['ADMIN'],
  'evidence:download': ['ADMIN', 'SUPERVISOR', 'INVESTIGATOR'],
  
  // Audit permissions
  'audit:read': ['ADMIN', 'SUPERVISOR'],
  'audit:export': ['ADMIN', 'SUPERVISOR'],
  
  // Dashboard permissions
  'dashboard:read': ['ADMIN', 'SUPERVISOR', 'INVESTIGATOR'],
  'reports:generate': ['ADMIN', 'SUPERVISOR']
};

/**
 * Permission-based authorization middleware
 * 
 * @param {string} permission - Permission string (e.g., 'users:write')
 * @returns {Function} Express middleware
 * 
 * @example
 * router.delete('/users/:id', authenticate, requirePermission('users:delete'), controller.delete);
 */
function requirePermission(permission) {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError('User not authenticated');
      }

      const allowedRoles = PERMISSIONS[permission];
      
      if (!allowedRoles) {
        logger.error('Unknown permission:', permission);
        throw new Error('Unknown permission');
      }

      if (!allowedRoles.includes(req.user.role)) {
        throw new AuthorizationError(`Permission denied: ${permission}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  authenticate,
  authorize,
  selfOrAdmin,
  optionalAuth,
  requirePermission,
  PERMISSIONS
};
