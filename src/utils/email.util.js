/**
 * Email Notification Utility
 *
 * Uses Nodemailer to send transactional emails.
 * Templates are plain HTML strings — replace with a proper template
 * engine (Handlebars, MJML) for production.
 *
 * Configuration is read from config/index.js which pulls from .env.
 * If EMAIL_USER / EMAIL_PASS are not set, emails are silently skipped
 * in development so the application still runs without an SMTP server.
 */

const nodemailer = require('nodemailer');
const config     = require('../config');
const { logger } = require('./logger');

// ─── Transporter ─────────────────────────────────────────────────────────────

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (!config.email.user || !config.email.pass) {
    // No credentials — create a debug-only transporter that logs instead
    _transporter = null;
    return null;
  }

  _transporter = nodemailer.createTransport({
    host:   config.email.host,
    port:   config.email.port,
    secure: config.email.port === 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass
    }
  });

  return _transporter;
}

// ─── Core Send ───────────────────────────────────────────────────────────────

/**
 * Send an email.
 *
 * @param {Object} options
 * @param {string|string[]} options.to      - Recipient(s)
 * @param {string} options.subject          - Subject line
 * @param {string} options.html             - HTML body
 * @param {string} [options.text]           - Plaintext fallback
 * @returns {Promise<Object|null>}          - Nodemailer info, or null if skipped
 */
async function sendEmail({ to, subject, html, text }) {
  const transporter = getTransporter();

  if (!transporter) {
    // Log the email in development instead of sending
    logger.info('Email skipped (no SMTP credentials)', { to, subject });
    if (config.nodeEnv === 'development') {
      logger.debug('Email body preview', { html: html?.slice(0, 300) });
    }
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from:    `"Digital Evidence Vault" <${config.email.from}>`,
      to:      Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text:    text || html.replace(/<[^>]+>/g, '')  // strip tags for fallback
    });

    logger.info('Email sent', { to, subject, messageId: info.messageId });
    return info;
  } catch (error) {
    // Never let email failures crash the app
    logger.error('Email send failed', { to, subject, error: error.message });
    return null;
  }
}

// ─── HTML Templates ──────────────────────────────────────────────────────────

