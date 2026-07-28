/**
 * Evidence Validation Schemas
 */

const { z } = require('zod');

const EvidenceStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED'], {
  errorMap: () => ({ message: 'Status must be PENDING, APPROVED, or REJECTED' })
});

/**
 * Upload evidence body schema
 * (file itself is validated by multer middleware)
 */
const uploadEvidenceSchema = z.object({
  caseId: z
    .string()
    .uuid('Invalid case ID format'),
  description: z
    .string()
    .max(2000, 'Description cannot exceed 2000 characters')
    .trim()
    .optional()
});

/**
 * Reject evidence schema — reason is required
 */
const rejectEvidenceSchema = z.object({
  reason: z
    .string()
    .min(3, 'Rejection reason must be at least 3 characters')
    .max(500, 'Rejection reason cannot exceed 500 characters')
    .trim()
});

/**
 * Query params for listing evidence
 */
const listEvidenceQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => {
      const n = val ? parseInt(val, 10) : 1;
      return Number.isNaN(n) ? 1 : n;
    })
    .refine((val) => val >= 1, { message: 'Page must be at least 1' }),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const n = val ? parseInt(val, 10) : 10;
      return Number.isNaN(n) ? 10 : n;
    })
    .refine((val) => val >= 1 && val <= 100, { message: 'Limit must be between 1 and 100' }),
  caseId: z
    .string()
    .uuid('Invalid case ID format')
    .optional(),
  status: EvidenceStatusEnum.optional(),
  uploadedBy: z
    .string()
    .uuid('Invalid uploadedBy ID format')
    .optional(),
  fileType: z
    .string()
    .max(100)
    .optional(),
  sortBy: z
    .enum(['uploadedAt', 'fileSize', 'originalName', 'status'])
    .optional()
    .default('uploadedAt'),
  sortOrder: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc')
});

/**
 * Evidence ID param
 */
const evidenceIdParamSchema = z.object({
  id: z
    .string()
    .uuid('Invalid evidence ID format')
});

/**
 * Validation middleware factory
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

module.exports = {
  uploadEvidenceSchema,
  rejectEvidenceSchema,
  listEvidenceQuerySchema,
  evidenceIdParamSchema,
  EvidenceStatusEnum,
  validate
};
