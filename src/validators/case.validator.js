/**
 * Case Validation Schemas
 * 
 * Zod schemas for validating case-related requests.
 * 
 * Key Validations:
 * - Title and description length constraints
 * - Valid status transitions
 * - Priority range (1-5)
 * - UUID format for IDs
 */

const { z } = require('zod');

// =============================================================================
// SHARED SCHEMAS
// =============================================================================

/**
 * Case status enum - must match Prisma schema
 */
const CaseStatusEnum = z.enum(['OPEN', 'CLOSED', 'PENDING', 'ARCHIVED'], {
  errorMap: () => ({ message: 'Status must be OPEN, CLOSED, PENDING, or ARCHIVED' })
});

/**
 * Priority levels: 1 (Critical) to 5 (Low)
 */
const prioritySchema = z
  .number()
  .int('Priority must be an integer')
  .min(1, 'Priority must be at least 1 (Critical)')
  .max(5, 'Priority cannot exceed 5 (Low)');

// =============================================================================
// REQUEST SCHEMAS
// =============================================================================

/**
 * Create Case Schema
 * Required: title
 * Optional: description, priority, assignedInvestigatorId
 */
const createCaseSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title cannot exceed 200 characters')
    .trim(),
  description: z
    .string()
    .max(5000, 'Description cannot exceed 5000 characters')
    .trim()
    .optional(),
  priority: prioritySchema.optional().default(3),
  assignedInvestigatorId: z
    .string()
    .uuid('Invalid investigator ID format')
    .optional()
    .nullable()
});

/**
 * Update Case Schema
 * All fields optional, but at least one must be provided
 */
const updateCaseSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title cannot exceed 200 characters')
    .trim()
    .optional(),
  description: z
    .string()
    .max(5000, 'Description cannot exceed 5000 characters')
    .trim()
    .optional()
    .nullable(),
  priority: prioritySchema.optional(),
  status: CaseStatusEnum.optional()
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

/**
 * Assign Investigator Schema
 */
const assignInvestigatorSchema = z.object({
  investigatorId: z
    .string()
    .uuid('Invalid investigator ID format')
    .nullable()
});

/**
 * Close Case Schema (optional reason)
 */
const closeCaseSchema = z.object({
  reason: z
    .string()
    .max(1000, 'Reason cannot exceed 1000 characters')
    .trim()
    .optional()
});

/**
 * Query Parameters for listing cases
 */
const listCasesQuerySchema = z.object({
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
  status: CaseStatusEnum.optional(),
  priority: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return undefined;
      const num = parseInt(val, 10);
      return Number.isNaN(num) ? undefined : num;
    }),
  assignedTo: z
    .string()
    .uuid('Invalid assignedTo ID format')
    .optional(),
  createdBy: z
    .string()
    .uuid('Invalid createdBy ID format')
    .optional(),
  search: z
    .string()
    .max(100, 'Search query too long')
    .optional(),
  includeDeleted: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  
  // Date range filtering
  createdAfter: z
    .string()
    .datetime({ message: 'Invalid date format for createdAfter' })
    .optional(),
  createdBefore: z
    .string()
    .datetime({ message: 'Invalid date format for createdBefore' })
    .optional(),
  
  // Sorting
  sortBy: z
    .enum(['title', 'caseNumber', 'createdAt', 'updatedAt', 'priority', 'status'])
    .optional()
    .default('createdAt'),
  sortOrder: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc')
});

/**
 * Case ID parameter validation
 */
const caseIdParamSchema = z.object({
  id: z
    .string()
    .uuid('Invalid case ID format')
});

/**
 * Case number parameter validation (for lookup by case number)
 */
const caseNumberParamSchema = z.object({
  caseNumber: z
    .string()
    .regex(/^CASE-\d{4}-\d{5}$/, 'Invalid case number format (expected: CASE-YYYY-NNNNN)')
});

// =============================================================================
// VALIDATION MIDDLEWARE FACTORY
// =============================================================================

/**
 * Creates a validation middleware for a given schema and request property
 */
function validate(schema, property = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[property]);
    
    if (!result.success) {
      throw result.error;
    }
    
    req[property] = result.data;
    next();
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Schemas
  createCaseSchema,
  updateCaseSchema,
  assignInvestigatorSchema,
  closeCaseSchema,
  listCasesQuerySchema,
  caseIdParamSchema,
  caseNumberParamSchema,
  CaseStatusEnum,
  
  // Middleware factory
  validate
};
