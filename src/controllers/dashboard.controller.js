/**
 * Dashboard Controller
 */

const dashboardService = require('../services/dashboard.service');

/**
 * GET /api/v1/dashboard/stats
 * Complete snapshot — cases, evidence, users, recent items
 */
async function getStats(req, res) {
  const data = await dashboardService.getOverallStats(req.user);

  res.json({
    success: true,
    message: 'Dashboard statistics retrieved successfully',
    data
  });
}

/**
 * GET /api/v1/dashboard/recent-uploads
 */
async function getRecentUploads(req, res) {
  const limit = req.query.limit || 10;
  const data = await dashboardService.getRecentUploads(req.user, limit);

  res.json({
    success: true,
    message: 'Recent uploads retrieved successfully',
    data
  });
}

/**
 * GET /api/v1/dashboard/monthly-uploads
 */
async function getMonthlyUploads(req, res) {
  const months = req.query.months || 12;
  const data = await dashboardService.getMonthlyUploads(req.user, months);

  res.json({
    success: true,
    message: 'Monthly upload statistics retrieved successfully',
    data
  });
}

/**
 * GET /api/v1/dashboard/activity
 */
async function getRecentActivity(req, res) {
  const limit = req.query.limit || 20;
  const data = await dashboardService.getRecentActivity(req.user, limit);

  res.json({
    success: true,
    message: 'Recent activity retrieved successfully',
    data
  });
}

module.exports = {
  getStats,
  getRecentUploads,
  getMonthlyUploads,
  getRecentActivity
};
