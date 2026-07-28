/**
 * QR Code Utility
 *
 * Generates QR codes that encode evidence verification URLs.
 * When scanned, the QR code takes the investigator directly to the
 * integrity-verification endpoint for that evidence item.
 *
 * Two output formats:
 *   - PNG Buffer  (for embedding in PDF reports)
 *   - Data URL    (for sending directly in API responses)
 */

const QRCode = require('qrcode');
const { logger } = require('./logger');

/**
 * Generate QR code as a PNG Buffer.
 *
 * @param {string} text         - Content to encode (usually a URL)
 * @param {Object} [options]    - QRCode options
 * @returns {Promise<Buffer>}   - PNG image buffer
 */
async function generateQRCodeBuffer(text, options = {}) {
  const defaultOptions = {
    errorCorrectionLevel: 'H',  // High — can recover even if 30% of code is damaged
    type: 'png',
    width: 300,
    margin: 2,
    color: {
      dark:  '#000000',
      light: '#ffffff'
    }
  };

  const buffer = await QRCode.toBuffer(text, { ...defaultOptions, ...options });
  logger.debug('QR code generated (buffer)', { textLength: text.length });
  return buffer;
}

/**
 * Generate QR code as a Base64 Data URL.
 * Safe to embed directly in HTML or JSON responses.
 *
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<string>}   - "data:image/png;base64,..." string
 */
async function generateQRCodeDataUrl(text, options = {}) {
  const defaultOptions = {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 300,
    margin: 2
  };

  const dataUrl = await QRCode.toDataURL(text, { ...defaultOptions, ...options });
  logger.debug('QR code generated (data URL)', { textLength: text.length });
  return dataUrl;
}

/**
 * Build the canonical verification URL for an evidence item.
 *
 * In production, replace the base URL with your actual domain.
 *
 * @param {string} evidenceId   - UUID of the evidence record
 * @param {string} sha256Hash   - Hash for offline verification
 * @param {string} [baseUrl]    - Base URL (defaults to localhost)
 * @returns {string}
 */
function buildEvidenceVerificationUrl(evidenceId, sha256Hash, baseUrl = 'http://localhost:3000') {
  return `${baseUrl}/api/v1/evidence/${evidenceId}/verify?hash=${sha256Hash}`;
}

/**
 * Generate an evidence QR code Buffer (convenience wrapper).
 *
 * @param {Object} evidence  - Evidence record { id, sha256Hash, originalName }
 * @param {string} [baseUrl]
 * @returns {Promise<Buffer>}
 */
async function generateEvidenceQRCode(evidence, baseUrl) {
  const url = buildEvidenceVerificationUrl(evidence.id, evidence.sha256Hash, baseUrl);
  return generateQRCodeBuffer(url);
}

/**
 * Generate an evidence QR code as a Data URL (convenience wrapper).
 */
async function generateEvidenceQRCodeDataUrl(evidence, baseUrl) {
  const url = buildEvidenceVerificationUrl(evidence.id, evidence.sha256Hash, baseUrl);
  return generateQRCodeDataUrl(url);
}

module.exports = {
  generateQRCodeBuffer,
  generateQRCodeDataUrl,
  generateEvidenceQRCode,
  generateEvidenceQRCodeDataUrl,
  buildEvidenceVerificationUrl
};
