/**
 * File Upload Middleware (Multer)
 * 
 * Multer is the standard Express middleware for handling multipart/form-data
 * (file uploads). It processes the incoming file and makes it available
 * on req.file (single) or req.files (multiple).
 * 
 * Security Considerations:
 * 1. File type validation - Only allow safe MIME types
 * 2. File size limits - Prevent disk exhaustion
 * 3. UUID filenames - Prevent path traversal and enumeration
 * 4. Destination directory - Isolated from web root
 * 
 * How Multer works:
 * 1. Intercepts multipart/form-data requests
 * 2. Parses file and field data
 * 3. Writes file to disk (diskStorage) or memory (memoryStorage)
 * 4. Attaches file metadata to req.file
 */

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { ensureDirectory, getUploadPath } = require('../utils/file.util');
const { logger } = require('../utils/logger');

// =============================================================================
// STORAGE ENGINE
// =============================================================================

/**
 * Disk storage engine
 * 
 * destination: Where to save the file
 * filename: What to name the file on disk
 */
const diskStorage = multer.diskStorage({
  /**
   * Determine the destination folder for the uploaded file
   * We organize by year/month/caseId
   */
  destination: async (req, file, cb) => {
    try {
      // caseId comes from the request body
      // Note: Multer processes fields in order, so caseId should be
      // sent before the file field in the multipart form
      const caseId = req.body.caseId || 'unknown';
      const uploadDir = getUploadPath(config.upload.storagePath, caseId);
      
      // Create directory if it doesn't exist
      await ensureDirectory(uploadDir);
      
      cb(null, uploadDir);
    } catch (error) {
      logger.error('Error setting upload destination', { error: error.message });
      cb(error);
    }
  },

  /**
   * Generate a UUID-based filename
   * 
   * Why UUID instead of original name?
   * 1. Prevents filename conflicts
   * 2. Prevents path traversal attacks (../../../etc/passwd)
   * 3. Prevents enumeration (attacker can't guess file paths)
   * 
   * We preserve the original extension for MIME type clarity.
   */
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueFilename = `${crypto.randomUUID()}${extension}`;
    cb(null, uniqueFilename);
  }
});

// =============================================================================
// FILE FILTER
// =============================================================================

/**
 * Validate file type before accepting
 * 
 * Important: MIME type can be spoofed in the Content-Type header,
 * but combined with file extension check, it's a good first filter.
 * For production, consider using file-type library for magic byte validation.
 */
const fileFilter = (req, file, cb) => {
  const allowedTypes = config.upload.allowedMimeTypes;
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true); // Accept file
  } else {
    cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `File type ${file.mimetype} is not allowed`
      ),
      false
    );
  }
};

// =============================================================================
// MULTER INSTANCES
// =============================================================================

/**
 * Single file upload (main evidence upload)
 * Field name must be 'file' in the multipart form
 */
const uploadSingle = multer({
  storage: diskStorage,
  limits: {
    fileSize: config.upload.maxFileSize, // 100MB default
    files: 1
  },
  fileFilter
}).single('file');

/**
 * Wrap multer in a promise for async/await support
 * Multer uses callback style, this converts it to promise
 */
function uploadSingleAsync(req, res) {
  return new Promise((resolve, reject) => {
    uploadSingle(req, res, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(req.file);
      }
    });
  });
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Upload middleware that handles the file upload process
 * and adds the file to req.file
 */
async function handleUpload(req, res, next) {
  try {
    await uploadSingleAsync(req, res);
    
    if (!req.file) {
      const { ValidationError } = require('./error.middleware');
      throw new ValidationError('No file uploaded. Include a file in the "file" field.');
    }
    
    logger.debug('File uploaded to disk', {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
    
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  handleUpload,
  uploadSingleAsync
};
