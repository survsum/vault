/**
 * User Management Tests
 * 
 * Tests for user CRUD operations including:
 * - Listing users with pagination and filters
 * - Getting user by ID
 * - Creating users (admin only)
 * - Updating users (admin and self-service)
 * - Deleting users (soft delete)
 * - Restoring deleted users
 * - Admin password reset
 * 
 * Test Structure:
 * - Each describe block groups related tests
 * - beforeAll/afterAll handle setup and teardown
 * - Tests use fresh data to avoid interference
 */

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/config/database');
const { hashPassword } = require('../src/utils/password.util');

// =============================================================================
// TEST DATA
// =============================================================================

// Unique identifier to avoid conflicts between test runs
const testRunId = Date.now();

const testUsers = {
  admin: {
    email: `admin.user.${testRunId}@test.com`,
    password: 'AdminPass@123',
    name: 'Test Admin',
    role: 'ADMIN'
  },
  supervisor: {
    email: `supervisor.user.${testRunId}@test.com`,
    password: 'SuperPass@123',
    name: 'Test Supervisor',
    role: 'SUPERVISOR'
  },
  investigator: {
    email: `investigator.user.${testRunId}@test.com`,
    password: 'InvestPass@123',
    name: 'Test Investigator',
    role: 'INVESTIGATOR'
  }
};

// Store created users and tokens
let createdUsers = {};
let tokens = {};

// =============================================================================
// SETUP & TEARDOWN
// =============================================================================

beforeAll(async () => {
  // Create test users
  for (const [key, userData] of Object.entries(testUsers)) {
    const passwordHash = await hashPassword(userData.password);
    createdUsers[key] = await prisma.user.create({
      data: {
        email: userData.email,
        passwordHash,
        name: userData.name,
        role: userData.role
      }
    });
  }

  // Login all users to get tokens
  for (const [key, userData] of Object.entries(testUsers)) {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: userData.email,
        password: userData.password
      });
    
    tokens[key] = response.body.data.accessToken;
  }
});

afterAll(async () => {
  // Clean up test users (hard delete for test cleanup)
  const testEmails = Object.values(testUsers).map(u => u.email);
  
  // Delete any users created during tests
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: `${testRunId}`
      }
    }
  });

  // Clean up audit logs for test users
  await prisma.auditLog.deleteMany({
    where: {
      entityId: {
        in: Object.values(createdUsers).map(u => u.id)
      }
    }
  });
});

// =============================================================================
// GET /api/v1/users - List Users
// =============================================================================

