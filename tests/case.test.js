/**
 * Case Management Tests
 * 
 * Tests for case CRUD operations including:
 * - Listing cases with pagination and filters
 * - Creating cases with auto-generated case numbers
 * - Updating cases with role-based restrictions
 * - Assigning investigators
 * - Closing and reopening cases
 * - Soft deleting cases
 */

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/config/database');
const { hashPassword } = require('../src/utils/password.util');

// =============================================================================
// TEST DATA
// =============================================================================

const testRunId = Date.now();

const testUsers = {
  admin: {
    email: `case.admin.${testRunId}@test.com`,
    password: 'AdminPass@123',
    name: 'Case Test Admin',
    role: 'ADMIN'
  },
  supervisor: {
    email: `case.supervisor.${testRunId}@test.com`,
    password: 'SuperPass@123',
    name: 'Case Test Supervisor',
    role: 'SUPERVISOR'
  },
  investigator1: {
    email: `case.investigator1.${testRunId}@test.com`,
    password: 'InvestPass@123',
    name: 'Case Test Investigator 1',
    role: 'INVESTIGATOR'
  },
  investigator2: {
    email: `case.investigator2.${testRunId}@test.com`,
    password: 'InvestPass@123',
    name: 'Case Test Investigator 2',
    role: 'INVESTIGATOR'
  }
};

let createdUsers = {};
let tokens = {};
let testCases = {};

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

  // Create some test cases
  testCases.case1 = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-99001`,
      title: 'Test Case 1 - Open',
      description: 'First test case',
      status: 'OPEN',
      priority: 2,
      createdById: createdUsers.supervisor.id,
      assignedInvestigatorId: createdUsers.investigator1.id
    }
  });

  testCases.case2 = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-99002`,
      title: 'Test Case 2 - Pending',
      description: 'Second test case',
      status: 'PENDING',
      priority: 1,
      createdById: createdUsers.admin.id,
      assignedInvestigatorId: createdUsers.investigator2.id
    }
  });

  testCases.case3 = await prisma.case.create({
    data: {
      caseNumber: `CASE-${new Date().getFullYear()}-99003`,
      title: 'Test Case 3 - Closed',
      description: 'Third test case - closed',
      status: 'CLOSED',
      priority: 3,
      createdById: createdUsers.supervisor.id,
      closedAt: new Date()
    }
  });
});

afterAll(async () => {
  // Clean up test cases
  await prisma.case.deleteMany({
    where: {
      caseNumber: {
        startsWith: `CASE-${new Date().getFullYear()}-99`
      }
    }
  });

  // Also clean up any cases created during tests
  await prisma.case.deleteMany({
    where: {
      createdById: {
        in: Object.values(createdUsers).map(u => u.id)
      }
    }
  });

  // Clean up audit logs
  await prisma.auditLog.deleteMany({
    where: {
      userId: {
        in: Object.values(createdUsers).map(u => u.id)
      }
    }
  });

  // Clean up notifications for test users
  await prisma.notification.deleteMany({
    where: {
      userId: {
        in: Object.values(createdUsers).map(u => u.id)
      }
    }
  });

  // Clean up test users
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: `${testRunId}`
      }
    }
  });
});

// =============================================================================
// GET /api/v1/cases - List Cases
// =============================================================================

