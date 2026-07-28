/**
 * Dashboard Service
 *
 * Aggregates data from multiple tables for the dashboard.
 *
 * Performance note:
 * All independent queries run in parallel via Promise.all() — so a dashboard
 * with 8 independent DB calls takes roughly the time of the slowest single
 * query, not the sum of all queries.
 *
 * Role scoping:
 * - ADMIN      → system-wide numbers
 * - SUPERVISOR → system-wide numbers (same as admin for dashboard)
 * - INVESTIGATOR → numbers scoped to their assigned cases only
 */

const { prisma } = require('../config/database');
const { formatFileSize } = require('../utils/file.util');

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build a where clause restricted to a specific investigator's cases.
 * Returns {} for admin/supervisor (no restriction).
 */
async function buildEvidenceWhere(user) {
  if (user.role !== 'INVESTIGATOR') return { deletedAt: null };

  const assignedCases = await prisma.case.findMany({
    where: { assignedInvestigatorId: user.id, deletedAt: null },
    select: { id: true }
  });

  return {
    deletedAt: null,
    caseId: { in: assignedCases.map(c => c.id) }
  };
}

function buildCaseWhere(user) {
  if (user.role !== 'INVESTIGATOR') return { deletedAt: null };
  return { deletedAt: null, assignedInvestigatorId: user.id };
}

// =============================================================================
// MAIN STATS
// =============================================================================

/**
 * Overall summary statistics — single call that the home dashboard uses.
 *
 * @param {Object} user - Authenticated user
 * @returns {Promise<Object>} Complete stats snapshot
 */
async function getOverallStats(user) {
  const caseWhere    = buildCaseWhere(user);
  const evidenceBaseWhere = await buildEvidenceWhere(user);

  // Run every independent query at the same time
  const [
    // Cases
    totalCases,
    casesByStatus,

    // Evidence
    totalEvidence,
    evidenceByStatus,
    totalStorageRaw,

    // Users (admin/supervisor only — meaningful system-wide)
    totalUsers,
    usersByRole,

    // Pending reviews needing attention
    pendingEvidence,

    // Recent cases
    recentCases,

    // Recent evidence uploads
    recentUploads
  ] = await Promise.all([
    // 1. total cases
    prisma.case.count({ where: caseWhere }),

    // 2. cases grouped by status
    prisma.case.groupBy({
      by: ['status'],
      where: caseWhere,
      _count: true
    }),

    // 3. total evidence
    prisma.evidence.count({ where: evidenceBaseWhere }),

    // 4. evidence grouped by status
    prisma.evidence.groupBy({
      by: ['status'],
      where: evidenceBaseWhere,
      _count: true
    }),

    // 5. total storage used — sum of all file sizes
    prisma.evidence.aggregate({
      where: evidenceBaseWhere,
      _sum: { fileSize: true }
    }),

    // 6. total active users (admin/supervisor sees all)
    user.role !== 'INVESTIGATOR'
      ? prisma.user.count({ where: { deletedAt: null } })
      : Promise.resolve(null),

    // 7. users grouped by role
    user.role !== 'INVESTIGATOR'
      ? prisma.user.groupBy({
          by: ['role'],
          where: { deletedAt: null },
          _count: true
        })
      : Promise.resolve([]),

    // 8. pending evidence count (for the "needs review" badge)
    prisma.evidence.count({
      where: { ...evidenceBaseWhere, status: 'PENDING' }
    }),

    // 9. recent 5 cases
    prisma.case.findMany({
      where: caseWhere,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        assignedInvestigator: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    }),

    // 10. recent 5 evidence uploads
    prisma.evidence.findMany({
      where: evidenceBaseWhere,
      select: {
        id: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        status: true,
        uploadedAt: true,
        uploadedBy: { select: { name: true } },
        case: { select: { caseNumber: true, title: true } }
      },
      orderBy: { uploadedAt: 'desc' },
      take: 5
    })
  ]);

  // Format BigInt totals safely
  const totalStorageBytes = totalStorageRaw._sum.fileSize
    ? BigInt(totalStorageRaw._sum.fileSize)
    : BigInt(0);

  const caseStatusMap = casesByStatus.reduce((acc, g) => {
    acc[g.status.toLowerCase()] = g._count;
    return acc;
  }, {});

  const evidenceStatusMap = evidenceByStatus.reduce((acc, g) => {
    acc[g.status.toLowerCase()] = g._count;
    return acc;
  }, {});

  const userRoleMap = usersByRole.reduce((acc, g) => {
    acc[g.role.toLowerCase()] = g._count;
    return acc;
  }, {});

  return {
    cases: {
      total: totalCases,
      open:     caseStatusMap.open     || 0,
      closed:   caseStatusMap.closed   || 0,
      pending:  caseStatusMap.pending  || 0,
      archived: caseStatusMap.archived || 0
    },
    evidence: {
      total:    totalEvidence,
      pending:  evidenceStatusMap.pending  || 0,
      approved: evidenceStatusMap.approved || 0,
      rejected: evidenceStatusMap.rejected || 0,
      pendingReview: pendingEvidence,
      totalStorageBytes: totalStorageBytes.toString(),
      totalStorageFormatted: formatFileSize(totalStorageBytes)
    },
    users: totalUsers !== null ? {
      total:        totalUsers,
      admin:        userRoleMap.admin        || 0,
      supervisor:   userRoleMap.supervisor   || 0,
      investigator: userRoleMap.investigator || 0
    } : null,
    recentCases,
    recentUploads: recentUploads.map(e => ({
      ...e,
      fileSize: e.fileSize.toString(),
      fileSizeFormatted: formatFileSize(e.fileSize)
    }))
  };
}