describe('GET /api/v1/users', () => {
  it('should allow admin to list all users', async () => {
    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.pagination).toBeDefined();
    expect(response.body.pagination.currentPage).toBe(1);
  });

  it('should allow supervisor to list users', async () => {
    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should deny investigator from listing users', async () => {
    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(response.status).toBe(403);
  });

  it('should support pagination', async () => {
    const response = await request(app)
      .get('/api/v1/users?page=1&limit=2')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(2);
  });

  it('should filter by role', async () => {
    const response = await request(app)
      .get('/api/v1/users?role=INVESTIGATOR')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    response.body.data.forEach(user => {
      expect(user.role).toBe('INVESTIGATOR');
    });
  });

  it('should search by name or email', async () => {
    const response = await request(app)
      .get(`/api/v1/users?search=${testRunId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    // Should find our test users
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should support sorting', async () => {
    const response = await request(app)
      .get('/api/v1/users?sortBy=name&sortOrder=asc')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should require authentication', async () => {
    const response = await request(app)
      .get('/api/v1/users');

    expect(response.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/users/me - Get Current User
// =============================================================================

describe('GET /api/v1/users/me', () => {
  it('should return current user profile', async () => {
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe(testUsers.investigator.email);
    expect(response.body.data.role).toBe('INVESTIGATOR');
  });

  it('should include statistics counts', async () => {
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('assignedCasesCount');
    expect(response.body.data).toHaveProperty('uploadedEvidenceCount');
  });

  it('should require authentication', async () => {
    const response = await request(app)
      .get('/api/v1/users/me');

    expect(response.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/users/:id - Get User by ID
// =============================================================================

describe('GET /api/v1/users/:id', () => {
  it('should allow admin to get any user', async () => {
    const response = await request(app)
      .get(`/api/v1/users/${createdUsers.investigator.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(createdUsers.investigator.id);
  });

  it('should allow user to get their own profile', async () => {
    const response = await request(app)
      .get(`/api/v1/users/${createdUsers.investigator.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(createdUsers.investigator.id);
  });

  it('should deny non-admin from viewing others', async () => {
    const response = await request(app)
      .get(`/api/v1/users/${createdUsers.admin.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`);

    expect(response.status).toBe(403);
  });

  it('should return 404 for non-existent user', async () => {
    const response = await request(app)
      .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(404);
  });

  it('should reject invalid UUID format', async () => {
    const response = await request(app)
      .get('/api/v1/users/invalid-uuid')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(400);
  });
});

// =============================================================================
// POST /api/v1/users - Create User
// =============================================================================

describe('POST /api/v1/users', () => {
  let createdUserId;

  afterAll(async () => {
    // Clean up user created in tests
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } });
    }
  });

  it('should allow admin to create new user', async () => {
    const newUser = {
      email: `new.user.${testRunId}@test.com`,
      password: 'NewUser@123',
      name: 'New User',
      role: 'INVESTIGATOR'
    };

    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send(newUser);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe(newUser.email);
    expect(response.body.data.role).toBe('INVESTIGATOR');
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');

    createdUserId = response.body.data.id;
  });

  it('should deny supervisor from creating users', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.supervisor}`)
      .send({
        email: `should.fail.${testRunId}@test.com`,
        password: 'ShouldFail@123',
        name: 'Should Fail'
      });

    expect(response.status).toBe(403);
  });

  it('should deny investigator from creating users', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .send({
        email: `should.fail2.${testRunId}@test.com`,
        password: 'ShouldFail@123',
        name: 'Should Fail'
      });

    expect(response.status).toBe(403);
  });

  it('should reject duplicate email', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        email: testUsers.admin.email,
        password: 'Duplicate@123',
        name: 'Duplicate User'
      });

    expect(response.status).toBe(409);
  });

  it('should validate email format', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        email: 'invalid-email',
        password: 'ValidPass@123',
        name: 'Test User'
      });

    expect(response.status).toBe(400);
  });

  it('should validate password strength', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        email: `weak.password.${testRunId}@test.com`,
        password: 'weak',
        name: 'Weak Password'
      });

    expect(response.status).toBe(400);
  });

  it('should default role to INVESTIGATOR', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        email: `default.role.${testRunId}@test.com`,
        password: 'DefaultRole@123',
        name: 'Default Role User'
      });

    expect(response.status).toBe(201);
    expect(response.body.data.role).toBe('INVESTIGATOR');

    // Clean up
    await prisma.user.delete({ where: { id: response.body.data.id } });
  });
});

// =============================================================================
// PUT /api/v1/users/me - Update Own Profile
// =============================================================================

