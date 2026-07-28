/**
 * User Routes
 * 
 * RESTful endpoints for user management.
 * 
 * Route Design Principles:
 * 1. Use nouns (users) not verbs (getUsers)
 * 2. Use HTTP methods for actions (GET, POST, PUT, DELETE)
 * 3. Use path parameters for resource identification
 * 4. Use query parameters for filtering/pagination
 * 
 * Permission Matrix:
 * | Route                    | Admin | Supervisor | Investigator |
 * |--------------------------|-------|------------|--------------|
 * | GET /users               | ✓     | ✓ (limited)| ✗            |
 * | GET /users/me            | ✓     | ✓          | ✓            |
 * | GET /users/:id           | ✓     | ✗          | Own only     |
 * | POST /users              | ✓     | ✗          | ✗            |
 * | PUT /users/:id           | ✓     | ✗          | Own only     |
 * | PUT /users/me            | ✓     | ✓          | ✓            |
 * | DELETE /users/:id        | ✓     | ✗          | ✗            |
 * | POST /users/:id/restore  | ✓     | ✗          | ✗            |
 * | POST /users/:id/reset-pwd| ✓     | ✗          | ✗            |
 */

const express = require('express');
const router = express.Router();

const userController = require('../controllers/user.controller');
const { authenticate, authorize, selfOrAdmin } = require('../middleware/auth.middleware');
const { 
  validate,
  createUserSchema,
  updateUserSchema,
  selfUpdateSchema,
  adminResetPasswordSchema,
  listUsersQuerySchema,
  userIdParamSchema
} = require('../validators/user.validator');

// =============================================================================
// SWAGGER SCHEMAS
// =============================================================================

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: User's unique identifier
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         name:
 *           type: string
 *           description: User's full name
 *         role:
 *           type: string
 *           enum: [ADMIN, SUPERVISOR, INVESTIGATOR]
 *           description: User's role in the system
 *         createdAt:
 *           type: string
 *           format: date-time
 *         lastLoginAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         deletedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *       example:
 *         id: "550e8400-e29b-41d4-a716-446655440000"
 *         email: "investigator@example.com"
 *         name: "John Smith"
 *         role: "INVESTIGATOR"
 *         createdAt: "2024-01-15T10:30:00Z"
 *         lastLoginAt: "2024-01-20T08:15:00Z"
 *         deletedAt: null
 *
 *     CreateUserRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *         - name
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 8
 *           description: Must contain uppercase, lowercase, number, and special character
 *         name:
 *           type: string
 *           minLength: 2
 *           maxLength: 100
 *         role:
 *           type: string
 *           enum: [ADMIN, SUPERVISOR, INVESTIGATOR]
 *           default: INVESTIGATOR
 *       example:
 *         email: "new.user@example.com"
 *         password: "SecureP@ss123"
 *         name: "New User"
 *         role: "INVESTIGATOR"
 *
 *     UpdateUserRequest:
 *       type: object
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         name:
 *           type: string
 *           minLength: 2
 *           maxLength: 100
 *         role:
 *           type: string
 *           enum: [ADMIN, SUPERVISOR, INVESTIGATOR]
 *       example:
 *         name: "Updated Name"
 *         role: "SUPERVISOR"
 *
 *     UserListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/User'
 *         pagination:
 *           type: object
 *           properties:
 *             currentPage:
 *               type: integer
 *             totalPages:
 *               type: integer
 *             totalCount:
 *               type: integer
 *             limit:
 *               type: integer
 *             hasNextPage:
 *               type: boolean
 *             hasPrevPage:
 *               type: boolean
 *
 *     UserStatistics:
 *       type: object
 *       properties:
 *         total:
 *           type: integer
 *         active:
 *           type: integer
 *         deleted:
 *           type: integer
 *         byRole:
 *           type: object
 *           properties:
 *             ADMIN:
 *               type: integer
 *             SUPERVISOR:
 *               type: integer
 *             INVESTIGATOR:
 *               type: integer
 */

