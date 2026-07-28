/**
 * Notification Tests
 *
 * Tests for:
 * - Listing / filtering notifications
 * - Unread count badge
 * - Mark single as read
 * - Mark all as read
 * - Delete single notification
 * - Clear all read notifications
 * - Auto-triggered notifications (evidence approved, case assigned, etc.)
 * - Access control (can't touch another user's notifications)
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
  admin:        { email: `notif.admin.${testRunId}@test.com`,      password: 'AdminPass@123', name: 'Notif Admin',        role: 'ADMIN' },
  supervisor:   { email: `notif.supervisor.${testRunId}@test.com`, password: 'SuperPass@123', name: 'Notif Supervisor',   role: 'SUPERVISOR' },
  investigator: { email: `notif.inv.${testRunId}@test.com`,        password: 'InvestPass@123',name: 'Notif Investigator', role: 'INVESTIGATOR' }
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

  // Create case assigned to investigator so they can upload evidence
  testCase = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-95001`,
      title: 'Notification Test Case',
      status: 'OPEN',
      createdById: users.supervisor.id,
      assignedInvestigatorId: users.investigator.id
    }
  });
});

// =============================================================================
// TEARDOWN
// =============================================================================

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });
  await prisma.evidence.deleteMany({ where: { caseId: testCase.id } });
  await prisma.case.delete({ where: { id: testCase.id } }).catch(() => {});
  await prisma.auditLog.deleteMany({
    where: { userId: { in: Object.values(users).map(u => u.id) } }
  });
  await prisma.user.deleteMany({ where: { email: { contains: `${testRunId}` } } });
  try { fs.rmSync(path.resolve(process.cwd(), 'uploads'), { recursive: true, force: true }); } catch {}
});

// =============================================================================
// TRIGGERED NOTIFICATIONS
// =============================================================================

describe('Triggered notifications', () => {
  let evidenceId;

  it('should create notifications for supervisors/admins when evidence is uploaded', async () => {
    // Investigator uploads evidence
    const uploadRes = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);

    expect(uploadRes.status).toBe(201);
    evidenceId = uploadRes.body.data.id;

    // Give the async notification a moment
    await new Promise(r => setTimeout(r, 100));

    // Admin and supervisor should have a new notification
    const adminNotifs = await prisma.notification.findMany({
      where: { userId: users.admin.id, linkId: evidenceId }
    });
    expect(adminNotifs.length).toBeGreaterThan(0);
    expect(adminNotifs[0].title).toBe('New Evidence Uploaded');

    const supNotifs = await prisma.notification.findMany({
      where: { userId: users.supervisor.id, linkId: evidenceId }
    });
    expect(supNotifs.length).toBeGreaterThan(0);
  });

  it('should notify the investigator when evidence is approved', async () => {
    // Supervisor approves
    const approveRes = await request(app)
      .put(`/api/v1/evidence/${evidenceId}/approve`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(approveRes.status).toBe(200);
    await new Promise(r => setTimeout(r, 100));

    const notifs = await prisma.notification.findMany({
      where: { userId: users.investigator.id, linkId: evidenceId, title: 'Evidence Approved' }
    });
    expect(notifs.length).toBeGreaterThan(0);
  });

  it('should notify investigator when evidence is rejected', async () => {
    // Upload a new piece of evidence to reject
    const upload2 = await request(app)
      .post('/api/v1/evidence/upload')
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .field('caseId', testCase.id)
      .attach('file', FIXTURE);

    const eid = upload2.body.data.id;

    await request(app)
      .put(`/api/v1/evidence/${eid}/reject`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ reason: 'Poor quality' });

    await new Promise(r => setTimeout(r, 100));

    const notifs = await prisma.notification.findMany({
      where: { userId: users.investigator.id, linkId: eid, title: 'Evidence Rejected' }
    });
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0].message).toContain('Poor quality');
  });

  it('should notify investigator when a case is assigned', async () => {
    // Create an unassigned case then assign it
    const newCase = await prisma.case.create({
      data: {
        caseNumber: `CASE-${new Date().getFullYear()}-95002`,
        title: 'Assignment Notification Case',
        status: 'OPEN',
        createdById: users.admin.id
      }
    });

    await request(app)
      .put(`/api/v1/cases/${newCase.id}/assign`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ investigatorId: users.investigator.id });

    await new Promise(r => setTimeout(r, 100));

    const notifs = await prisma.notification.findMany({
      where: { userId: users.investigator.id, linkId: newCase.id, title: 'Case Assigned to You' }
    });
    expect(notifs.length).toBeGreaterThan(0);

    // Cleanup
    await prisma.case.delete({ where: { id: newCase.id } });
  });

  it('should notify investigator when their case is closed', async () => {
    await request(app)
      .post(`/api/v1/cases/${testCase.id}/close`)
      .set('Authorization', `Bearer ${tokens.supervisor}`)
      .send({});

    await new Promise(r => setTimeout(r, 100));

    const notifs = await prisma.notification.findMany({
      where: { userId: users.investigator.id, linkId: testCase.id, title: 'Case Closed' }
    });
    expect(notifs.length).toBeGreaterThan(0);

    // Reopen for subsequent tests
    await request(app)
      .post(`/api/v1/cases/${testCase.id}/reopen`)
      .set('Authorization', `Bearer ${tokens.admin}`);
  });
});

// =============================================================================
// GET /api/v1/notifications
// =============================================================================

describe('GET /api/v1/notifications', () => {
  it('should return notifications for the current user', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('unreadCount');
    expect(res.body.pagination).toBeDefined();
    // Investigator should have notifications from the triggers above
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('should support unreadOnly filter', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(n => expect(n.isRead).toBe(false));
  });

  it('should support pagination', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?limit=2&page=1')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination.limit).toBe(2);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/notifications/unread-count
// =============================================================================

describe('GET /api/v1/notifications/unread-count', () => {
  it('should return unread count', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('unreadCount');
    expect(typeof res.body.data.unreadCount).toBe('number');
    expect(res.body.data.unreadCount).toBeGreaterThan(0);
  });
});

// =============================================================================
// PUT /api/v1/notifications/:id/read
// =============================================================================

describe('PUT /api/v1/notifications/:id/read', () => {
  let notificationId;

  beforeAll(async () => {
    // Grab one unread notification for the investigator
    const n = await prisma.notification.findFirst({
      where: { userId: users.investigator.id, isRead: false }
    });
    notificationId = n?.id;
  });

  it('should mark a notification as read', async () => {
    if (!notificationId) return; // skip if none available

    const res = await request(app)
      .put(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);
    expect(res.body.data.readAt).toBeDefined();
  });

  it('should be idempotent — marking already-read returns 200', async () => {
    if (!notificationId) return;

    const res = await request(app)
      .put(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
  });

  it('should deny access to another user\'s notification', async () => {
    if (!notificationId) return;

    // Admin tries to mark investigator's notification
    const res = await request(app)
      .put(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(res.status).toBe(403);
  });

  it('should return 404 for non-existent notification', async () => {
    const res = await request(app)
      .put('/api/v1/notifications/00000000-0000-0000-0000-000000000000/read')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// PUT /api/v1/notifications/read-all
// =============================================================================

describe('PUT /api/v1/notifications/read-all', () => {
  it('should mark all unread notifications as read', async () => {
    // First confirm there are unread ones
    const beforeRes = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    const res = await request(app)
      .put('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('markedRead');
    expect(typeof res.body.data.markedRead).toBe('number');

    // After marking all, unread count should be 0
    const afterRes = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(afterRes.body.data.unreadCount).toBe(0);
  });
});

// =============================================================================
// DELETE /api/v1/notifications/:id
// =============================================================================

describe('DELETE /api/v1/notifications/:id', () => {
  let notificationId;

  beforeAll(async () => {
    // Create a test notification directly in DB
    const n = await prisma.notification.create({
      data: {
        userId:  users.investigator.id,
        title:   'Test Delete Notification',
        message: 'This will be deleted'
      }
    });
    notificationId = n.id;
  });

  it('should delete own notification', async () => {
    const res = await request(app)
      .delete(`/api/v1/notifications/${notificationId}`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    // Confirm gone
    const gone = await prisma.notification.findUnique({ where: { id: notificationId } });
    expect(gone).toBeNull();
  });

  it('should deny deleting another user\'s notification', async () => {
    // Create one for the admin
    const n = await prisma.notification.create({
      data: {
        userId:  users.admin.id,
        title:   'Admin notification',
        message: 'Admin only'
      }
    });

    const res = await request(app)
      .delete(`/api/v1/notifications/${n.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(403);

    await prisma.notification.delete({ where: { id: n.id } }).catch(() => {});
  });
});

// =============================================================================
// DELETE /api/v1/notifications/clear-read
// =============================================================================

describe('DELETE /api/v1/notifications/clear-read', () => {
  it('should delete all read notifications', async () => {
    // Mark all as read first
    await request(app)
      .put('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    const res = await request(app)
      .delete('/api/v1/notifications/clear-read')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('deleted');
    expect(typeof res.body.data.deleted).toBe('number');

    // Unread count should still be 0 (no unread were deleted)
    const countRes = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(countRes.body.data.unreadCount).toBe(0);
  });
});
