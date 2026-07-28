/**
 * Evidence Management Tests
 *
 * Tests for:
 * - File upload (multipart/form-data)
 * - SHA-256 hash verification
 * - Evidence listing with role-based access
 * - Approve / reject workflow
 * - Download with integrity check
 * - Soft delete
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
  admin:       { email: `ev.admin.${testRunId}@test.com`,       password: 'AdminPass@123',  name: 'Ev Admin',       role: 'ADMIN' },
  supervisor:  { email: `ev.supervisor.${testRunId}@test.com`,  password: 'SuperPass@123',  name: 'Ev Supervisor',  role: 'SUPERVISOR' },
  investigator1: { email: `ev.inv1.${testRunId}@test.com`,      password: 'InvestPass@123', name: 'Ev Investigator1', role: 'INVESTIGATOR' },
  investigator2: { email: `ev.inv2.${testRunId}@test.com`,      password: 'InvestPass@123', name: 'Ev Investigator2', role: 'INVESTIGATOR' }
};

let users = {};
let tokens = {};
let testCase;
let testCase2; // unassigned case for access-control tests

// Collect created evidence IDs so teardown can wipe them
const createdEvidenceIds = [];

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

  // Create a test case assigned to investigator1
  testCase = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-98001`,
      title: 'Evidence Test Case 1',
      status: 'OPEN',
      createdById: users.supervisor.id,
      assignedInvestigatorId: users.investigator1.id
    }
  });

  // Unassigned case (investigator2 has no access here)
  testCase2 = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-98002`,
      title: 'Evidence Test Case 2',
      status: 'OPEN',
      createdById: users.admin.id
    }
  });
});

// =============================================================================
// TEARDOWN
// =============================================================================

afterAll(async () => {
  // Delete evidence records (hard delete for test cleanup)
  if (createdEvidenceIds.length) {
    await prisma.evidence.deleteMany({ where: { id: { in: createdEvidenceIds } } });
  }

  // Delete all evidence for test cases
  await prisma.evidence.deleteMany({
    where: { caseId: { in: [testCase.id, testCase2.id] } }
  });

  // Delete cases
  await prisma.case.deleteMany({
    where: { id: { in: [testCase.id, testCase2.id] } }
  });

  // Delete audit logs for test users
  await prisma.auditLog.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });

  // Delete notifications for test users
  await prisma.notification.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });

  // Delete users
  await prisma.user.deleteMany({
    where: { email: { contains: `${testRunId}` } }
  });

  // Clean up uploaded test files from disk
  const uploadsBase = path.resolve(process.cwd(), 'uploads');
  const rmDir = (dir) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  rmDir(uploadsBase);
});

// =============================================================================
// UPLOAD: POST /api/v1/evidence/upload
// =============================================================================

describe('POST /api/v1/evidence/upload', () => {
  it('should allow investigator to upload evidence to assigned case', async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .field('caseId', testCase.id)
      .field('description', 'Main test evidence')
      .attach('file', FIXTURE);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalName).toBe('test-evidence.txt');
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.sha256Hash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.data.fileSize).toBeTruthy();
    expect(res.body.data.fileSizeFormatted).toBeTruthy();

    createdEvidenceIds.push(res.body.data.id);
  });

  it('should allow admin to upload evidence', async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);

    expect(res.status).toBe(201);
    createdEvidenceIds.push(res.body.data.id);
  });

  it('should deny investigator from uploading to unassigned case', async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .field('caseId', testCase2.id)
      .attach('file', FIXTURE);

    expect(res.status).toBe(403);
  });

  it('should return 400 when no file attached', async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ caseId: testCase.id });

    expect(res.status).toBe(400);
  });

  it('should return 400 when caseId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .attach('file', FIXTURE);

    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent case', async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .field('caseId', '00000000-0000-0000-0000-000000000000')
      .attach('file', FIXTURE);

    expect(res.status).toBe(404);
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// LIST: GET /api/v1/evidence
// =============================================================================

describe('GET /api/v1/evidence', () => {
  it('should return evidence list for admin', async () => {
    const res = await request(app)
      .get('/api/v1/evidence')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('should filter by caseId', async () => {
    const res = await request(app)
      .get(`/api/v1/evidence?caseId=${testCase.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(e => expect(e.caseId).toBe(testCase.id));
  });

  it('should filter by status', async () => {
    const res = await request(app)
      .get('/api/v1/evidence?status=PENDING')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(e => expect(e.status).toBe('PENDING'));
  });

  it('should only show evidence from assigned cases to investigator1', async () => {
    const res = await request(app)
      .get('/api/v1/evidence')
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(e => expect(e.caseId).toBe(testCase.id));
  });

  it('should return empty list for investigator with no assigned cases', async () => {
    const res = await request(app)
      .get('/api/v1/evidence')
      .set('Authorization', `Bearer ${tokens.investigator2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});

// =============================================================================
// GET BY ID: GET /api/v1/evidence/:id
// =============================================================================

describe('GET /api/v1/evidence/:id', () => {
  let evidenceId;

  beforeAll(async () => {
    // Use a previously created evidence item
    evidenceId = createdEvidenceIds[0];
  });

  it('should return evidence details for admin', async () => {
    const res = await request(app)
      .get(`/api/v1/evidence/${evidenceId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(evidenceId);
    expect(res.body.data.sha256Hash).toBeDefined();
    expect(res.body.data.uploadedBy).toBeDefined();
  });

  it('should allow investigator1 to view evidence in their case', async () => {
    const res = await request(app)
      .get(`/api/v1/evidence/${evidenceId}`)
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(res.status).toBe(200);
  });

  it('should deny investigator2 (not assigned to case)', async () => {
    const res = await request(app)
      .get(`/api/v1/evidence/${evidenceId}`)
      .set('Authorization', `Bearer ${tokens.investigator2}`);

    expect(res.status).toBe(403);
  });

  it('should return 404 for non-existent evidence', async () => {
    const res = await request(app)
      .get('/api/v1/evidence/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(404);
  });

  it('should reject invalid UUID', async () => {
    const res = await request(app)
      .get('/api/v1/evidence/not-a-uuid')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(400);
  });
});

// =============================================================================
// INTEGRITY VERIFY: GET /api/v1/evidence/:id/verify
// =============================================================================

describe('GET /api/v1/evidence/:id/verify', () => {
  it('should verify evidence integrity', async () => {
    const evidenceId = createdEvidenceIds[0];

    const res = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/verify`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.intact).toBe(true);
    expect(res.body.data.storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.data.currentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.data.storedHash).toBe(res.body.data.currentHash);
  });
});

// =============================================================================
// APPROVE: PUT /api/v1/evidence/:id/approve
// =============================================================================

describe('PUT /api/v1/evidence/:id/approve', () => {
  let pendingEvidenceId;

  beforeAll(async () => {
    // Upload a fresh evidence item to approve
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);

    pendingEvidenceId = res.body.data.id;
    createdEvidenceIds.push(pendingEvidenceId);
  });

  it('should allow supervisor to approve pending evidence', async () => {
    const res = await request(app)
      .put(`/api/v1/evidence/${pendingEvidenceId}/approve`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.reviewedBy.id).toBe(users.supervisor.id);
    expect(res.body.data.reviewedAt).toBeDefined();
  });

  it('should return 409 when approving already-approved evidence', async () => {
    const res = await request(app)
      .put(`/api/v1/evidence/${pendingEvidenceId}/approve`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(409);
  });

  it('should deny investigator from approving', async () => {
    const res2 = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);
    const tmpId = res2.body.data.id;
    createdEvidenceIds.push(tmpId);

    const res = await request(app)
      .put(`/api/v1/evidence/${tmpId}/approve`)
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// REJECT: PUT /api/v1/evidence/:id/reject
// =============================================================================

describe('PUT /api/v1/evidence/:id/reject', () => {
  let pendingEvidenceId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);

    pendingEvidenceId = res.body.data.id;
    createdEvidenceIds.push(pendingEvidenceId);
  });

  it('should allow admin to reject pending evidence with reason', async () => {
    const res = await request(app)
      .put(`/api/v1/evidence/${pendingEvidenceId}/reject`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ reason: 'Image quality is too low for analysis' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect(res.body.data.rejectReason).toBe('Image quality is too low for analysis');
  });

  it('should require a rejection reason', async () => {
    // Upload a new one first
    const res2 = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);
    const tmpId = res2.body.data.id;
    createdEvidenceIds.push(tmpId);

    const res = await request(app)
      .put(`/api/v1/evidence/${tmpId}/reject`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 409 when rejecting already-rejected evidence', async () => {
    const res = await request(app)
      .put(`/api/v1/evidence/${pendingEvidenceId}/reject`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ reason: 'Double reject attempt' });

    expect(res.status).toBe(409);
  });
});

// =============================================================================
// DOWNLOAD: GET /api/v1/evidence/:id/download
// =============================================================================

describe('GET /api/v1/evidence/:id/download', () => {
  it('should stream the file to the client', async () => {
    const evidenceId = createdEvidenceIds[0];

    const res = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/download`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .buffer(true);   // supertest: collect binary response

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['x-sha256-hash']).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body).toBeTruthy();
  });

  it('should deny investigator2 from downloading case1 evidence', async () => {
    const evidenceId = createdEvidenceIds[0];

    const res = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/download`)
      .set('Authorization', `Bearer ${tokens.investigator2}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// DELETE: DELETE /api/v1/evidence/:id
// =============================================================================

describe('DELETE /api/v1/evidence/:id', () => {
  let toDeleteId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);

    toDeleteId = res.body.data.id;
    // Don't push to createdEvidenceIds — delete route handles cleanup
  });

  it('should allow admin to soft delete evidence', async () => {
    const res = await request(app)
      .delete(`/api/v1/evidence/${toDeleteId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).toBeDefined();

    // Verify it's no longer visible in list
    const checkRes = await request(app)
      .get(`/api/v1/evidence/${toDeleteId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(checkRes.status).toBe(404);

    // Hard clean
    await prisma.evidence.delete({ where: { id: toDeleteId } }).catch(() => {});
  });

  it('should deny supervisor from deleting evidence', async () => {
    const evidenceId = createdEvidenceIds[0];

    const res = await request(app)
      .delete(`/api/v1/evidence/${evidenceId}`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// STATISTICS: GET /api/v1/evidence/statistics
// =============================================================================

describe('GET /api/v1/evidence/statistics', () => {
  it('should return statistics for admin', async () => {
    const res = await request(app)
      .get('/api/v1/evidence/statistics')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('byStatus');
    expect(res.body.data).toHaveProperty('byFileType');
    expect(res.body.data).toHaveProperty('recentUploads');
  });

  it('should return scoped statistics for investigator', async () => {
    const res = await request(app)
      .get('/api/v1/evidence/statistics')
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total');
  });
});