function baseTemplate(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width">
<title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; background: #f4f5f7; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff;
               border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
  .header { background: #1a365d; color: #ffffff; padding: 24px 32px; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p  { margin: 4px 0 0; font-size: 12px; opacity: .8; }
  .body   { padding: 32px; color: #2d3748; font-size: 14px; line-height: 1.6; }
  .btn    { display: inline-block; margin: 16px 0; padding: 12px 24px;
            background: #2b6cb0; color: #ffffff !important; border-radius: 6px;
            text-decoration: none; font-weight: bold; }
  .badge  { display: inline-block; padding: 4px 10px; border-radius: 12px;
            font-size: 12px; font-weight: bold; }
  .badge-success  { background: #c6f6d5; color: #276749; }
  .badge-danger   { background: #fed7d7; color: #c53030; }
  .badge-warning  { background: #feebc8; color: #c05621; }
  .meta   { background: #f7fafc; border-radius: 6px; padding: 16px; margin: 16px 0;
            font-size: 13px; }
  .meta-row { display: flex; gap: 8px; margin: 4px 0; }
  .meta-label { color: #718096; width: 140px; flex-shrink: 0; }
  .footer { padding: 16px 32px; font-size: 11px; color: #a0aec0; text-align: center;
            border-top: 1px solid #e2e8f0; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>🔒 Digital Evidence Vault</h1>
    <p>Secure Evidence Management System</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">This is an automated message. Do not reply to this email.</div>
</div>
</body></html>`;
}

// ─── Email Triggers ───────────────────────────────────────────────────────────

/**
 * Evidence uploaded — notify supervisor/admin
 */
async function sendEvidenceUploadedEmail({ to, uploaderName, evidenceName, caseNumber, evidenceId, baseUrl = '' }) {
  const body = `
    <h2>New Evidence Uploaded</h2>
    <p>${uploaderName} uploaded new evidence awaiting your review.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Evidence File:</span><strong>${evidenceName}</strong></div>
      <div class="meta-row"><span class="meta-label">Case:</span>${caseNumber}</div>
    </div>
    <a href="${baseUrl}/api-docs#/Evidence" class="btn">Review Evidence →</a>
    <p>Log in to the Evidence Vault to approve or reject this evidence.</p>
  `;
  return sendEmail({ to, subject: `New Evidence Awaiting Review — ${caseNumber}`, html: baseTemplate('New Evidence', body) });
}

/**
 * Evidence approved — notify the uploader
 */
async function sendEvidenceApprovedEmail({ to, recipientName, evidenceName, reviewerName, caseNumber }) {
  const body = `
    <h2>Evidence Approved ✅</h2>
    <p>Hi ${recipientName},</p>
    <p>Your evidence has been reviewed and approved.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Evidence File:</span><strong>${evidenceName}</strong></div>
      <div class="meta-row"><span class="meta-label">Case:</span>${caseNumber}</div>
      <div class="meta-row"><span class="meta-label">Reviewed By:</span>${reviewerName}</div>
    </div>
    <span class="badge badge-success">APPROVED</span>
  `;
  return sendEmail({ to, subject: `Evidence Approved — ${evidenceName}`, html: baseTemplate('Evidence Approved', body) });
}

/**
 * Evidence rejected — notify the uploader
 */
async function sendEvidenceRejectedEmail({ to, recipientName, evidenceName, reviewerName, reason, caseNumber }) {
  const body = `
    <h2>Evidence Rejected ❌</h2>
    <p>Hi ${recipientName},</p>
    <p>Your evidence has been reviewed and rejected.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Evidence File:</span><strong>${evidenceName}</strong></div>
      <div class="meta-row"><span class="meta-label">Case:</span>${caseNumber}</div>
      <div class="meta-row"><span class="meta-label">Reviewed By:</span>${reviewerName}</div>
      <div class="meta-row"><span class="meta-label">Reason:</span><em>${reason}</em></div>
    </div>
    <span class="badge badge-danger">REJECTED</span>
    <p>Please upload a corrected version of the evidence.</p>
  `;
  return sendEmail({ to, subject: `Evidence Rejected — ${evidenceName}`, html: baseTemplate('Evidence Rejected', body) });
}

/**
 * Case assigned — notify the investigator
 */
async function sendCaseAssignedEmail({ to, investigatorName, caseNumber, caseTitle, assignedByName }) {
  const body = `
    <h2>Case Assigned to You</h2>
    <p>Hi ${investigatorName},</p>
    <p>You have been assigned to a new investigation case.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Case Number:</span><strong>${caseNumber}</strong></div>
      <div class="meta-row"><span class="meta-label">Case Title:</span>${caseTitle}</div>
      <div class="meta-row"><span class="meta-label">Assigned By:</span>${assignedByName}</div>
    </div>
    <span class="badge badge-warning">OPEN</span>
    <p>Please log in to the Evidence Vault to begin your investigation.</p>
  `;
  return sendEmail({ to, subject: `Case Assigned: ${caseNumber}`, html: baseTemplate('Case Assigned', body) });
}

/**
 * Welcome email for newly created users
 */
async function sendWelcomeEmail({ to, name, temporaryPassword, loginUrl = '' }) {
  const body = `
    <h2>Welcome to Digital Evidence Vault</h2>
    <p>Hi ${name},</p>
    <p>Your account has been created. Use the credentials below to log in.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Email:</span>${to}</div>
      <div class="meta-row"><span class="meta-label">Temporary Password:</span><strong>${temporaryPassword}</strong></div>
    </div>
    <p style="color:#c53030;font-size:13px;">
      ⚠️ You will be required to change your password on first login.
    </p>
    ${loginUrl ? `<a href="${loginUrl}" class="btn">Log In →</a>` : ''}
  `;
  return sendEmail({ to, subject: 'Your Digital Evidence Vault Account', html: baseTemplate('Welcome', body) });
}

module.exports = {
  sendEmail,
  sendEvidenceUploadedEmail,
  sendEvidenceApprovedEmail,
  sendEvidenceRejectedEmail,
  sendCaseAssignedEmail,
  sendWelcomeEmail
};
