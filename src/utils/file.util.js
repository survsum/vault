/**
 * File Utility Functions
 * 
 * Handles:
 * - SHA-256 hash computation for integrity verification
 * - File system operations (move, delete)
 * - Safe filename generation
 * 
 * Why SHA-256 for evidence?
 * SHA-256 produces a 256-bit fingerprint of any file. If even a single byte
 * changes, the hash changes completely. This makes tampering detectable.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

/**
 * Compute SHA-256 hash of a file
 * 
 * Reads the file as a stream to handle large files efficiently
 * without loading the entire file into memory.
 * 
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 * 
 * @example
 * const hash = await computeFileHash('/uploads/evidence/abc.pdf');
 * // => "3b4c5d..."
 */
async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => {
      logger.error('Error computing file hash', { filePath, error: err.message });
      reject(err);
    });
  });
}

/**
 * Compute SHA-256 hash of a buffer (in-memory data)
 * 
 * @param {Buffer} buffer - File data buffer
 * @returns {string} Hex-encoded SHA-256 hash
 */
function computeBufferHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Verify a file's integrity by recomputing its hash
 * 
 * @param {string} filePath - Path to the file
 * @param {string} expectedHash - Expected SHA-256 hash
 * @returns {Promise<boolean>} True if hash matches, false if tampered
 */
async function verifyFileIntegrity(filePath, expectedHash) {
  try {
    const currentHash = await computeFileHash(filePath);
    const isValid = currentHash === expectedHash;

    if (!isValid) {
      logger.warn('File integrity check FAILED', {
        filePath,
        expectedHash,
        currentHash
      });
    }

    return isValid;
  } catch (error) {
    logger.error('Error verifying file integrity', { filePath, error: error.message });
    return false;
  }
}

/**
 * Check if a file exists
 * 
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Delete a file safely (won't throw if file doesn't exist)
 * 
 * @param {string} filePath - Path to file to delete
 * @returns {Promise<boolean>} True if deleted, false if file not found
 */
async function deleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
    logger.debug('File deleted', { filePath });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // File didn't exist
    }
    throw error;
  }
}

/**
 * Ensure a directory exists, creating it if needed
 * 
 * @param {string} dirPath - Directory path
 */
async function ensureDirectory(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * Get file size in bytes
 * 
 * @param {string} filePath - Path to file
 * @returns {Promise<number>} File size in bytes
 */
async function getFileSize(filePath) {
  const stats = await fs.promises.stat(filePath);
  return stats.size;
}

/**
 * Format bytes to a human-readable string
 * 
 * @param {number|BigInt} bytes - File size in bytes
 * @returns {string} E.g., "1.5 MB"
 */
function formatFileSize(bytes) {
  const num = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = num;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Get the upload directory path for a specific date/case
 * Organizes uploads by year/month to avoid huge flat directories
 * 
 * @param {string} basePath - Base upload directory
 * @param {string} caseId - Case ID for organization
 * @returns {string} Full directory path
 */
function getUploadPath(basePath, caseId) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  // Structure: uploads/2024/01/<caseId>/
  return path.join(basePath, String(year), month, caseId);
}

/**
 * Sanitize a filename to remove potentially dangerous characters
 * 
 * @param {string} filename - Original filename
 * @returns {string} Safe filename
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace unsafe chars with underscore
    .replace(/_{2,}/g, '_')             // Collapse multiple underscores
    .slice(0, 255);                     // Limit length
}

module.exports = {
  computeFileHash,
  computeBufferHash,
  verifyFileIntegrity,
  fileExists,
  deleteFile,
  ensureDirectory,
  getFileSize,
  formatFileSize,
  getUploadPath,
  sanitizeFilename
};
