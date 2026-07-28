/**
 * Centralized Configuration Module
 * 
 * Why centralize configuration?
 * 1. Single source of truth for all config values
 * 2. Easy to switch between environments (dev, staging, prod)
 * 3. Validates that required environment variables exist
 * 4. Provides sensible defaults for development
 * 
 * Best Practice: Never hardcode sensitive values. Always use environment variables.
 */

require('dotenv').config();

const config = {
  // Server Configuration
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  
  // Database Configuration
  databaseUrl: process.env.DATABASE_URL,
  
  // JWT Configuration
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'your-super-secret-access-key-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },
  
  // Password Hashing
  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12
  },
  
  // File Upload Configuration
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 100 * 1024 * 1024, // 100MB default
    allowedMimeTypes: [
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      // Images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/tiff',
      // Videos
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      // Audio
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      // Archives
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed'
    ],
    storagePath: process.env.UPLOAD_PATH || './uploads'
  },
  
  // Encryption Configuration (for AES-256 file encryption)
  encryption: {
    algorithm: 'aes-256-gcm',
    key: process.env.ENCRYPTION_KEY || 'your-32-character-encryption-key!' // Must be 32 bytes for AES-256
  },
  
  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100, // 100 requests per window
  
  // CORS
  corsOrigin: process.env.CORS_ORIGIN || '*',
  
  // Email Configuration (for notifications)
  email: {
    host: process.env.EMAIL_HOST || 'smtp.mailtrap.io',
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'noreply@evidence-vault.com'
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info'
};

/**
 * Validate required configuration in production
 * This prevents the application from starting with missing critical config
 */
function validateConfig() {
  const requiredInProduction = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY'
  ];
  
  if (config.nodeEnv === 'production') {
    const missing = requiredInProduction.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Validate encryption key length
    if (config.encryption.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 characters for AES-256');
    }
  }
}

validateConfig();

module.exports = config;
