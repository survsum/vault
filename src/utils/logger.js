/**
 * Winston Logger Configuration
 * 
 * Why Winston?
 * 1. Multiple transport support (console, file, external services)
 * 2. Log levels (error, warn, info, debug)
 * 3. Custom formatting (JSON for production, pretty for development)
 * 4. Log rotation support
 * 
 * Best Practices:
 * - Use appropriate log levels
 * - Never log sensitive data (passwords, tokens, PII)
 * - Include contextual information (user ID, request ID)
 * - Use JSON format in production for log aggregation tools
 */

const winston = require('winston');
const path = require('path');
const config = require('../config');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Pretty format for development
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Create logs directory path
const logsDir = path.join(process.cwd(), 'logs');

// Define transports based on environment
const transports = [];

// Always log to console
transports.push(
  new winston.transports.Console({
    format: config.nodeEnv === 'development' ? devFormat : logFormat
  })
);

// In production, also log to files
if (config.nodeEnv === 'production') {
  // Error log - only errors
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
  
  // Combined log - all levels
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
}

// Create the logger instance
const logger = winston.createLogger({
  level: config.logLevel,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false
});

/**
 * Create a child logger with additional context
 * Useful for adding request-specific information
 * 
 * @param {Object} metadata - Additional context to include in all logs
 * @returns {Object} - Child logger instance
 */
function createChildLogger(metadata) {
  return logger.child(metadata);
}

/**
 * Audit logger specifically for chain of custody logging
 * This creates a separate log stream for audit events
 */
const auditLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10
    }),
    new winston.transports.Console({
      format: config.nodeEnv === 'development' ? devFormat : logFormat
    })
  ]
});

/**
 * Log an audit event
 * 
 * @param {Object} event - Audit event details
 * @param {string} event.action - The action performed (LOGIN, UPLOAD, etc.)
 * @param {string} event.userId - The user who performed the action
 * @param {string} event.entity - The entity type (CASE, EVIDENCE, USER)
 * @param {string} event.entityId - The ID of the affected entity
 * @param {string} event.ipAddress - Client IP address
 * @param {Object} event.details - Additional details about the action
 */
function logAuditEvent(event) {
  auditLogger.info('AUDIT_EVENT', {
    ...event,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  logger,
  createChildLogger,
  auditLogger,
  logAuditEvent
};
