/**
 * Notification Controller
 */

const notificationService = require('../services/notification.service');

/**
 * GET /api/v1/notifications
 */
async function getNotifications(req, res) {
  const result = await notificationService.getNotifications(req.user.id, req.query);
  res.json({
    success: true,
    message: 'Notifications retrieved successfully',
    data: result.notifications,
    unreadCount: result.unreadCount,
    pagination: result.pagination
  });
}

/**
 * GET /api/v1/notifications/unread-count
 */
async function getUnreadCount(req, res) {
  const result = await notificationService.getUnreadCount(req.user.id);
  res.json({ success: true, data: result });
}

/**
 * PUT /api/v1/notifications/:id/read
 */
async function markAsRead(req, res) {
  const notification = await notificationService.markAsRead(req.params.id, req.user.id);
  res.json({ success: true, message: 'Notification marked as read', data: notification });
}

/**
 * PUT /api/v1/notifications/read-all
 */
async function markAllAsRead(req, res) {
  const result = await notificationService.markAllAsRead(req.user.id);
  res.json({ success: true, message: `${result.markedRead} notification(s) marked as read`, data: result });
}

/**
 * DELETE /api/v1/notifications/:id
 */
async function deleteNotification(req, res) {
  const result = await notificationService.deleteNotification(req.params.id, req.user.id);
  res.json({ success: true, message: 'Notification deleted', data: result });
}

/**
 * DELETE /api/v1/notifications/clear-read
 */
async function clearReadNotifications(req, res) {
  const result = await notificationService.clearReadNotifications(req.user.id);
  res.json({ success: true, message: `${result.deleted} read notification(s) cleared`, data: result });
}

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications
};