// =============================================================================
// RECENT UPLOADS
// =============================================================================

/**
 * Recent evidence uploads with optional limit.
 * Same role-scoping as the main stats.
 */
async function getRecentUploads(user, limit = 10) {
  const limitNum = Math.min(typeof limit === 'string' ? parseInt(limit, 10) : Number(limit), 50);
  const where = await buildEvidenceWhere(user);

  const uploads = await prisma.evidence.findMany({
    where,
    select: {
      id: true,
      originalName: true,
      fileType: true,
      fileSize: true,
      sha256Hash: true,
      status: true,
      description: true,
      uploadedAt: true,
      uploadedBy: { select: { id: true, name: true, email: true } },
      case: { select: { id: true, caseNumber: true, title: true } }
    },
    orderBy: { uploadedAt: 'desc' },
    take: limitNum
  });

  return uploads.map(e => ({
    ...e,
    fileSize: e.fileSize.toString(),
    fileSizeFormatted: formatFileSize(e.fileSize)
  }));
}

// =============================================================================
// MONTHLY UPLOADS (time-series for charts)
// =============================================================================

/**
 * Evidence upload counts grouped by month for the last N months.
 *
 * Uses a JS-side aggregation approach so it works with Prisma's
 * driver adapter without raw SQL array parameters.
 *
 * @param {Object} user
 * @param {number} months - Number of months to look back (default 12)
 */
async function getMonthlyUploads(user, months = 12) {
  const monthsNum = Math.min(
    typeof months === 'string' ? parseInt(months, 10) : Number(months),
    24 // cap at 24 months
  );

  if (Number.isNaN(monthsNum) || monthsNum < 1) {
    return buildEmptyMonths(1);
  }

  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - monthsNum);
  // Start from the beginning of that month
  sinceDate.setDate(1);
  sinceDate.setHours(0, 0, 0, 0);

  // Build where clause (with role scoping)
  const where = { deletedAt: null, uploadedAt: { gte: sinceDate } };

  if (user.role === 'INVESTIGATOR') {
    const assignedCases = await prisma.case.findMany({
      where: { assignedInvestigatorId: user.id, deletedAt: null },
      select: { id: true }
    });
    const ids = assignedCases.map(c => c.id);
    if (ids.length === 0) return buildEmptyMonths(monthsNum);
    where.caseId = { in: ids };
  }

  // Fetch just the two fields we need for aggregation
  const records = await prisma.evidence.findMany({
    where,
    select: { uploadedAt: true, fileSize: true }
  });

  // Aggregate in JS by YYYY-MM key
  const buckets = {};
  records.forEach(r => {
    const d = new Date(r.uploadedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) buckets[key] = { uploads: 0, totalSize: BigInt(0) };
    buckets[key].uploads   += 1;
    buckets[key].totalSize += BigInt(r.fileSize);
  });

  return fillMissingMonths(buckets, monthsNum);
}

/**
 * Build an array of the last N month strings (YYYY-MM) each with zero data.
 */
function buildEmptyMonths(n) {
  const result = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    result.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      uploads: 0,
      totalSize: '0',
      totalSizeFormatted: '0.0 B'
    });
  }
  return result;
}

/**
 * Merge JS bucket map with empty slots so every month is represented.
 * buckets: { 'YYYY-MM': { uploads, totalSize } }
 */
function fillMissingMonths(buckets, n) {
  const result = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets[month];
    const totalSize = bucket ? bucket.totalSize : BigInt(0);
    result.push({
      month,
      uploads:           bucket ? bucket.uploads : 0,
      totalSize:         totalSize.toString(),
      totalSizeFormatted: formatFileSize(totalSize)
    });
  }
  return result;
}

// =============================================================================
// RECENT ACTIVITY (from audit log)
// =============================================================================

/**
 * Recent system activity — last N audit log entries for the live feed.
 *
 * Investigators only see activity they generated themselves.
 */
async function getRecentActivity(user, limit = 20) {
  const limitNum = Math.min(
    typeof limit === 'string' ? parseInt(limit, 10) : Number(limit),
    100
  );

  const where = user.role === 'INVESTIGATOR'
    ? { userId: user.id }
    : {};

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, role: true } }
    },
    orderBy: { timestamp: 'desc' },
    take: limitNum
  });

  return logs;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  getOverallStats,
  getRecentUploads,
  getMonthlyUploads,
  getRecentActivity
};
