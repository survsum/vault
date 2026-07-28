/**
 * Digital Evidence Vault - Express Application Configuration
 * 
 * This file configures the Express application with all middleware,
 * routes, and error handlers. It exports the app for both the server
 * and for testing purposes.
 * 
 * Middleware Order Matters!
 * 1. Security middleware (helmet, cors) - First line of defense
 * 2. Request parsing (json, urlencoded) - Parse incoming requests
 * 3. Rate limiting - Prevent abuse before processing
 * 4. Logging - Log all requests
 * 5. Routes - Handle business logic
 * 6. Error handlers - Catch and format errors (must be last)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const { requestLogger, errorLogger } = require('./middleware/logging.middleware');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');
const swaggerSpec = require('./config/swagger');

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const caseRoutes = require('./routes/case.routes');
const evidenceRoutes = require('./routes/evidence.routes');
const auditRoutes = require('./routes/audit.routes');
const notificationRoutes = require('./routes/notification.routes');
const dashboardRoutes = require('./routes/dashboard.routes');

const app = express();

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

/**
 * Helmet - Sets various HTTP headers for security
 * - Removes X-Powered-By header (hides Express)
 * - Sets Content-Security-Policy
 * - Sets X-Content-Type-Options: nosniff
 * - Sets X-Frame-Options: DENY
 * - And many more...
 */
app.use(helmet());

/**
 * CORS - Cross-Origin Resource Sharing
 * Controls which domains can access your API
 * In production, restrict this to your frontend domain
 */
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

/**
 * Rate Limiting - Prevents brute force and DDoS attacks
 * Limits each IP to a certain number of requests per window
 */
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs, // 15 minutes
  max: config.rateLimitMax, // 100 requests per window
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: config.rateLimitWindowMs / 1000
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Disable rate limiting in test environment
  skip: () => config.nodeEnv === 'test'
});

// Apply rate limiting (skipped in test environment)
app.use(limiter);

// Stricter rate limiting for authentication routes (prevents brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 10 login attempts per 15 minutes
  message: {
    success: false,
    message: 'Too many login attempts, please try again after 15 minutes.'
  },
  // Disable rate limiting in test environment
  skip: () => config.nodeEnv === 'test'
});

// =============================================================================
// REQUEST PARSING MIDDLEWARE
// =============================================================================

/**
 * Parse JSON bodies
 * limit: prevents large payload attacks
 */
app.use(express.json({ limit: '10mb' }));

/**
 * Parse URL-encoded bodies (form data)
 * extended: true allows rich objects and arrays
 */
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// =============================================================================
// LOGGING MIDDLEWARE
// =============================================================================

// Log all incoming requests
app.use(requestLogger);

// =============================================================================
// API DOCUMENTATION
// =============================================================================

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Digital Evidence Vault API'
}));

// =============================================================================
// HEALTH CHECK
// =============================================================================

/**
 * Health check endpoint for load balancers and monitoring
 * Should always return 200 if the server is running
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Digital Evidence Vault is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// =============================================================================
// API ROUTES
// =============================================================================

// Apply stricter rate limiting to auth routes
app.use('/api/v1/auth', authLimiter, authRoutes);

// Standard API routes
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/cases', caseRoutes);
app.use('/api/v1/evidence', evidenceRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Error logging middleware
app.use(errorLogger);

// Global error handler - must be last
app.use(errorHandler);

module.exports = app;
