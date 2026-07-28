/**
 * Audit Log / Chain of Custody Tests
 *
 * Tests for:
 * - Listing audit logs with filters
 * - Audit statistics
 * - Evidence chain of custody
 * - Case audit trail
 * - User activity history
 * - CSV export
 * - Access control (Admin/Supervisor only)
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../src/app');
const { prisma } = require('../src/config/database');
const { hashPassword } = require('../src/utils/password.util');

// =============================================================================
// TEST DATA
// =============================================================================

const testRunId = Date.now();
const FIXTURE = path.join(__dirname, 'fixtures', 'test-evidence.txt');

const testUsers = {
  admin:        { email: `aud.admin.${testRunId}@test.com`,      password: 'AdminPass@123', name: 'Aud Admin',      role: 'ADMIN' },
  supervisor:   { email: `aud.supervisor.${testRunId}@test.com`, password: 'SuperPass@123', name: 'Aud Supervisor',  role: 'SUPERVISOR' },
  investigator: { email: `aud.inv.${testRunId}@test.com`,        password: 'InvestPass@123',name: 'Aud Investigator',role: 'INVESTIGATOR' }
};

let users = {};
let tokens = {};
let testCase;
let testEvidence;

// =============================================================================
// SETUP
// =============================================================================

beforeAll(async () => {
  // Create users
  for (const [key, u] of Object.entries(testUsers)) {
    const passwordHash = await hashPassword(u.password);
    users[key] = await prisma.user.create({
      data: { email: u.email, passwordHash, name: u.name, role: u.role }
    });
  }

  // Login
  for (const [key, u] of Object.entries(testUsers)) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    tokens[key] = res.body.data.accessToken;
  }

  // Create a test case
  testCase = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-97001`,
      title: 'Audit Test Case',
      status: 'OPEN',
      createdById: users.supervisor.id,
      assignedInvestigatorId: users.investigator.id
    }
  });

  // Upload evidence so there are audit log entries to read
  const uploadRes = await request(app)
    .post('/api/v1/evidence/upload')
    .set('Authorization', `Bearer ${tokens.admin}`)
    .field('caseId', testCase.id)
    .field('description', 'Audit test evidence')
    .attach('file', FIXTURE);

  testEvidence = uploadRes.body.data;

  // Approve the evidence to create more audit entries
  await request(app)
    .put(`/api/v1/evidence/${testEvidence.id}/approve`)
    .set('Authorization', `Bearer ${tokens.supervisor}`);

  // Download evidence to create a download audit entry
  await request(app)
    .get(`/api/v1/evidence/${testEvidence.id}/download`)
    .set('Authorization', `Bearer ${tokens.admin}`)
    .buffer(true);
});

// =============================================================================
// TEARDOWN
// =============================================================================

afterAll(async () => {
  // Clean up evidence (hard delete)
  await prisma.evidence.deleteMany({ where: { caseId: testCase.id } });
  await prisma.case.delete({ where: { id: testCase.id } }).catch(() => {});
  await prisma.auditLog.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });
  await prisma.notification.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });
  await prisma.user.deleteMany({
    where: { email: { contains: `${testRunId}` } }
  });
  try { fs.rmSync(path.resolve(process.cwd(), 'uploads'), { recursive: true, force: true }); } catch {}
});

// =============================================================================
// GET /api/v1/audit
// =============================================================================

describe('GET /api/v1/audit', () => {
  it('should return paginated audit logs for admin', async () => {
    const res = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.totalCount).toBeGreaterThan(0);
  });

  it('should return paginated audit logs for supervisor', async () => {
    const res = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should deny investigator from reading audit logs', async () => {
    const res = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(403);
  });

  it('should filter by action', async () => {
    const res = await request(app)
      .get('/api/v1/audit?action=EVIDENCE_UPLOADED')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(log => expect(log.action).toBe('EVIDENCE_UPLOADED'));
  });

  it('should filter by entity type', async () => {
    const res = await request(app)
      .get('/api/v1/audit?entity=EVIDENCE')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(log => expect(log.entity).toBe('EVIDENCE'));
  });

  it('should filter by entityId', async () => {
    const res = await request(app)
      .get(`/api/v1/audit?entityId=${testEvidence.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    res.body.data.forEach(log => expect(log.entityId).toBe(testEvidence.id));
  });

  it('should filter by userId', async () => {
    const res = await request(app)
      .get(`/api/v1/audit?userId=${users.admin.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(log => expect(log.userId).toBe(users.admin.id));
  });

  it('should support date range filter', async () => {
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const end   = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now

    const res = await request(app)
      .get(`/api/v1/audit?startDate=${start}&endDate=${end}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('should support sortOrder=asc', async () => {
    const res = await request(app)
      .get('/api/v1/audit?sortOrder=asc&limit=5')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    if (res.body.data.length >= 2) {
      const first  = new Date(res.body.data[0].timestamp).getTime();
      const second = new Date(res.body.data[1].timestamp).getTime();
      expect(first).toBeLessThanOrEqual(second);
    }
  });

  it('should support pagination', async () => {
    const res = await request(app)
      .get('/api/v1/audit?page=1&limit=3')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
    expect(res.body.pagination.limit).toBe(3);
  });

  it('should reject invalid action value', async () => {
    const res = await request(app)
      .get('/api/v1/audit?action=NOT_AN_ACTION')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(400);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/audit');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/audit/statistics
// =============================================================================

describe('GET /api/v1/audit/statistics', () => {
  it('should return audit statistics', async () => {
    const res = await request(app)
      .get('/api/v1/audit/statistics')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalLogs');
    expect(res.body.data).toHaveProperty('logsToday');
    expect(res.body.data).toHaveProperty('byAction');
    expect(res.body.data).toHaveProperty('recentActivity');
    expect(res.body.data.totalLogs).toBeGreaterThan(0);
  });

  it('should deny investigator', async () => {
    const res = await request(app)
      .get('/api/v1/audit/statistics')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET /api/v1/audit/evidence/:evidenceId  — Chain of custody
// =============================================================================

describe('GET /api/v1/audit/evidence/:evidenceId', () => {
  it('should return chain of custody for evidence', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/evidence/${testEvidence.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('evidence');
    expect(res.body.data).toHaveProperty('chainOfCustody');
    expect(res.body.data).toHaveProperty('totalEvents');
    expect(Array.isArray(res.body.data.chainOfCustody)).toBe(true);
    expect(res.body.data.chainOfCustody.length).toBeGreaterThan(0);

    // Should be chronological (oldest first)
    const chain = res.body.data.chainOfCustody;
    if (chain.length >= 2) {
      const t0 = new Date(chain[0].timestamp).getTime();
      const t1 = new Date(chain[1].timestamp).getTime();
      expect(t0).toBeLessThanOrEqual(t1);
    }
  });

  it('should include expected actions in the chain', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/evidence/${testEvidence.id}`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(res.status).toBe(200);
    const actions = res.body.data.chainOfCustody.map(l => l.action);
    expect(actions).toContain('EVIDENCE_UPLOADED');
    expect(actions).toContain('EVIDENCE_APPROVED');
    expect(actions).toContain('EVIDENCE_DOWNLOADED');
  }, 15000);

  it('should return 404 for non-existent evidence', async () => {
    const res = await request(app)
      .get('/api/v1/audit/evidence/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(404);
  });

  it('should deny investigator', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/evidence/${testEvidence.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET /api/v1/audit/case/:caseId  — Case audit trail
// =============================================================================

describe('GET /api/v1/audit/case/:caseId', () => {
  it('should return case audit trail', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/case/${testCase.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('case');
    expect(res.body.data).toHaveProperty('auditTrail');
    expect(res.body.data).toHaveProperty('totalEvents');
    expect(res.body.data).toHaveProperty('evidenceItems');
    expect(Array.isArray(res.body.data.auditTrail)).toBe(true);
    expect(res.body.data.auditTrail.length).toBeGreaterThan(0);
  });

  it('should include both case and evidence events', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/case/${testCase.id}`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(res.status).toBe(200);
    const entities = res.body.data.auditTrail.map(l => l.entity);
    // Should have EVIDENCE entries (from upload / approve / download)
    expect(entities).toContain('EVIDENCE');
  });

  it('should return 404 for non-existent case', async () => {
    const res = await request(app)
      .get('/api/v1/audit/case/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(404);
  });

  it('should deny investigator', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/case/${testCase.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET /api/v1/audit/user/:userId  — User history
// =============================================================================

describe('GET /api/v1/audit/user/:userId', () => {
  it('should return user audit history', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/user/${users.admin.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    // All logs should belong to the requested user
    res.body.data.forEach(log => expect(log.userId).toBe(users.admin.id));
  });

  it('should support pagination', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/user/${users.admin.id}?limit=2&page=1`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('should deny investigator', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/user/${users.admin.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET /api/v1/audit/export  — CSV export
// =============================================================================

describe('GET /api/v1/audit/export', () => {
  it('should download a CSV file', async () => {
    const res = await request(app)
      .get('/api/v1/audit/export')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');

    // The CSV should have a header row
    const text = res.text || res.body.toString();
    expect(text).toContain('ID');
    expect(text).toContain('Timestamp');
    expect(text).toContain('Action');
  });

  it('should scope export to a case when caseId provided', async () => {
    const res = await request(app)
      .get(`/api/v1/audit/export?caseId=${testCase.id}`)
      .set('Authorization', `Bearer ${tokens.supervisor}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.text || res.body.toString();
    // Should contain the evidence entry at minimum
    expect(text).toContain('EVIDENCE_UPLOADED');
  });

  it('should scope export to a date range', async () => {
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .get(`/api/v1/audit/export?startDate=${encodeURIComponent(start)}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .buffer(true);

    expect(res.status).toBe(200);
  });

  it('should deny investigator from exporting', async () => {
    const res = await request(app)
      .get('/api/v1/audit/export')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(403);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/audit/export');
    expect(res.status).toBe(401);
  });
});
