/**
 * Prisma Database Client Configuration
 * 
 * This module exports a singleton Prisma Client instance.
 * 
 * Why Singleton?
 * - Prisma Client manages a connection pool
 * - Creating multiple clients wastes resources
 * - In serverless environments, this prevents connection exhaustion
 * 
 * Best Practices:
 * - Use a single PrismaClient instance across your application
 * - Handle connection errors gracefully
 * - Disconnect properly on application shutdown
 * 
 * Prisma 7+ Note:
 * - Uses driver adapters for database connections
 * - The adapter provides the connection to the database
 * - This allows for better control over connection pooling
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { logger } = require('../utils/logger');
const config = require('./index');

// Create the PostgreSQL adapter
const adapter = new PrismaPg({ connectionString: config.databaseUrl });

// Prisma Client options for Prisma 7+
const prismaOptions = {
  // Use the PostgreSQL adapter
  adapter,
  // Log settings
  log: config.nodeEnv === 'development' 
    ? ['query', 'error', 'warn']
    : ['error']
};

// Create Prisma Client instance
const prisma = new PrismaClient(prismaOptions);

/**
 * Connect to the database
 * Call this during application startup
 */
async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    throw error;
  }
}

/**
 * Disconnect from the database
 * Call this during application shutdown
 */
async function disconnectDatabase() {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
    throw error;
  }
}

/**
 * Health check for database connection
 * Returns true if database is accessible
 */
async function isDatabaseHealthy() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}

module.exports = {
  prisma,
  connectDatabase,
  disconnectDatabase,
  isDatabaseHealthy
};