describe('GET /api/v1/cases', () => {
  it('should allow admin to list all cases', async () => {
    const response = await request(app)
      .get('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.pagination).toBeDefined();
  });

  it('should allow supervisor to list all cases', async () => {
    const response = await request(app)
      .get('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should only show assigned cases to investigator', async () => {
    const response = await request(app)
      .get('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(response.status).toBe(200);
    
    // Investigator1 should only see cases assigned to them
    response.body.data.forEach(caseItem => {
      expect(caseItem.assignedInvestigator?.id).toBe(createdUsers.investigator1.id);
    });
  });

  it('should support pagination', async () => {
    const response = await request(app)
      .get('/api/v1/cases?page=1&limit=2')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(2);
    expect(response.body.data.length).toBeLessThanOrEqual(2);
  });

  it('should filter by status', async () => {
    const response = await request(app)
      .get('/api/v1/cases?status=OPEN')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    response.body.data.forEach(caseItem => {
      expect(caseItem.status).toBe('OPEN');
    });
  });

  it('should filter by priority', async () => {
    const response = await request(app)
      .get('/api/v1/cases?priority=1')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    response.body.data.forEach(caseItem => {
      expect(caseItem.priority).toBe(1);
    });
  });

  it('should search in title', async () => {
    const response = await request(app)
      .get('/api/v1/cases?search=Test Case 1')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should require authentication', async () => {
    const response = await request(app)
      .get('/api/v1/cases');

    expect(response.status).toBe(401);
  });
});

// =============================================================================
// GET /api/v1/cases/:id - Get Case by ID
// =============================================================================

describe('GET /api/v1/cases/:id', () => {
  it('should return case details for admin', async () => {
    const response = await request(app)
      .get(`/api/v1/cases/${testCases.case1.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(testCases.case1.id);
    expect(response.body.data.caseNumber).toBe(testCases.case1.caseNumber);
    expect(response.body.data.assignedInvestigator).toBeDefined();
    expect(response.body.data.createdBy).toBeDefined();
  });

  it('should allow investigator to view assigned case', async () => {
    const response = await request(app)
      .get(`/api/v1/cases/${testCases.case1.id}`)
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(testCases.case1.id);
  });

  it('should deny investigator from viewing unassigned case', async () => {
    const response = await request(app)
      .get(`/api/v1/cases/${testCases.case2.id}`)
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(response.status).toBe(403);
  });

  it('should return 404 for non-existent case', async () => {
    const response = await request(app)
      .get('/api/v1/cases/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(404);
  });
});

// =============================================================================
// GET /api/v1/cases/number/:caseNumber - Get Case by Number
// =============================================================================

describe('GET /api/v1/cases/number/:caseNumber', () => {
  it('should return case by case number', async () => {
    const response = await request(app)
      .get(`/api/v1/cases/number/${testCases.case1.caseNumber}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data.caseNumber).toBe(testCases.case1.caseNumber);
  });

  it('should reject invalid case number format', async () => {
    const response = await request(app)
      .get('/api/v1/cases/number/INVALID-123')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(400);
  });
});

// =============================================================================
// POST /api/v1/cases - Create Case
// =============================================================================

describe('POST /api/v1/cases', () => {
  let createdCaseId;

  afterAll(async () => {
    if (createdCaseId) {
      await prisma.case.delete({ where: { id: createdCaseId } }).catch(() => {});
    }
  });

  it('should allow admin to create case', async () => {
    const newCase = {
      title: 'New Test Case by Admin',
      description: 'Created by admin during tests',
      priority: 2
    };

    const response = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send(newCase);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.title).toBe(newCase.title);
    expect(response.body.data.caseNumber).toMatch(/^CASE-\d{4}-\d{5}$/);
    expect(response.body.data.status).toBe('OPEN');
    expect(response.body.data.createdBy.id).toBe(createdUsers.admin.id);

    createdCaseId = response.body.data.id;
  });

  it('should allow supervisor to create case', async () => {
    const response = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.supervisor}`)
      .send({
        title: 'Supervisor Created Case',
        description: 'Test case'
      });

    expect(response.status).toBe(201);
    
    // Clean up
    await prisma.case.delete({ where: { id: response.body.data.id } });
  });

  it('should deny investigator from creating case', async () => {
    const response = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .send({
        title: 'Should Not Create',
        description: 'Test'
      });

    expect(response.status).toBe(403);
  });

  it('should create case with assigned investigator', async () => {
    const response = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        title: 'Case with Assignment',
        assignedInvestigatorId: createdUsers.investigator1.id
      });

    expect(response.status).toBe(201);
    expect(response.body.data.assignedInvestigator.id).toBe(createdUsers.investigator1.id);

    // Clean up
    await prisma.case.delete({ where: { id: response.body.data.id } });
  });

  it('should reject assignment to non-investigator', async () => {
    const response = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        title: 'Invalid Assignment',
        assignedInvestigatorId: createdUsers.supervisor.id
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('INVESTIGATOR role');
  });

  it('should validate title length', async () => {
    const response = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        title: 'AB' // Too short
      });

    expect(response.status).toBe(400);
  });

  it('should default priority to 3', async () => {
    const response = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        title: 'Default Priority Case'
      });

    expect(response.status).toBe(201);
    expect(response.body.data.priority).toBe(3);

    // Clean up
    await prisma.case.delete({ where: { id: response.body.data.id } });
  });
});

// =============================================================================
// PUT /api/v1/cases/:id - Update Case
// =============================================================================

describe('PUT /api/v1/cases/:id', () => {
  it('should allow admin to update all fields', async () => {
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case1.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        title: 'Updated Title by Admin',
        priority: 1
      });

    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Updated Title by Admin');
    expect(response.body.data.priority).toBe(1);

    // Restore original
    await prisma.case.update({
      where: { id: testCases.case1.id },
      data: { title: testCases.case1.title, priority: testCases.case1.priority }
    });
  });

  it('should allow investigator to update only description', async () => {
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case1.id}`)
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .send({
        description: 'Updated by investigator'
      });

    expect(response.status).toBe(200);
    expect(response.body.data.description).toBe('Updated by investigator');

    // Restore
    await prisma.case.update({
      where: { id: testCases.case1.id },
      data: { description: testCases.case1.description }
    });
  });

  it('should deny investigator from updating title', async () => {
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case1.id}`)
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .send({
        title: 'Should Not Update'
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Investigators can only update');
  });

  it('should deny investigator from updating unassigned case', async () => {
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case2.id}`)
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .send({
        description: 'Should fail'
      });

    expect(response.status).toBe(403);
  });

  it('should validate status transitions', async () => {
    // Try to transition from CLOSED directly to PENDING (invalid)
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case3.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        status: 'PENDING'
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid status transition');
  });
});