describe('PUT /api/v1/users/me', () => {
  it('should allow user to update their name', async () => {
    const response = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .send({ name: 'Updated Investigator Name' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Updated Investigator Name');

    // Restore original name
    await prisma.user.update({
      where: { id: createdUsers.investigator.id },
      data: { name: testUsers.investigator.name }
    });
  });

  it('should allow user to update their email', async () => {
    const newEmail = `updated.${testRunId}@test.com`;
    
    const response = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .send({ email: newEmail });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(newEmail);

    // Restore original email
    await prisma.user.update({
      where: { id: createdUsers.investigator.id },
      data: { email: testUsers.investigator.email }
    });
  });

  it('should reject empty update', async () => {
    const response = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .send({});

    expect(response.status).toBe(400);
  });
});

// =============================================================================
// PUT /api/v1/users/:id - Update User
// =============================================================================

describe('PUT /api/v1/users/:id', () => {
  it('should allow admin to update any user', async () => {
    const response = await request(app)
      .put(`/api/v1/users/${createdUsers.investigator.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'Admin Updated Name' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Admin Updated Name');

    // Restore
    await prisma.user.update({
      where: { id: createdUsers.investigator.id },
      data: { name: testUsers.investigator.name }
    });
  });

  it('should allow admin to change user role', async () => {
    const response = await request(app)
      .put(`/api/v1/users/${createdUsers.investigator.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ role: 'SUPERVISOR' });

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('SUPERVISOR');

    // Restore
    await prisma.user.update({
      where: { id: createdUsers.investigator.id },
      data: { role: 'INVESTIGATOR' }
    });
  });

  it('should prevent user from changing own role', async () => {
    const response = await request(app)
      .put(`/api/v1/users/${createdUsers.investigator.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .send({ role: 'ADMIN' });

    expect(response.status).toBe(403);
  });

  it('should prevent non-admin from updating others', async () => {
    const response = await request(app)
      .put(`/api/v1/users/${createdUsers.admin.id}`)
      .set('Authorization', `Bearer ${tokens.investigator}`)
      .send({ name: 'Hacker Name' });

    expect(response.status).toBe(403);
  });
});

// =============================================================================
// DELETE /api/v1/users/:id - Soft Delete User
// =============================================================================

describe('DELETE /api/v1/users/:id', () => {
  let userToDelete;

  beforeEach(async () => {
    // Create a fresh user to delete
    const passwordHash = await hashPassword('ToDelete@123');
    userToDelete = await prisma.user.create({
      data: {
        email: `to.delete.${Date.now()}@test.com`,
        passwordHash,
        name: 'To Be Deleted',
        role: 'INVESTIGATOR'
      }
    });
  });

  afterEach(async () => {
    // Hard delete test user
    if (userToDelete) {
      await prisma.user.delete({ where: { id: userToDelete.id } }).catch(() => {});
    }
  });

  it('should allow admin to soft delete user', async () => {
    const response = await request(app)
      .delete(`/api/v1/users/${userToDelete.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data.deletedAt).toBeDefined();

    // Verify soft delete
    const deleted = await prisma.user.findUnique({ where: { id: userToDelete.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('should deny supervisor from deleting users', async () => {
    const response = await request(app)
      .delete(`/api/v1/users/${userToDelete.id}`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(response.status).toBe(403);
  });

  it('should prevent admin from self-deletion', async () => {
    const response = await request(app)
      .delete(`/api/v1/users/${createdUsers.admin.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(403);
  });

  it('should return 404 for non-existent user', async () => {
    const response = await request(app)
      .delete('/api/v1/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(404);
  });
});

// =============================================================================
// POST /api/v1/users/:id/restore - Restore Deleted User
// =============================================================================

describe('POST /api/v1/users/:id/restore', () => {
  let deletedUser;

  beforeEach(async () => {
    // Create and soft-delete a user
    const passwordHash = await hashPassword('ToRestore@123');
    deletedUser = await prisma.user.create({
      data: {
        email: `to.restore.${Date.now()}@test.com`,
        passwordHash,
        name: 'To Be Restored',
        role: 'INVESTIGATOR',
        deletedAt: new Date()
      }
    });
  });

  afterEach(async () => {
    if (deletedUser) {
      await prisma.user.delete({ where: { id: deletedUser.id } }).catch(() => {});
    }
  });

  it('should allow admin to restore deleted user', async () => {
    const response = await request(app)
      .post(`/api/v1/users/${deletedUser.id}/restore`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    
    // Verify restored
    const restored = await prisma.user.findUnique({ where: { id: deletedUser.id } });
    expect(restored.deletedAt).toBeNull();
  });

  it('should return 409 for non-deleted user', async () => {
    const response = await request(app)
      .post(`/api/v1/users/${createdUsers.investigator.id}/restore`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(409);
  });

  it('should deny supervisor from restoring users', async () => {
    const response = await request(app)
      .post(`/api/v1/users/${deletedUser.id}/restore`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(response.status).toBe(403);
  });
});

// =============================================================================
// POST /api/v1/users/:id/reset-password - Admin Reset Password
// =============================================================================

describe('POST /api/v1/users/:id/reset-password', () => {
  it('should allow admin to reset user password', async () => {
    const newPassword = 'NewAdminReset@123';
    
    const response = await request(app)
      .post(`/api/v1/users/${createdUsers.investigator.id}/reset-password`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ newPassword });

    expect(response.status).toBe(200);

    // Verify new password works
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUsers.investigator.email,
        password: newPassword
      });

    expect(loginResponse.status).toBe(200);

    // Restore original password
    const passwordHash = await hashPassword(testUsers.investigator.password);
    await prisma.user.update({
      where: { id: createdUsers.investigator.id },
      data: { passwordHash }
    });

    // Update token
    const refreshLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUsers.investigator.email,
        password: testUsers.investigator.password
      });
    tokens.investigator = refreshLogin.body.data.accessToken;
  });

  it('should deny supervisor from resetting passwords', async () => {
    const response = await request(app)
      .post(`/api/v1/users/${createdUsers.investigator.id}/reset-password`)
      .set('Authorization', `Bearer ${tokens.supervisor}`)
      .send({ newPassword: 'Supervisor@123' });

    expect(response.status).toBe(403);
  });

  it('should validate password strength', async () => {
    const response = await request(app)
      .post(`/api/v1/users/${createdUsers.investigator.id}/reset-password`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ newPassword: 'weak' });

    expect(response.status).toBe(400);
  });
});

// =============================================================================
// GET /api/v1/users/statistics - User Statistics
// =============================================================================

describe('GET /api/v1/users/statistics', () => {
  it('should return user statistics for admin', async () => {
    const response = await request(app)
      .get('/api/v1/users/statistics')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('total');
    expect(response.body.data).toHaveProperty('active');
    expect(response.body.data).toHaveProperty('deleted');
    expect(response.body.data).toHaveProperty('byRole');
  });

  it('should deny supervisor from viewing statistics', async () => {
    const response = await request(app)
      .get('/api/v1/users/statistics')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(response.status).toBe(403);
  });
});
