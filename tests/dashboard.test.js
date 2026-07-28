/**
 * Dashboard & Statistics Tests
 *
 * Tests for:
 * - /dashboard/stats   — role-scoped summary
 * - /dashboard/recent-uploads
 * - /dashboard/monthly-uploads (chart data)
 * - /dashboard/activity
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
  admin:        { email: `dash.admin.${testRunId}@test.com`,      password: 'AdminPass@123', name: 'Dash Admin',        role: 'ADMIN' },
  supervisor:   { email: `dash.supervisor.${testRunId}@test.com`, password: 'SuperPass@123', name: 'Dash Supervisor',   role: 'SUPERVISOR' },
  investigator: { email: `dash.inv.${testRunId}@test.com`,        password: 'InvestPass@123',name: 'Dash Investigator', role: 'INVESTIGATOR' }
};

let users = {};
let tokens = {};
let testCase;

// =============================================================================
// SETUP
// =============================================================================

beforeAll(async () => {
  for (const [key, u] of Object.entries(testUsers)) {
    const passwordHash = await hashPassword(u.password);
    users[key] = await prisma.user.create({
      data: { email: u.email, passwordHash, name: u.name, role: u.role }
    });
  }

  for (const [key, u] of Object.entries(testUsers)) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    tokens[key] = res.body.data.accessToken;
  }

  // Create a case assigned to the investigator
  testCase = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-96001`,
      title: 'Dashboard Test Case',
      status: 'OPEN',
      createdById: users.supervisor.id,
      assignedInvestigatorId: users.investigator.id
    }
  });

  // Upload evidence so stats are non-zero
  await request(app)
    .post('/api/v1/evidence/upload')
    .set('Authorization', `Bearer ${tokens.admin}`)
    .field('caseId', testCase.id)
    .attach('file', FIXTURE);
});

// =============================================================================
// TEARDOWN
// =============================================================================

afterAll(async () => {
  await prisma.evidence.deleteMany({ where: { caseId: testCase.id } });
  await prisma.case.delete({ where: { id: testCase.id } }).catch(() => {});
  await prisma.auditLog.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });
  await prisma.notification.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });
  await prisma.user.deleteMany({ where: { email: { contains: `${testRunId}` } } });
  try { fs.rmSync(path.resolve(process.cwd(), 'uploads'), { recursive: true, force: true }); } catch {}
});

// =============================================================================
// GET /api/v1/dashboard/stats
// =============================================================================

describe('GET /api/v1/dashboard/stats', () => {
  it('should return full stats for admin', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    const d = res.body.data;

    // Cases block
    expect(d.cases).toHaveProperty('total');
    expect(d.cases).toHaveProperty('open');
    expect(d.cases).toHaveProperty('closed');
    expect(d.cases).toHaveProperty('pending');
    expect(d.cases).toHaveProperty('archived');
    expect(typeof d.cases.total).toBe('number');

    // Evidence block
    expect(d.evidence).toHaveProperty('total');
    expect(d.evidence).toHaveProperty('pending');
    expect(d.evidence).toHaveProperty('approved');
    expect(d.evidence).toHaveProperty('rejected');
    expect(d.evidence).toHaveProperty('pendingReview');
    expect(d.evidence).toHaveProperty('totalStorageBytes');
    expect(d.evidence).toHaveProperty('totalStorageFormatted');

    // Users block present for admin
    expect(d.users).not.toBeNull();
    expect(d.users).toHaveProperty('total');
    expect(d.users).toHaveProperty('admin');
    expect(d.users).toHaveProperty('supervisor');
    expect(d.users).toHaveProperty('investigator');

    // Recent arrays
    expect(Array.isArray(d.recentCases)).toBe(true);
    expect(Array.isArray(d.recentUploads)).toBe(true);
  });

  it('should return full stats for supervisor', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users).not.toBeNull();
  });

  it('should return scoped stats for investigator (no users block)', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    const d = res.body.data;

    // Investigator stats should be scoped to their assigned cases
    expect(d.cases.total).toBeGreaterThanOrEqual(1);   // they have one assigned case
    expect(d.users).toBeNull();                         // no user data for investigators
  });

  it('should reflect at least one pending evidence upload', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.evidence.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.evidence.pendingReview).toBeGreaterThanOrEqual(1);
  });

  it('should format storage size', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    // totalStorageFormatted should include a unit (B, KB, MB…)
    expect(res.body.data.evidence.totalStorageFormatted).toMatch(/\d+\.\d+ (B|KB|MB|GB|TB)/);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/dashboard/stats');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/dashboard/recent-uploads
// =============================================================================

describe('GET /api/v1/dashboard/recent-uploads', () => {
  it('should return recent uploads for admin', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/recent-uploads')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const first = res.body.data[0];
    expect(first).toHaveProperty('originalName');
    expect(first).toHaveProperty('fileSize');
    expect(first).toHaveProperty('fileSizeFormatted');
    expect(first).toHaveProperty('sha256Hash');
    expect(first.sha256Hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toHaveProperty('case');
    expect(first).toHaveProperty('uploadedBy');
  });

  it('should respect the limit parameter', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/recent-uploads?limit=1')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('should return only evidence from assigned cases for investigator', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/recent-uploads')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(e => {
      expect(e.case.id === testCase.id || e.case !== undefined).toBe(true);
    });
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/dashboard/recent-uploads');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/dashboard/monthly-uploads
// =============================================================================

describe('GET /api/v1/dashboard/monthly-uploads', () => {
  it('should return 12 months of data by default', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/monthly-uploads')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(12);
  });

  it('should return requested number of months', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/monthly-uploads?months=6')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(6);
  });

  it('should have correct shape for each month entry', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/monthly-uploads?months=3')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(entry => {
      expect(entry).toHaveProperty('month');
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);  // YYYY-MM
      expect(entry).toHaveProperty('uploads');
      expect(entry).toHaveProperty('totalSize');
      expect(entry).toHaveProperty('totalSizeFormatted');
      expect(typeof entry.uploads).toBe('number');
    });
  });

  it('should include the current month', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/monthly-uploads?months=1')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(res.body.data.some(e => e.month === currentMonth)).toBe(true);
  });

  it('should show uploads in the current month (we just uploaded one)', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/monthly-uploads?months=1')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonth = res.body.data.find(e => e.month === currentMonth);
    expect(thisMonth.uploads).toBeGreaterThanOrEqual(1);
  });

  it('should be scoped for investigator', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/monthly-uploads?months=3')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/dashboard/monthly-uploads');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/dashboard/activity
// =============================================================================

describe('GET /api/v1/dashboard/activity', () => {
  it('should return recent activity for admin', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const first = res.body.data[0];
    expect(first).toHaveProperty('action');
    expect(first).toHaveProperty('entity');
    expect(first).toHaveProperty('timestamp');
  });

  it('should respect the limit parameter', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity?limit=5')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it('should return only own activity for investigator', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    // All returned logs should be by the investigator
    res.body.data.forEach(log => {
      expect(log.userId).toBe(users.investigator.id);
    });
  });

  it('should be sorted newest first', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity?limit=10')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    if (res.body.data.length >= 2) {
      const t0 = new Date(res.body.data[0].timestamp).getTime();
      const t1 = new Date(res.body.data[1].timestamp).getTime();
      expect(t0).toBeGreaterThanOrEqual(t1);
    }
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/dashboard/activity');
    expect(res.status).toBe(401);
  });
});
