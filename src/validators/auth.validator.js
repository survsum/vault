/**
 * Authentication Validation Schemas
 * 
 * Using Zod for runtime validation because:
 * 1. Type-safe validation
 * 2. Automatic TypeScript type inference
 * 3. Detailed error messages
 * 4. Easy to compose and extend
 * 
 * Why validate on the server?
 * - Client validation can be bypassed
 * - Defense in depth
 * - Consistent validation rules
 */

const { z } = require('zod');

/**
 * Password validation rules:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be less than 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

/**
 * Email validation
 */
const emailSchema = z
  .string()
  .email('Invalid email format')
  .max(255, 'Email must be less than 255 characters')
  .transform((email) => email.toLowerCase().trim());

/**
 * Name validation
 */
const nameSchema = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must be less than 100 characters')
  .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes')
  .transform((name) => name.trim());

/**
 * Role validation - must be a valid role enum
 */
const roleSchema = z.enum(['ADMIN', 'SUPERVISOR', 'INVESTIGATOR'], {
  errorMap: () => ({ message: 'Role must be ADMIN, SUPERVISOR, or INVESTIGATOR' })
});

/**
 * Login request validation
 */
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required')
});

/**
 * Register request validation
 * Only admins can register new users, but we still validate the input
 */
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
  name: nameSchema,
  role: roleSchema.optional().default('INVESTIGATOR')
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

/**
 * Refresh token request validation
 */
const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

/**
 * Change password request validation
 */
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'New password must be different from current password',
  path: ['newPassword']
});

/**
 * Validate request body against a schema
 * Returns the validated data or throws a ZodError
 * 
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      // Parse and validate - throws on error
      const validated = schema.parse(req.body);
      
      // Replace body with validated (and transformed) data
      req.body = validated;
      
      next();
    } catch (error) {
      // Zod errors are passed to error handler
      next(error);
    }
  };
}

/**
 * @swagger
 * components:
 *   schemas:
 *     LoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: admin@evidence-vault.com
 *         password:
 *           type: string
 *           format: password
 *           example: Admin@123456
 *     
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *         - confirmPassword
 *         - name
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: newuser@evidence-vault.com
 *         password:
 *           type: string
 *           format: password
 *           minLength: 8
 *           example: SecurePass@123
 *           description: Must contain uppercase, lowercase, number, and special character
 *         confirmPassword:
 *           type: string
 *           format: password
 *           example: SecurePass@123
 *         name:
 *           type: string
 *           example: John Doe
 *         role:
 *           type: string
 *           enum: [ADMIN, SUPERVISOR, INVESTIGATOR]
 *           default: INVESTIGATOR
 *     
 *     RefreshTokenRequest:
 *       type: object
 *       required:
 *         - refreshToken
 *       properties:
 *         refreshToken:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Login successful
 *         data:
 *           type: object
 *           properties:
 *             accessToken:
 *               type: string
 *               description: Short-lived JWT for API access
 *             refreshToken:
 *               type: string
 *               description: Long-lived token for getting new access tokens
 *             user:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 email:
 *                   type: string
 *                 name:
 *                   type: string
 *                 role:
 *                   type: string
 */

module.exports = {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  changePasswordSchema,
  passwordSchema,
  emailSchema,
  nameSchema,
  roleSchema,
  validate
};
