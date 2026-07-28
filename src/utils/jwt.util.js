/**
 * JWT Utility Module
 * 
 * Handles JWT token generation and verification for authentication.
 * 
 * Token Strategy:
 * - Access Token: Short-lived (15 min), used for API requests
 * - Refresh Token: Long-lived (7 days), used to get new access tokens
 * 
 * Why two tokens?
 * - Access tokens are frequently sent, so short lifespan limits damage if stolen
 * - Refresh tokens are only sent to /refresh endpoint, reducing exposure
 * - Allows logout (invalidate refresh token) without blacklisting access tokens
 * 
 * Security Best Practices:
 * - Different secrets for access and refresh tokens
 * - Include minimal user data in payload (never passwords!)
 * - Set appropriate expiration times
 * - Use strong secrets (256+ bits)
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { logger } = require('./logger');

/**
 * Generate an access token
 * 
 * @param {Object} user - User object
 * @param {string} user.id - User ID
 * @param {string} user.email - User email
 * @param {string} user.role - User role
 * @returns {string} JWT access token
 */
function generateAccessToken(user) {
  const payload = {
    sub: user.id,           // Subject (user ID) - standard JWT claim
    email: user.email,
    role: user.role,
    type: 'access'          // Token type for validation
  };

  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: 'digital-evidence-vault',
    audience: 'dev-api'
  });
}

/**
 * Generate a refresh token
 * 
 * @param {Object} user - User object
 * @param {string} user.id - User ID
 * @returns {string} JWT refresh token
 */
function generateRefreshToken(user) {
  const payload = {
    sub: user.id,
    type: 'refresh',
    // Add jti (JWT ID) for uniqueness - prevents duplicate token issues
    jti: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  };

  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: 'digital-evidence-vault',
    audience: 'dev-api'
  });
}

/**
 * Generate both access and refresh tokens
 * 
 * @param {Object} user - User object
 * @returns {Object} { accessToken, refreshToken }
 */
function generateTokenPair(user) {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user)
  };
}

/**
 * Verify an access token
 * 
 * @param {string} token - JWT access token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, {
      issuer: 'digital-evidence-vault',
      audience: 'dev-api'
    });

    // Ensure it's an access token
    if (decoded.type !== 'access') {
      logger.warn('Token type mismatch: expected access token');
      return null;
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Access token expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.debug('Invalid access token:', error.message);
    } else {
      logger.error('Access token verification error:', error);
    }
    return null;
  }
}

/**
 * Verify a refresh token
 * 
 * @param {string} token - JWT refresh token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret, {
      issuer: 'digital-evidence-vault',
      audience: 'dev-api'
    });

    // Ensure it's a refresh token
    if (decoded.type !== 'refresh') {
      logger.warn('Token type mismatch: expected refresh token');
      return null;
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Refresh token expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.debug('Invalid refresh token:', error.message);
    } else {
      logger.error('Refresh token verification error:', error);
    }
    return null;
  }
}

/**
 * Extract token from Authorization header
 * Expected format: "Bearer <token>"
 * 
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null if not found/invalid
 */
function extractTokenFromHeader(authHeader) {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Decode a token without verification (for debugging)
 * WARNING: Never trust unverified tokens!
 * 
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null
 */
function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
}

/**
 * Get token expiration date
 * 
 * @param {string} token - JWT token
 * @returns {Date|null} Expiration date or null
 */
function getTokenExpiration(token) {
  const decoded = decodeToken(token);
  if (decoded && decoded.exp) {
    return new Date(decoded.exp * 1000);
  }
  return null;
}

/**
 * Check if token is expired
 * 
 * @param {string} token - JWT token
 * @returns {boolean} True if expired
 */
function isTokenExpired(token) {
  const expiration = getTokenExpiration(token);
  if (!expiration) {
    return true;
  }
  return expiration < new Date();
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  extractTokenFromHeader,
  decodeToken,
  getTokenExpiration,
  isTokenExpired
};
