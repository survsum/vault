/**
 * User Controller
 * 
 * Handles HTTP requests for user management.
 * 
 * Controller Responsibilities:
 * - Extract data from requests
 * - Call appropriate service methods
 * - Format and send responses
 * 
 * The controller is a thin layer that:
 * 1. Does NOT contain business logic
 * 2. Does NOT access the database directly
 * 3. Does NOT handle errors (middleware does that)
 */

const userService = require('../services/user.service');
const { logger } = require('../utils/logger');

/**
 * Get all users with pagination and filtering
 * 
 * @route GET /api/v1/users
 * @access Admin, Supervisor (Supervisor gets limited info)
 */
async function getUsers(req, res) {
  const result = await userService.getUsers(req.query);
  
  res.json({
    success: true,
    message: 'Users retrieved successfully',
    data: result.users,
    pagination: result.pagination
  });
}

/**
 * Get a single user by ID
 * 
 * @route GET /api/v1/users/:id
 * @access Admin (any user) or Self
 */
async function getUser(req, res) {
  const { id } = req.params;
  
  const user = await userService.getUserById(id);
  
  res.json({
    success: true,
    message: 'User retrieved successfully',
    data: user
  });
}

/**
 * Get current user's profile
 * 
 * @route GET /api/v1/users/me
 * @access Any authenticated user
 */
async function getMe(req, res) {
  const user = await userService.getUserById(req.user.id);
  
  res.json({
    success: true,
    message: 'Profile retrieved successfully',
    data: user
  });
}

/**
 * Create a new user
 * 
 * @route POST /api/v1/users
 * @access Admin only
 */
async function createUser(req, res) {
  const context = {
    adminId: req.user.id,
    ipAddress: req.ip
  };
  
  const user = await userService.createUser(req.body, context);
  
  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: user
  });
}

/**
 * Update a user
 * 
 * @route PUT /api/v1/users/:id
 * @access Admin (any user) or Self (limited fields)
 */
async function updateUser(req, res) {
  const { id } = req.params;
  
  const context = {
    requesterId: req.user.id,
    requesterRole: req.user.role,
    ipAddress: req.ip
  };
  
  const user = await userService.updateUser(id, req.body, context);
  
  res.json({
    success: true,
    message: 'User updated successfully',
    data: user
  });
}

/**
 * Update current user's profile
 * 
 * @route PUT /api/v1/users/me
 * @access Any authenticated user
 */
async function updateMe(req, res) {
  const context = {
    requesterId: req.user.id,
    requesterRole: req.user.role,
    ipAddress: req.ip
  };
  
  // Self-update - user can only update their own non-role fields
  const user = await userService.updateUser(req.user.id, req.body, context);
  
  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: user
  });
}

/**
 * Delete a user (soft delete)
 * 
 * @route DELETE /api/v1/users/:id
 * @access Admin only
 */
async function deleteUser(req, res) {
  const { id } = req.params;
  
  const context = {
    adminId: req.user.id,
    ipAddress: req.ip
  };
  
  const user = await userService.deleteUser(id, context);
  
  res.json({
    success: true,
    message: 'User deleted successfully',
    data: { id: user.id, deletedAt: user.deletedAt }
  });
}

/**
 * Restore a deleted user
 * 
 * @route POST /api/v1/users/:id/restore
 * @access Admin only
 */
async function restoreUser(req, res) {
  const { id } = req.params;
  
  const context = {
    adminId: req.user.id,
    ipAddress: req.ip
  };
  
  const user = await userService.restoreUser(id, context);
  
  res.json({
    success: true,
    message: 'User restored successfully',
    data: user
  });
}

/**
 * Admin reset a user's password
 * 
 * @route POST /api/v1/users/:id/reset-password
 * @access Admin only
 */
async function resetPassword(req, res) {
  const { id } = req.params;
  const { newPassword } = req.body;
  
  const context = {
    adminId: req.user.id,
    ipAddress: req.ip
  };
  
  const user = await userService.adminResetPassword(id, newPassword, context);
  
  res.json({
    success: true,
    message: 'Password reset successfully',
    data: { id: user.id, email: user.email }
  });
}

/**
 * Get user statistics
 * 
 * @route GET /api/v1/users/statistics
 * @access Admin only
 */
async function getStatistics(req, res) {
  const statistics = await userService.getUserStatistics();
  
  res.json({
    success: true,
    message: 'User statistics retrieved successfully',
    data: statistics
  });
}

module.exports = {
  getUsers,
  getUser,
  getMe,
  createUser,
  updateUser,
  updateMe,
  deleteUser,
  restoreUser,
  resetPassword,
  getStatistics
};
