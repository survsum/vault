/**
 * User Validation Schemas
 * 
 * Zod schemas for validating user-related requests.
 * 
 * Validation happens BEFORE data reaches the service layer,
 * ensuring only valid data enters your business logic.
 * 
 * Key Validations:
 * - Email format
 * - Password strength (for creation/password change)
 * - Role must be valid enum value
 * - Name length constraints
 */

const { z } = require('zod');

// =============================================================================
// SHARED SCHEMAS
// =============================================================================

/**
 * Valid roles in the system
 * Must match Prisma Role enum
 */
const RoleEnum = z.enum(['ADMIN', 'SUPERVISOR', 'INVESTIGATOR'], {
  errorMap: () => ({ message: 'Role must be ADMIN, SUPERVISOR, or INVESTIGATOR' })
});

/**
 * Strong password requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// =============================================================================
// REQUEST SCHEMAS
// =============================================================================

/**
 * Create User Schema (Admin creating new user)
 * All fields required for new user creation
 */
const createUserSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  password: passwordSchema,
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters')
    .trim(),
  role: RoleEnum.default('INVESTIGATOR')
});

/**
 * Update User Schema (Partial update)
 * All fields optional, but at least one must be provided
 * 
 * Note: Password update is handled separately via change-password endpoint
 */
const updateUserSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase()
    .trim()
    .optional(),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters')
    .trim()
    .optional(),
  role: RoleEnum.optional()
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

/**
 * Self Update Schema (User updating their own profile)
 * Users cannot change their own role
 */
const selfUpdateSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase()
    .trim()
    .optional(),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters')
    .trim()
    .optional()
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

/**
 * Admin Reset Password Schema
 * When admin resets a user's password
 */
const adminResetPasswordSchema = z.object({
  newPassword: passwordSchema
});

/**
 * Query Parameters for listing users
 * Pagination, filtering, and sorting
 */
const listUsersQuerySchema = z.object({
  // Pagination
  page: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 1;
      return Number.isNaN(num) ? 1 : num;
    })
    .refine((val) => val >= 1, { message: 'Page must be at least 1' }),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 10;
      return Number.isNaN(num) ? 10 : num;
    })
    .refine((val) => val >= 1 && val <= 100, { 
      message: 'Limit must be between 1 and 100' 
    }),
  
  // Filtering
  role: RoleEnum.optional(),
  search: z
    .string()
    .max(100, 'Search query too long')
    .optional(),
  includeDeleted: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  
  // Sorting
  sortBy: z
    .enum(['name', 'email', 'createdAt', 'lastLoginAt', 'role'])
    .optional()
    .default('createdAt'),
  sortOrder: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc')
});

/**
 * User ID parameter validation
 * Ensures the ID is a valid UUID
 */
const userIdParamSchema = z.object({
  id: z
    .string()
    .uuid('Invalid user ID format')
});

// =============================================================================
// VALIDATION MIDDLEWARE FACTORY
// =============================================================================

/**
 * Creates a validation middleware for a given schema and request property
 * 
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware
 * 
 * @example
 * router.post('/users', validate(createUserSchema, 'body'), controller.create);
 */
function validate(schema, property = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[property]);
    
    if (!result.success) {
      // Throw the Zod error to be caught by error middleware
      throw result.error;
    }
    
    // Replace the request property with validated & transformed data
    req[property] = result.data;
    next();
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Schemas
  createUserSchema,
  updateUserSchema,
  selfUpdateSchema,
  adminResetPasswordSchema,
  listUsersQuerySchema,
  userIdParamSchema,
  RoleEnum,
  
  // Middleware factory
  validate
};