// =============================================================================
// PUT /api/v1/cases/:id/assign - Assign Investigator
// =============================================================================

describe('PUT /api/v1/cases/:id/assign', () => {
  it('should allow supervisor to assign investigator', async () => {
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case3.id}/assign`)
      .set('Authorization', `Bearer ${tokens.supervisor}`)
      .send({
        investigatorId: createdUsers.investigator2.id
      });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedInvestigator.id).toBe(createdUsers.investigator2.id);

    // Unassign for cleanup
    await prisma.case.update({
      where: { id: testCases.case3.id },
      data: { assignedInvestigatorId: null }
    });
  });

  it('should allow unassigning investigator', async () => {
    // First assign
    await prisma.case.update({
      where: { id: testCases.case3.id },
      data: { assignedInvestigatorId: createdUsers.investigator1.id }
    });

    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case3.id}/assign`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        investigatorId: null
      });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedInvestigator).toBeNull();
    expect(response.body.message).toContain('unassigned');
  });

  it('should deny investigator from assigning', async () => {
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case1.id}/assign`)
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .send({
        investigatorId: createdUsers.investigator2.id
      });

    expect(response.status).toBe(403);
  });

  it('should reject non-investigator role assignment', async () => {
    const response = await request(app)
      .put(`/api/v1/cases/${testCases.case1.id}/assign`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        investigatorId: createdUsers.admin.id
      });

    expect(response.status).toBe(400);
  });
});

// =============================================================================
// POST /api/v1/cases/:id/close - Close Case
// =============================================================================

describe('POST /api/v1/cases/:id/close', () => {
  let caseToClose;

  beforeEach(async () => {
    caseToClose = await prisma.case.create({
      data: {
        caseNumber: `CASE-${new Date().getFullYear()}-99010`,
        title: 'Case to Close',
        status: 'OPEN',
        createdById: createdUsers.admin.id
      }
    });
  });

  afterEach(async () => {
    if (caseToClose) {
      await prisma.case.delete({ where: { id: caseToClose.id } }).catch(() => {});
    }
  });

  it('should allow supervisor to close case', async () => {
    const response = await request(app)
      .post(`/api/v1/cases/${caseToClose.id}/close`)
      .set('Authorization', `Bearer ${tokens.supervisor}`)
      .send({ reason: 'Investigation complete' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CLOSED');
    expect(response.body.data.closedAt).toBeDefined();
  });

  it('should deny investigator from closing case', async () => {
    const response = await request(app)
      .post(`/api/v1/cases/${caseToClose.id}/close`)
      .set('Authorization', `Bearer ${tokens.investigator1}`)
      .send({});

    expect(response.status).toBe(403);
  });

  it('should return 409 for already closed case', async () => {
    // Close it first
    await prisma.case.update({
      where: { id: caseToClose.id },
      data: { status: 'CLOSED', closedAt: new Date() }
    });

    const response = await request(app)
      .post(`/api/v1/cases/${caseToClose.id}/close`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({});

    expect(response.status).toBe(409);
  });
});

// =============================================================================
// POST /api/v1/cases/:id/reopen - Reopen Case
// =============================================================================

describe('POST /api/v1/cases/:id/reopen', () => {
  it('should allow admin to reopen closed case', async () => {
    const response = await request(app)
      .post(`/api/v1/cases/${testCases.case3.id}/reopen`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('OPEN');
    expect(response.body.data.closedAt).toBeNull();

    // Close it again for other tests
    await prisma.case.update({
      where: { id: testCases.case3.id },
      data: { status: 'CLOSED', closedAt: new Date() }
    });
  });

  it('should deny investigator from reopening case', async () => {
    const response = await request(app)
      .post(`/api/v1/cases/${testCases.case3.id}/reopen`)
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(response.status).toBe(403);
  });

  it('should return 409 for non-closed case', async () => {
    const response = await request(app)
      .post(`/api/v1/cases/${testCases.case1.id}/reopen`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(409);
  });
});

// =============================================================================
// DELETE /api/v1/cases/:id - Delete Case
// =============================================================================

describe('DELETE /api/v1/cases/:id', () => {
  let caseToDelete;

  beforeEach(async () => {
    caseToDelete = await prisma.case.create({
      data: {
        caseNumber: `CASE-${new Date().getFullYear()}-99020`,
        title: 'Case to Delete',
        status: 'OPEN',
        createdById: createdUsers.admin.id
      }
    });
  });

  afterEach(async () => {
    if (caseToDelete) {
      await prisma.case.delete({ where: { id: caseToDelete.id } }).catch(() => {});
    }
  });

  it('should allow admin to soft delete case', async () => {
    const response = await request(app)
      .delete(`/api/v1/cases/${caseToDelete.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data.deletedAt).toBeDefined();

    // Verify soft delete
    const deleted = await prisma.case.findUnique({ where: { id: caseToDelete.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('should deny supervisor from deleting case', async () => {
    const response = await request(app)
      .delete(`/api/v1/cases/${caseToDelete.id}`)
      .set('Authorization', `Bearer ${tokens.supervisor}`);

    expect(response.status).toBe(403);
  });

  it('should deny investigator from deleting case', async () => {
    const response = await request(app)
      .delete(`/api/v1/cases/${caseToDelete.id}`)
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(response.status).toBe(403);
  });
});

// =============================================================================
// GET /api/v1/cases/statistics - Case Statistics
// =============================================================================

describe('GET /api/v1/cases/statistics', () => {
  it('should return statistics for admin', async () => {
    const response = await request(app)
      .get('/api/v1/cases/statistics')
      .set('Authorization', `Bearer ${tokens.admin}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('total');
    expect(response.body.data).toHaveProperty('byStatus');
    expect(response.body.data.byStatus).toHaveProperty('open');
    expect(response.body.data.byStatus).toHaveProperty('closed');
    expect(response.body.data).toHaveProperty('byPriority');
    expect(response.body.data).toHaveProperty('recentCases');
  });

  it('should return filtered statistics for investigator', async () => {
    const response = await request(app)
      .get('/api/v1/cases/statistics')
      .set('Authorization', `Bearer ${tokens.investigator1}`);

    expect(response.status).toBe(200);
    // Investigator stats should only include their assigned cases
    expect(response.body.data).toHaveProperty('total');
  });
});
