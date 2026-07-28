/**
 * AES-256-GCM File Encryption Utility
 *
 * Why AES-256-GCM?
 * - 256-bit key → the strongest commercially available symmetric encryption
 * - GCM (Galois/Counter Mode) provides both confidentiality AND authenticity
 *   (authenticated encryption) — you can detect tampering without a separate MAC
 * - Each file gets a unique random IV (Initialisation Vector), so even two
 *   identical files produce different ciphertexts
 *
 * File layout on disk (encrypted):
 * ┌─────────────────────────────────┐
 * │  IV  (12 bytes, hex in DB)      │  stored in evidence.encryptionIv
 * │  AuthTag (16 bytes, prepended)  │
 * │  Ciphertext (rest of file)      │
 * └─────────────────────────────────┘
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const config = require('../config');
const { logger } = require('./logger');

const ALGORITHM   = 'aes-256-gcm';
const IV_LENGTH   = 12;   // 96-bit IV — GCM recommendation
const TAG_LENGTH  = 16;   // 128-bit auth tag

/**
 * Get the 32-byte encryption key from config.
 * Throws clearly if the key is the wrong length.
 */
function getKey() {
  const key = config.encryption.key;
  if (!key || key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters for AES-256-GCM');
  }
  return Buffer.from(key, 'utf8');
}

/**
 * Encrypt a file on disk, writing the result to a new file.
 *
 * @param {string} inputPath   - Path to the plaintext file
 * @param {string} outputPath  - Path to write the encrypted file
 * @returns {Promise<string>}  - The 24-character hex IV (store in DB)
 */
async function encryptFile(inputPath, outputPath) {
  const iv         = crypto.randomBytes(IV_LENGTH);
  const key        = getKey();
  const cipher     = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const readStream  = fs.createReadStream(inputPath);
  const writeStream = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    // Write auth tag placeholder first; we'll prepend it after streaming
    const chunks = [];

    cipher.on('data', chunk => chunks.push(chunk));
    cipher.on('end', () => {
      const authTag    = cipher.getAuthTag();
      const ciphertext = Buffer.concat(chunks);

      // Layout: authTag (16) + ciphertext
      writeStream.write(authTag);
      writeStream.end(ciphertext, (err) => {
        if (err) return reject(err);
        logger.debug('File encrypted', { inputPath, outputPath, iv: iv.toString('hex') });
        resolve(iv.toString('hex'));
      });
    });

    readStream.on('error', reject);
    cipher.on('error', reject);
    readStream.pipe(cipher);
  });
}

/**
 * Decrypt a file on disk, writing plaintext to a new file.
 *
 * @param {string} inputPath   - Path to the encrypted file
 * @param {string} outputPath  - Path to write the plaintext file
 * @param {string} ivHex       - Hex IV stored in the database
 * @returns {Promise<void>}
 * @throws if auth tag verification fails (tampered file)
 */
async function decryptFile(inputPath, outputPath, ivHex) {
  const iv          = Buffer.from(ivHex, 'hex');
  const key         = getKey();
  const decipher    = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  // Read entire encrypted buffer so we can split out the auth tag
  const encryptedBuffer = await fs.promises.readFile(inputPath);
  const authTag         = encryptedBuffer.subarray(0, TAG_LENGTH);
  const ciphertext      = encryptedBuffer.subarray(TAG_LENGTH);

  decipher.setAuthTag(authTag);

  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(outputPath);
    const chunks = [];

    decipher.on('data', chunk => chunks.push(chunk));
    decipher.on('end', () => {
      const plaintext = Buffer.concat(chunks);
      writeStream.end(plaintext, (err) => {
        if (err) return reject(err);
        logger.debug('File decrypted', { inputPath, outputPath });
        resolve();
      });
    });
    decipher.on('error', (err) => {
      reject(new Error(`Decryption failed — file may be corrupted or tampered: ${err.message}`));
    });

    decipher.end(ciphertext);
  });
}

/**
 * Encrypt a Buffer in memory (for small payloads like QR code images).
 *
 * @param {Buffer} plaintext
 * @returns {{ iv: string, authTag: string, ciphertext: Buffer }}
 */
function encryptBuffer(plaintext) {
  const iv      = crypto.randomBytes(IV_LENGTH);
  const key     = getKey();
  const cipher  = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return {
    iv:         iv.toString('hex'),
    authTag:    authTag.toString('hex'),
    ciphertext: encrypted
  };
}

/**
 * Decrypt a Buffer in memory.
 */
function decryptBuffer(ciphertext, ivHex, authTagHex) {
  const iv      = Buffer.from(ivHex,      'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key     = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = {
  encryptFile,
  decryptFile,
  encryptBuffer,
  decryptBuffer
};
