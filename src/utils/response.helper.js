/**
 * API Response Helper
 * 
 * Provides consistent response formatting across all API endpoints.
 * 
 * Why standardize responses?
 * 1. Frontend developers know exactly what to expect
 * 2. Error handling becomes predictable
 * 3. API documentation is easier to maintain
 * 4. Makes debugging simpler
 * 
 * Standard Response Format:
 * {
 *   success: boolean,
 *   message: string,
 *   data: object | array | null,
 *   pagination?: { page, limit, total, totalPages }
 * }
 */

/**
 * Send a success response
 * 
 * @param {Object} res - Express response object
 * @param {Object} options - Response options
 * @param {number} options.statusCode - HTTP status code (default: 200)
 * @param {string} options.message - Success message
 * @param {*} options.data - Response data
 * @param {Object} options.pagination - Pagination info (optional)
 */
function sendSuccess(res, { statusCode = 200, message = 'Success', data = null, pagination = null }) {
  const response = {
    success: true,
    message,
    data
  };

  if (pagination) {
    response.pagination = pagination;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send an error response
 * 
 * @param {Object} res - Express response object
 * @param {Object} options - Response options
 * @param {number} options.statusCode - HTTP status code (default: 500)
 * @param {string} options.message - Error message
 * @param {Array} options.errors - Validation errors (optional)
 */
function sendError(res, { statusCode = 500, message = 'An error occurred', errors = null }) {
  const response = {
    success: false,
    message
  };

  if (errors && errors.length > 0) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send a created response (201)
 */
function sendCreated(res, { message = 'Created successfully', data = null }) {
  return sendSuccess(res, { statusCode: 201, message, data });
}

/**
 * Send a no content response (204)
 * Used for successful delete operations
 */
function sendNoContent(res) {
  return res.status(204).send();
}

/**
 * Send a bad request response (400)
 */
function sendBadRequest(res, { message = 'Bad request', errors = null }) {
  return sendError(res, { statusCode: 400, message, errors });
}

/**
 * Send an unauthorized response (401)
 */
function sendUnauthorized(res, { message = 'Unauthorized' }) {
  return sendError(res, { statusCode: 401, message });
}

/**
 * Send a forbidden response (403)
 */
function sendForbidden(res, { message = 'Forbidden: You do not have permission to perform this action' }) {
  return sendError(res, { statusCode: 403, message });
}

/**
 * Send a not found response (404)
 */
function sendNotFound(res, { message = 'Resource not found' }) {
  return sendError(res, { statusCode: 404, message });
}

/**
 * Send a conflict response (409)
 */
function sendConflict(res, { message = 'Resource already exists' }) {
  return sendError(res, { statusCode: 409, message });
}

/**
 * Send an unprocessable entity response (422)
 * Used for integrity check failures
 */
function sendUnprocessableEntity(res, { message = 'Unprocessable entity', errors = null }) {
  return sendError(res, { statusCode: 422, message, errors });
}

/**
 * Build pagination object for list responses
 * 
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} total - Total number of items
 * @returns {Object} Pagination object
 */
function buildPagination(page, limit, total) {
  return {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    total,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Parse pagination parameters from query
 * 
 * @param {Object} query - Request query object
 * @param {Object} defaults - Default values
 * @returns {Object} { page, limit, skip }
 */
function parsePaginationParams(query, defaults = { page: 1, limit: 10 }) {
  const page = Math.max(1, parseInt(query.page, 10) || defaults.page);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaults.limit));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

module.exports = {
  sendSuccess,
  sendError,
  sendCreated,
  sendNoContent,
  sendBadRequest,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendUnprocessableEntity,
  buildPagination,
  parsePaginationParams
};
