/**
 * Password Utility Module
 * 
 * Handles secure password hashing and verification using bcrypt.
 * 
 * Why bcrypt?
 * - Designed specifically for passwords (slow by design)
 * - Built-in salt generation (prevents rainbow table attacks)
 * - Configurable work factor (can be increased as hardware improves)
 * - Widely audited and trusted
 * 
 * Security Considerations:
 * - Salt rounds: 12 is a good balance (about 250ms on modern hardware)
 * - Higher = more secure but slower (13 = ~500ms, 14 = ~1s)
 * - Never store plain text passwords!
 * - Never log passwords!
 */

const bcrypt = require('bcryptjs');
const config = require('../config');

/**
 * Hash a password
 * 
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(config.bcrypt.saltRounds);
  return bcrypt.hash(password, salt);
}

/**
 * Verify a password against a hash
 * 
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Stored password hash
 * @returns {Promise<boolean>} True if password matches
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Check password strength
 * Returns a score from 0-4 and feedback
 * 
 * @param {string} password - Password to check
 * @returns {Object} { score: number, feedback: string[] }
 */
function checkPasswordStrength(password) {
  const feedback = [];
  let score = 0;

  // Length checks
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length < 8) {
    feedback.push('Password should be at least 8 characters');
  }

  // Complexity checks
  if (/[A-Z]/.test(password)) {
    score++;
  } else {
    feedback.push('Add uppercase letters');
  }

  if (/[a-z]/.test(password)) {
    score++;
  } else {
    feedback.push('Add lowercase letters');
  }

  if (/[0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Add numbers');
  }

  if (/[^A-Za-z0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Add special characters');
  }

  // Check for common patterns
  if (/(.)\1{2,}/.test(password)) {
    score--;
    feedback.push('Avoid repeated characters');
  }

  if (/^(123|abc|qwerty|password)/i.test(password)) {
    score--;
    feedback.push('Avoid common patterns');
  }

  // Normalize score to 0-4 range
  score = Math.max(0, Math.min(4, Math.floor(score / 2)));

  const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];

  return {
    score,
    strength: strengthLabels[score],
    feedback: feedback.length > 0 ? feedback : ['Password meets requirements']
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  checkPasswordStrength
};
