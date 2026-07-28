/**
 * Authentication Routes
 * 
 * Handles user authentication: register, login, logout, token refresh
 * These routes have stricter rate limiting applied in app.js
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { 
  validate, 
  loginSchema, 
  registerSchema, 
  refreshTokenSchema,
  changePasswordSchema 
} = require('../validators/auth.validator');

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Creates a new user account. Only Admins can register new users.
 *       
 *       Password Requirements:
 *       - Minimum 8 characters
 *       - At least one uppercase letter
 *       - At least one lowercase letter
 *       - At least one number
 *       - At least one special character
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: User registered successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         email:
 *                           type: string
 *                         name:
 *                           type: string
 *                         role:
 *                           type: string
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       409:
 *         description: User with this email already exists
 */
router.post(
  '/register',
  authenticate,
  authorize('ADMIN'),
  validate(registerSchema),
  authController.register
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login to the system
 *     tags: [Authentication]
 *     description: |
 *       Authenticates a user and returns access and refresh tokens.
 *       
 *       Token Usage:
 *       - Access Token: Include in Authorization header as "Bearer {token}"
 *       - Refresh Token: Use with /auth/refresh to get new tokens
 *       
 *       Token Lifetimes:
 *       - Access Token: 15 minutes
 *       - Refresh Token: 7 days
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               message: Invalid email or password
 */
router.post(
  '/login',
  validate(loginSchema),
  authController.login
);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout from the system
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Invalidates the current refresh token, effectively logging out the user.
 *       The access token will remain valid until it expires (15 min max).
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Optional refresh token to invalidate
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post(
  '/logout',
  authenticate,
  authController.logout
);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 *     description: |
 *       Gets a new access token using a valid refresh token.
 *       Also returns a new refresh token (token rotation for security).
 *       
 *       The old refresh token is invalidated after use.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: New tokens generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Tokens refreshed successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                     expiresIn:
 *                       type: string
 *                       example: 15m
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post(
  '/refresh',
  validate(refreshTokenSchema),
  authController.refresh
);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     description: Returns the profile of the currently authenticated user
 *     responses:
 *       200:
 *         description: Profile retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         email:
 *                           type: string
 *                         name:
 *                           type: string
 *                         role:
 *                           type: string
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                         lastLoginAt:
 *                           type: string
 *                           format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/me',
  authenticate,
  authController.getProfile
);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change password
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Changes the user's password. Requires the current password.
 *       All existing sessions (refresh tokens) will be invalidated.
 *       
 *       Password Requirements:
 *       - Minimum 8 characters
 *       - At least one uppercase letter
 *       - At least one lowercase letter
 *       - At least one number
 *       - At least one special character
 *       - Must be different from current password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *               - confirmPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *               confirmPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Current password is incorrect
 */
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  authController.changePassword
);

module.exports = router;
