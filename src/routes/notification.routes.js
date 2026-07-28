/**
 * Notification Routes
 *
 * All endpoints are for the authenticated user's own notifications only —
 * there is no admin endpoint to read another user's notifications.
 */

const express = require('express');
const router = express.Router();

const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');
const {
  validate,
  listNotificationsQuerySchema,
  notificationIdParamSchema
} = require('../validators/notification.validator');

// =============================================================================
// SWAGGER SCHEMAS
// =============================================================================

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         title:
 *           type: string
 *         message:
 *           type: string
 *         linkType:
 *           type: string
 *           nullable: true
 *           example: "evidence"
 *           description: "Type of linked entity: case, evidence"
 *         linkId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           description: ID of the linked entity
 *         isRead:
 *           type: boolean
 *         readAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 */

// =============================================================================
// ROUTES
// =============================================================================

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get notifications for the current user
 *     description: Returns paginated notifications for the authenticated user, newest first.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean, default: false }
 *         description: Return only unread notifications
 *     responses:
 *       200:
 *         description: Notifications list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 unreadCount: { type: integer }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Notification' }
 *                 pagination: { type: object }
 */
router.get('/',
  authenticate,
  validate(listNotificationsQuerySchema, 'query'),
  notificationController.getNotifications
);

/**
 * @swagger
 * /api/v1/notifications/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     description: Cheap endpoint for the notification bell badge — returns only the count.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     unreadCount: { type: integer }
 */
router.get('/unread-count',
  authenticate,
  notificationController.getUnreadCount
);

/**
 * @swagger
 * /api/v1/notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     markedRead: { type: integer }
 */
router.put('/read-all',
  authenticate,
  notificationController.markAllAsRead
);

/**
 * @swagger
 * /api/v1/notifications/clear-read:
 *   delete:
 *     summary: Delete all read notifications
 *     description: Housekeeping — removes all notifications the user has already read.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Read notifications cleared
 */
router.delete('/clear-read',
  authenticate,
  notificationController.clearReadNotifications
);

/**
 * @swagger
 * /api/v1/notifications/{id}/read:
 *   put:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       403:
 *         description: Cannot mark another user's notification
 *       404:
 *         description: Notification not found
 */
router.put('/:id/read',
  authenticate,
  validate(notificationIdParamSchema, 'params'),
  notificationController.markAsRead
);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notification deleted
 *       403:
 *         description: Cannot delete another user's notification
 *       404:
 *         description: Notification not found
 */
router.delete('/:id',
  authenticate,
  validate(notificationIdParamSchema, 'params'),
  notificationController.deleteNotification
);

module.exports = router;
