/**
 * Dashboard Routes
 *
 * All authenticated users can access the dashboard.
 * Data is automatically scoped by role:
 *   ADMIN / SUPERVISOR  → system-wide
 *   INVESTIGATOR        → their assigned cases only
 */

const express = require('express');
const router = express.Router();

const dashboardController = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');

// =============================================================================
// SWAGGER SCHEMAS
// =============================================================================

/**
 * @swagger
 * components:
 *   schemas:
 *     DashboardStats:
 *       type: object
 *       properties:
 *         cases:
 *           type: object
 *           properties:
 *             total: { type: integer }
 *             open: { type: integer }
 *             closed: { type: integer }
 *             pending: { type: integer }
 *             archived: { type: integer }
 *         evidence:
 *           type: object
 *           properties:
 *             total: { type: integer }
 *             pending: { type: integer }
 *             approved: { type: integer }
 *             rejected: { type: integer }
 *             pendingReview: { type: integer }
 *             totalStorageBytes: { type: string }
 *             totalStorageFormatted: { type: string, example: "1.2 GB" }
 *         users:
 *           type: object
 *           nullable: true
 *           description: null for investigators
 *           properties:
 *             total: { type: integer }
 *             admin: { type: integer }
 *             supervisor: { type: integer }
 *             investigator: { type: integer }
 *         recentCases:
 *           type: array
 *           items: { type: object }
 *         recentUploads:
 *           type: array
 *           items: { type: object }
 *
 *     MonthlyUpload:
 *       type: object
 *       properties:
 *         month:
 *           type: string
 *           example: "2024-01"
 *         uploads:
 *           type: integer
 *         totalSize:
 *           type: string
 *           description: Total bytes as string
 *         totalSizeFormatted:
 *           type: string
 *           example: "45.2 MB"
 */

// =============================================================================
// ROUTES
// =============================================================================

/**
 * @swagger
 * /api/v1/dashboard/stats:
 *   get:
 *     summary: Overall dashboard statistics
 *     description: |
 *       Single call that returns a complete snapshot.
 *       Role-scoped: investigators only see data from their assigned cases.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/DashboardStats' }
 *       401:
 *         description: Not authenticated
 */
router.get('/stats',
  authenticate,
  dashboardController.getStats
);

/**
 * @swagger
 * /api/v1/dashboard/recent-uploads:
 *   get:
 *     summary: Recent evidence uploads
 *     description: Latest evidence uploads with full metadata
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 50 }
 *         description: Number of uploads to return
 *     responses:
 *       200:
 *         description: Recent uploads list
 */
router.get('/recent-uploads',
  authenticate,
  dashboardController.getRecentUploads
);

/**
 * @swagger
 * /api/v1/dashboard/monthly-uploads:
 *   get:
 *     summary: Monthly upload statistics (chart data)
 *     description: |
 *       Returns upload counts and total storage per month.
 *       Every month in the range is present (missing months have count=0),
 *       making this suitable for direct use in line/bar charts.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: months
 *         schema: { type: integer, default: 12, maximum: 24 }
 *         description: How many months back to include
 *     responses:
 *       200:
 *         description: Monthly upload data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/MonthlyUpload' }
 */
router.get('/monthly-uploads',
  authenticate,
  dashboardController.getMonthlyUploads
);

/**
 * @swagger
 * /api/v1/dashboard/activity:
 *   get:
 *     summary: Recent system activity feed
 *     description: |
 *       Live activity feed from the audit log.
 *       Admin/Supervisor see system-wide activity.
 *       Investigators see only their own activity.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Recent activity
 */
router.get('/activity',
  authenticate,
  dashboardController.getRecentActivity
);

module.exports = router;
