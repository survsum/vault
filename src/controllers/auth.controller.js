/**
 * Authentication Controller
 * 
 * Handles HTTP requests for authentication endpoints.
 * Controllers are thin - they:
 * 1. Extract data from requests
 * 2. Call service methods
 * 3. Format and send responses
 * 
 * Business logic stays in services!
 */

const authService = require('../services/auth.service');
const { 
  sendSuccess, 
  sendCreated, 
  sendBadRequest 
} = require('../utils/response.helper');
const { logger } = require('../utils/logger');

/**
 * Register a new user
 * POST /auth/register
 * 
 * Only admins can register new users (enforced by route middleware)
 */
async function register(req, res, next) {
  try {
    const { email, password, name, role } = req.body;
    
    const context = {
      creatorId: req.user.id, // The admin creating this user
      ipAddress: req.clientIp
    };

    const user = await authService.register(
      { email, password, name, role },
      context
    );

    sendCreated(res, {
      message: 'User registered successfully',
      data: { user }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Login
 * POST /auth/login
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    
    const context = {
      ipAddress: req.clientIp,
      userAgent: req.get('user-agent')
    };

    const result = await authService.login(email, password, context);

    sendSuccess(res, {
      message: 'Login successful',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: '15m' // Inform client of access token lifetime
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Logout
 * POST /auth/logout
 * 
 * Requires authentication
 */
async function logout(req, res, next) {
  try {
    const refreshToken = req.body.refreshToken;
    
    const context = {
      ipAddress: req.clientIp
    };

    await authService.logout(req.user.id, refreshToken, context);

    sendSuccess(res, {
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Refresh access token
 * POST /auth/refresh
 */
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;

    const tokens = await authService.refreshAccessToken(refreshToken);

    sendSuccess(res, {
      message: 'Tokens refreshed successfully',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: '15m'
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get current user profile
 * GET /auth/me
 * 
 * Returns the authenticated user's profile
 */
async function getProfile(req, res, next) {
  try {
    const user = await authService.getUserById(req.user.id);

    sendSuccess(res, {
      message: 'Profile retrieved successfully',
      data: { user }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Change password
 * POST /auth/change-password
 * 
 * Requires authentication
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    
    const context = {
      ipAddress: req.clientIp
    };

    await authService.changePassword(
      req.user.id,
      currentPassword,
      newPassword,
      context
    );

    sendSuccess(res, {
      message: 'Password changed successfully. Please login again with your new password.'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
  logout,
  refresh,
  getProfile,
  changePassword
};
