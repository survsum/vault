/**
 * Error Handling Middleware
 * 
 * Centralized error handling is crucial for:
 * 1. Consistent error response format
 * 2. Preventing sensitive information leakage
 * 3. Proper HTTP status codes
 * 4. Error logging
 * 
 * Error Types We Handle:
 * - Validation errors (Zod)
 * - Authentication errors
 * - Authorization errors
 * - Database errors (Prisma)
 * - File upload errors (Multer)
 * - Generic application errors
 */

const { logger } = require('../utils/logger');
const { ZodError } = require('zod');
const { Prisma } = require('@prisma/client');
const config = require('../config');

/**
 * Custom Application Error Class
 * Extend this for specific error types
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational; // Operational errors vs programming errors
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Specific error classes for different scenarios
 */
class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

class IntegrityError extends AppError {
  constructor(message = 'Evidence integrity compromised') {
    super(message, 422);
    this.name = 'IntegrityError';
  }
}

/**
 * 404 Not Found Handler
 * Catches requests to undefined routes
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.method} ${req.originalUrl}`);
  next(error);
};

/**
 * Global Error Handler
 * This must be the LAST middleware in the chain
 */
const errorHandler = (err, req, res, next) => {
  try {
    // Default values
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal server error';
    let errors = [];
    
    // Handle Zod validation errors
    // In Zod v4+, errors might be in `err.issues` or `err.errors`
    const zodIssues = err.issues || err.errors;
    if (err.name === 'ZodError' || (zodIssues && Array.isArray(zodIssues) && zodIssues[0]?.path)) {
      statusCode = 400;
      message = 'Validation failed';
      errors = zodIssues.map(e => ({
        field: Array.isArray(e.path) ? e.path.join('.') : String(e.path),
        message: e.message
      }));
    }
  
  // Handle Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const { code, meta } = err;
    
    switch (code) {
      case 'P2002': // Unique constraint violation
        statusCode = 409;
        message = `A record with this ${meta?.target?.join(', ')} already exists`;
        break;
      case 'P2025': // Record not found
        statusCode = 404;
        message = 'Record not found';
        break;
      case 'P2003': // Foreign key constraint violation
        statusCode = 400;
        message = 'Referenced record does not exist';
        break;
      default:
        statusCode = 400;
        message = 'Database operation failed';
    }
  }
  
  // Handle Prisma validation errors
  if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    message = 'Invalid data provided';
  }
  
  // Handle Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File too large';
  }
  
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    message = 'Unexpected file field';
  }
  
  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }
  
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }
  
  // Log the error
  if (statusCode >= 500) {
    logger.error('Server error', {
      error: message,
      stack: err.stack,
      requestId: req.requestId
    });
  }
  
  // Build response
  const response = {
    success: false,
    message,
    ...(errors.length > 0 && { errors }),
    ...(config.nodeEnv === 'development' && {
      stack: err.stack,
      originalError: err.message
    })
  };
  
  res.status(statusCode).json(response);
  } catch (handlerError) {
    // If error handler itself fails, send generic 500
    logger.error('Error in error handler', { 
      originalError: err.message,
      handlerError: handlerError.message 
    });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  IntegrityError,
  notFoundHandler,
  errorHandler
};
