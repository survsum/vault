/**
 * Notification Service
 *
 * Two responsibilities:
 *
 * 1. CREATE — trigger functions called by other services when events happen
 *    (evidence approved, case assigned, etc.)
 *
 * 2. READ / MANAGE — endpoints the frontend calls to show the notification
 *    bell, list notifications, and mark them as read.
 */

const { prisma } = require('../config/database');
const { logger } = require('../utils/logger');
const { NotFoundError, AuthorizationError } = require('../middleware/error.middleware');

// =============================================================================
// LOW-LEVEL CREATOR
// =============================================================================

/**
 * Create a single notification record.
 * Errors are swallowed so notification failures never break the caller.
 */
async function createNotification({ userId, title, message, linkType = null, linkId = null }) {
  try {
    const notification = await prisma.notification.create({
      data: { userId, title, message, linkType, linkId }
    });
    logger.debug('Notification created', { notificationId: notification.id, userId });
    return notification;
  } catch (err) {
    logger.error('Failed to create notification', { error: err.message, userId, title });
    return null;
  }
}

/**
 * Create notifications for multiple users at once.
 */
async function createNotifications(userIds, { title, message, linkType, linkId }) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  await Promise.allSettled(
    unique.map(userId => createNotification({ userId, title, message, linkType, linkId }))
  );
}

// =============================================================================
// EVENT TRIGGERS  (called by other services)
// =============================================================================

/**
 * Evidence uploaded — notify supervisors & admins assigned to the case.
 */
async function notifyEvidenceUploaded(evidence, uploaderName) {
  // Find supervisors and admins to notify
  const supervisorsAndAdmins = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPERVISOR'] }, deletedAt: null },
    select: { id: true }
  });

  const userIds = supervisorsAndAdmins.map(u => u.id);

  await createNotifications(userIds, {
    title: 'New Evidence Uploaded',
    message: `${uploaderName} uploaded "${evidence.originalName}" and it is awaiting review.`,
    linkType: 'evidence',
    linkId: evidence.id
  });
}

/**
 * Evidence approved — notify the investigator who uploaded it.
 */
async function notifyEvidenceApproved(evidence, reviewerName) {
  await createNotification({
    userId:   evidence.uploadedById,
    title:    'Evidence Approved',
    message:  `Your evidence "${evidence.originalName}" has been approved by ${reviewerName}.`,
    linkType: 'evidence',
    linkId:   evidence.id
  });
}

/**
 * Evidence rejected — notify the investigator who uploaded it.
 */
async function notifyEvidenceRejected(evidence, reviewerName, reason) {
  await createNotification({
    userId:   evidence.uploadedById,
    title:    'Evidence Rejected',
    message:  `Your evidence "${evidence.originalName}" was rejected by ${reviewerName}. Reason: ${reason}`,
    linkType: 'evidence',
    linkId:   evidence.id
  });
}

/**
 * Case assigned — notify the investigator.
 */
async function notifyCaseAssigned(caseData, investigatorId, assignedByName) {
  if (!investigatorId) return; // Unassignment — no notification needed
  await createNotification({
    userId:   investigatorId,
    title:    'Case Assigned to You',
    message:  `${assignedByName} assigned you to case ${caseData.caseNumber}: "${caseData.title}".`,
    linkType: 'case',
    linkId:   caseData.id
  });
}

/**
 * Case closed — notify the assigned investigator (if any).
 */
async function notifyCaseClosed(caseData, closedByName) {
  if (!caseData.assignedInvestigatorId) return;
  await createNotification({
    userId:   caseData.assignedInvestigatorId,
    title:    'Case Closed',
    message:  `Case ${caseData.caseNumber} "${caseData.title}" has been closed by ${closedByName}.`,
    linkType: 'case',
    linkId:   caseData.id
  });
}

/**
 * Case reopened — notify the assigned investigator (if any).
 */
async function notifyCaseReopened(caseData, reopenedByName) {
  if (!caseData.assignedInvestigatorId) return;
  await createNotification({
    userId:   caseData.assignedInvestigatorId,
    title:    'Case Reopened',
    message:  `Case ${caseData.caseNumber} "${caseData.title}" has been reopened by ${reopenedByName}.`,
    linkType: 'case',
    linkId:   caseData.id
  });
}

// =============================================================================
// READ / MANAGE  (REST endpoints)
// =============================================================================

/**
 * Get paginated notifications for the authenticated user.
 */
async function getNotifications(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const pageNum  = typeof page  === 'string' ? parseInt(page,  10) : Number(page);
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);
  const skip = (pageNum - 1) * limitNum;

  const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };

  const [notifications, totalCount, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } })
  ]);

  return {
    notifications,
    unreadCount,
    pagination: {
      currentPage: pageNum,
      totalPages:  Math.ceil(totalCount / limitNum),
      totalCount,
      limit:       limitNum,
      hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
      hasPrevPage: pageNum > 1
    }
  };
}

/**
 * Unread count only — cheap query for the notification bell badge.
 */
async function getUnreadCount(userId) {
  const count = await prisma.notification.count({
    where: { userId, isRead: false }
  });
  return { unreadCount: count };
}

/**
 * Mark a single notification as read.
 * Verifies ownership so users can't mark others' notifications.
 */
async function markAsRead(notificationId, userId) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification) throw new NotFoundError('Notification');
  if (notification.userId !== userId) {
    throw new AuthorizationError('You can only manage your own notifications');
  }

  if (notification.isRead) return notification; // already read — no-op

  return prisma.notification.update({
    where: { id: notificationId },
    data:  { isRead: true, readAt: new Date() }
  });
}

/**
 * Mark ALL unread notifications for a user as read.
 * Returns the number of records updated.
 */
async function markAllAsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data:  { isRead: true, readAt: new Date() }
  });
  return { markedRead: result.count };
}

/**
 * Delete a notification (user can only delete their own).
 */
async function deleteNotification(notificationId, userId) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification) throw new NotFoundError('Notification');
  if (notification.userId !== userId) {
    throw new AuthorizationError('You can only delete your own notifications');
  }

  await prisma.notification.delete({ where: { id: notificationId } });
  return { deleted: true };
}

/**
 * Delete all read notifications for a user (housekeeping).
 */
async function clearReadNotifications(userId) {
  const result = await prisma.notification.deleteMany({
    where: { userId, isRead: true }
  });
  return { deleted: result.count };
}

module.exports = {
  // Event triggers
  notifyEvidenceUploaded,
  notifyEvidenceApproved,
  notifyEvidenceRejected,
  notifyCaseAssigned,
  notifyCaseClosed,
  notifyCaseReopened,
  // REST helpers
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications
};
