/**
 * Logging Middleware
 * 
 * This middleware logs all incoming HTTP requests and responses.
 * Essential for debugging, monitoring, and security auditing.
 * 
 * What we log:
 * - HTTP method and URL
 * - Response status code
 * - Response time
 * - User agent
 * - IP address (for security)
 * 
 * What we DON'T log:
 * - Request bodies (may contain sensitive data)
 * - Authorization headers (contains tokens)
 * - Response bodies (may be large or contain sensitive data)
 */

const { logger } = require('../utils/logger');

/**
 * Request logging middleware
 * Logs incoming requests and measures response time
 */
const requestLogger = (req, res, next) => {
  // Generate a unique request ID for tracing
  const requestId = generateRequestId();
  req.requestId = requestId;
  
  // Record start time
  const startTime = Date.now();
  
  // Get client IP (consider proxies)
  const clientIp = getClientIp(req);
  req.clientIp = clientIp;
  
  // Log request received
  logger.info('Request received', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: clientIp,
    userAgent: req.get('user-agent')
  });
  
  // Override res.json to log response
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const duration = Date.now() - startTime;
    
    // Log response sent
    logger.info('Response sent', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: clientIp
    });
    
    return originalJson(body);
  };
  
  next();
};

/**
 * Error logging middleware
 * Logs errors before they're handled by the error handler
 */
const errorLogger = (err, req, res, next) => {
  logger.error('Request error', {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: err.stack,
    ip: req.clientIp
  });
  
  next(err);
};

/**
 * Generate a unique request ID
 * Format: timestamp-randomstring
 */
function generateRequestId() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomPart}`;
}

/**
 * Get client IP address
 * Handles cases where the app is behind a proxy/load balancer
 * 
 * Security note: X-Forwarded-For can be spoofed.
 * In production, only trust this header if your proxy sets it.
 */
function getClientIp(req) {
  // Check for forwarded IP (when behind proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Take the first IP in the chain (original client)
    return forwarded.split(',')[0].trim();
  }
  
  // Direct connection
  return req.socket?.remoteAddress || req.ip;
}

module.exports = {
  requestLogger,
  errorLogger
};
