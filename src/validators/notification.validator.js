/**
 * Notification Validation Schemas
 */

const { z } = require('zod');

const listNotificationsQuerySchema = z.object({
  page: z
    .string().optional()
    .transform(v => { const n = v ? parseInt(v, 10) : 1; return Number.isNaN(n) ? 1 : n; })
    .refine(v => v >= 1, { message: 'Page must be at least 1' }),
  limit: z
    .string().optional()
    .transform(v => { const n = v ? parseInt(v, 10) : 20; return Number.isNaN(n) ? 20 : n; })
    .refine(v => v >= 1 && v <= 100, { message: 'Limit must be 1–100' }),
  unreadOnly: z
    .string().optional()
    .transform(v => v === 'true')
});

const notificationIdParamSchema = z.object({
  id: z.string().uuid('Invalid notification ID format')
});

function validate(schema, property = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[property]);
    if (!result.success) throw result.error;
    req[property] = result.data;
    next();
  };
}

module.exports = {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  validate
};
