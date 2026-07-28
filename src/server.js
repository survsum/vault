/**
 * Digital Evidence Vault - Main Server Entry Point
 * 
 * This file bootstraps the Express application and starts the HTTP server.
 * It's kept minimal - actual app configuration is in app.js for testability.
 * 
 * Why separate server.js and app.js?
 * - app.js exports the Express app for testing (Supertest needs the app, not a running server)
 * - server.js handles the actual server startup
 * - This separation follows the "Separation of Concerns" principle
 */

const app = require('./app');
const { logger } = require('./utils/logger');
const config = require('./config');

const PORT = config.port || 3000;

const server = app.listen(PORT, () => {
  logger.info(`🔐 Digital Evidence Vault server running on port ${PORT}`);
  logger.info(`📚 API Documentation available at http://localhost:${PORT}/api-docs`);
  logger.info(`🌍 Environment: ${config.nodeEnv}`);
});

// Graceful shutdown handling
// This is crucial for production - ensures connections are properly closed
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = server;