// =============================================================================
// ROUTES
// =============================================================================

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: Get all users
 *     description: Retrieve a paginated list of users. Admin can see all, Supervisor can see investigators.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [ADMIN, SUPERVISOR, INVESTIGATOR]
 *         description: Filter by role
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in name or email
 *       - in: query
 *         name: includeDeleted
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include soft-deleted users
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, email, createdAt, lastLoginAt, role]
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort direction
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserListResponse'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 */
router.get('/',
  authenticate,
  authorize(['ADMIN', 'SUPERVISOR']),
  validate(listUsersQuerySchema, 'query'),
  userController.getUsers
);

/**
 * @swagger
 * /api/v1/users/statistics:
 *   get:
 *     summary: Get user statistics
 *     description: Get aggregate statistics about users in the system
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserStatistics'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin only
 */
router.get('/statistics',
  authenticate,
  authorize('ADMIN'),
  userController.getStatistics
);

/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Get current user's profile
 *     description: Get the authenticated user's own profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 */
router.get('/me',
  authenticate,
  userController.getMe
);

/**
 * @swagger
 * /api/v1/users/me:
 *   put:
 *     summary: Update current user's profile
 *     description: Update the authenticated user's own profile. Cannot change own role.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *             example:
 *               name: "My New Name"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       409:
 *         description: Email already taken
 */
router.put('/me',
  authenticate,
  validate(selfUpdateSchema, 'body'),
  userController.updateMe
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   get:
 *     summary: Get a user by ID
 *     description: Admin can get any user, others can only get their own profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Can only access own profile
 *       404:
 *         description: User not found
 */
router.get('/:id',
  authenticate,
  validate(userIdParamSchema, 'params'),
  selfOrAdmin('id'),
  userController.getUser
);

/**
 * @swagger
 * /api/v1/users:
 *   post:
 *     summary: Create a new user
 *     description: Create a new user account. Admin only.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
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
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin only
 *       409:
 *         description: Email already exists
 */
router.post('/',
  authenticate,
  authorize('ADMIN'),
  validate(createUserSchema, 'body'),
  userController.createUser
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   put:
 *     summary: Update a user
 *     description: Admin can update any user including role. Users can update their own profile (except role).
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized or cannot change own role
 *       404:
 *         description: User not found
 *       409:
 *         description: Email already taken
 */
router.put('/:id',
  authenticate,
  validate(userIdParamSchema, 'params'),
  selfOrAdmin('id'),
  validate(updateUserSchema, 'body'),
  userController.updateUser
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   delete:
 *     summary: Delete a user (soft delete)
 *     description: Soft delete a user. Admin only. Cannot delete own account.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     deletedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin only or cannot delete self
 *       404:
 *         description: User not found
 */
router.delete('/:id',
  authenticate,
  authorize('ADMIN'),
  validate(userIdParamSchema, 'params'),
  userController.deleteUser
);

/**
 * @swagger
 * /api/v1/users/{id}/restore:
 *   post:
 *     summary: Restore a deleted user
 *     description: Restore a soft-deleted user. Admin only.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User restored successfully
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin only
 *       404:
 *         description: User not found
 *       409:
 *         description: User is not deleted
 */
router.post('/:id/restore',
  authenticate,
  authorize('ADMIN'),
  validate(userIdParamSchema, 'params'),
  userController.restoreUser
);

/**
 * @swagger
 * /api/v1/users/{id}/reset-password:
 *   post:
 *     summary: Reset a user's password
 *     description: Admin resets a user's password. The user will need to login with the new password.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *                 description: New password (must meet complexity requirements)
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin only
 *       404:
 *         description: User not found
 */
router.post('/:id/reset-password',
  authenticate,
  authorize('ADMIN'),
  validate(userIdParamSchema, 'params'),
  validate(adminResetPasswordSchema, 'body'),
  userController.resetPassword
);

module.exports = router;
