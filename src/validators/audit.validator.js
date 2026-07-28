/**
 * Audit Log Validation Schemas
 */

const { z } = require('zod');

// Valid action types matching the Prisma AuditAction enum
const AuditActionEnum = z.enum([
  'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGED',
  'USER_CREATED', 'USER_UPDATED', 'USER_DELETED',
  'CASE_CREATED', 'CASE_UPDATED', 'CASE_ASSIGNED', 'CASE_CLOSED', 'CASE_REOPENED', 'CASE_DELETED',
  'EVIDENCE_UPLOADED', 'EVIDENCE_DOWNLOADED', 'EVIDENCE_APPROVED',
  'EVIDENCE_REJECTED', 'EVIDENCE_DELETED',
  'EVIDENCE_INTEGRITY_CHECK', 'EVIDENCE_INTEGRITY_FAILED',
  'SYSTEM_ERROR'
], { errorMap: () => ({ message: 'Invalid audit action' }) });

// Valid entity types matching the Prisma AuditEntity enum
const AuditEntityEnum = z.enum(['USER', 'CASE', 'EVIDENCE', 'SESSION', 'SYSTEM'], {
  errorMap: () => ({ message: 'Invalid entity type' })
});

/**
 * Query params for listing audit logs
 */
const listAuditLogsQuerySchema = z.object({
  page: z
    .string().optional()
    .transform(v => { const n = v ? parseInt(v, 10) : 1; return Number.isNaN(n) ? 1 : n; })
    .refine(v => v >= 1, { message: 'Page must be at least 1' }),
  limit: z
    .string().optional()
    .transform(v => { const n = v ? parseInt(v, 10) : 50; return Number.isNaN(n) ? 50 : n; })
    .refine(v => v >= 1 && v <= 200, { message: 'Limit must be 1–200' }),

  // Filters
  userId:   z.string().uuid('Invalid userId format').optional(),
  action:   AuditActionEnum.optional(),
  entity:   AuditEntityEnum.optional(),
  entityId: z.string().uuid('Invalid entityId format').optional(),

  // Date range (ISO 8601)
  startDate: z.string().optional()
    .refine(v => !v || !Number.isNaN(Date.parse(v)), { message: 'Invalid startDate' }),
  endDate: z.string().optional()
    .refine(v => !v || !Number.isNaN(Date.parse(v)), { message: 'Invalid endDate' }),

  // Sorting
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

/**
 * Export query params
 */
const exportQuerySchema = z.object({
  format: z.enum(['csv'], { errorMap: () => ({ message: 'format must be csv' }) }).optional().default('csv'),
  startDate: z.string().optional()
    .refine(v => !v || !Number.isNaN(Date.parse(v)), { message: 'Invalid startDate' }),
  endDate: z.string().optional()
    .refine(v => !v || !Number.isNaN(Date.parse(v)), { message: 'Invalid endDate' }),
  userId:   z.string().uuid().optional(),
  action:   AuditActionEnum.optional(),
  entity:   AuditEntityEnum.optional(),
  caseId:   z.string().uuid().optional()
});

/**
 * UUID path param schemas
 */
const evidenceIdParamSchema = z.object({
  evidenceId: z.string().uuid('Invalid evidence ID format')
});

const caseIdParamSchema = z.object({
  caseId: z.string().uuid('Invalid case ID format')
});

const userIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID format')
});

/**
 * Validation middleware factory
 */
function validate(schema, property = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[property]);
    if (!result.success) throw result.error;
    req[property] = result.data;
    next();
  };
}

module.exports = {
  listAuditLogsQuerySchema,
  exportQuerySchema,
  evidenceIdParamSchema,
  caseIdParamSchema,
  userIdParamSchema,
  AuditActionEnum,
  AuditEntityEnum,
  validate
};
