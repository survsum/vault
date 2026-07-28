/**
 * Authentication Tests
 * 
 * Tests for the authentication system including:
 * - Login/Logout
 * - Token refresh
 * - Password change
 * - Authorization
 * 
 * Note: These tests require a database connection.
 * Run with: npm test -- --testPathPatterns=auth.test
 */

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/config/database');
const { hashPassword } = require('../src/utils/password.util');
const { generateTokenPair } = require('../src/utils/jwt.util');

// Generate unique test identifiers to prevent conflicts between test runs
const testRunId = Date.now().toString(36);
const testEmails = {
  admin: `test-admin-${testRunId}@evidence-vault.com`,
  user: `test-user-${testRunId}@evidence-vault.com`,
  newUser: `new-test-user-${testRunId}@evidence-vault.com`,
  changePass: `changepass-${testRunId}@evidence-vault.com`
};

describe('Authentication System', () => {
  // Test user data
  let testUser;
  let adminUser;
  let adminTokens;

  beforeAll(async () => {
    // Create test users
    const passwordHash = await hashPassword('Test@123456');
    
    // Create admin user
    adminUser = await prisma.user.create({
      data: {
        email: testEmails.admin,
        name: 'Test Admin',
        passwordHash,
        role: 'ADMIN'
      }
    });

    adminTokens = generateTokenPair({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role
    });

    // Create regular test user
    testUser = await prisma.user.create({
      data: {
        email: testEmails.user,
        name: 'Test User',
        passwordHash,
        role: 'INVESTIGATOR'
      }
    });
  });

  afterAll(async () => {
    // Clean up test users - find all users by our test run prefix
    const testUserIds = [adminUser?.id, testUser?.id].filter(Boolean);
    
    if (testUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          userId: { in: testUserIds }
        }
      });
      await prisma.refreshToken.deleteMany({
        where: {
          userId: { in: testUserIds }
        }
      });
    }
    
    // Delete test users by email pattern
    await prisma.user.deleteMany({
      where: {
        email: { contains: testRunId }
      }
    });
    
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'Test@123456'
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.user.email).toBe(testEmails.user);
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('should fail with invalid password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'WrongPassword123!'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid');
    });

    it('should fail with non-existent email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@evidence-vault.com',
          password: 'Test@123456'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should fail with missing credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeDefined();
    });

    it('should fail with invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'invalid-email',
          password: 'Test@123456'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register user when authenticated as admin', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          email: testEmails.newUser,
          password: 'NewUser@123456',
          confirmPassword: 'NewUser@123456',
          name: 'New Test User',
          role: 'INVESTIGATOR'
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testEmails.newUser);
      expect(response.body.data.user.role).toBe('INVESTIGATOR');
    });

    it('should fail without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'another-user@evidence-vault.com',
          password: 'Another@123456',
          confirmPassword: 'Another@123456',
          name: 'Another User'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should fail when non-admin tries to register', async () => {
      // Login as regular user
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'Test@123456'
        });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
        .send({
          email: 'another-user@evidence-vault.com',
          password: 'Another@123456',
          confirmPassword: 'Another@123456',
          name: 'Another User'
        })
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should fail with weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          email: 'weak-pass@evidence-vault.com',
          password: '123456', // Too weak
          confirmPassword: '123456',
          name: 'Weak Password User'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeDefined();
    });

    it('should fail with password mismatch', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          email: 'mismatch@evidence-vault.com',
          password: 'Password@123456',
          confirmPassword: 'Different@123456',
          name: 'Mismatch User'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should fail with duplicate email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send({
          email: testEmails.user, // Already exists
          password: 'Duplicate@123456',
          confirmPassword: 'Duplicate@123456',
          name: 'Duplicate User'
        })
        .expect(409);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let validRefreshToken;

    beforeAll(async () => {
      // Login to get a refresh token
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'Test@123456'
        });

      validRefreshToken = response.body.data.refreshToken;
    });

    it('should refresh tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: validRefreshToken
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      
      // Update for next tests
      validRefreshToken = response.body.data.refreshToken;
    });

    it('should fail with invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'invalid-token'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should fail with missing refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return user profile when authenticated', async () => {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'Test@123456'
        });

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testEmails.user);
      expect(response.body.data.user.name).toBe('Test User');
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('should fail without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should fail with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully', async () => {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'Test@123456'
        });

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
        .send({
          refreshToken: loginResponse.body.data.refreshToken
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out');
    });

    it('should fail without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/change-password', () => {
    it('should change password with valid current password', async () => {
      // Create a user specifically for password change test
      const passwordHash = await hashPassword('Original@123456');
      const changePassUser = await prisma.user.create({
        data: {
          email: testEmails.changePass,
          name: 'Change Pass User',
          passwordHash,
          role: 'INVESTIGATOR'
        }
      });

      // Login
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.changePass,
          password: 'Original@123456'
        });

      // Change password
      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
        .send({
          currentPassword: 'Original@123456',
          newPassword: 'NewPassword@123456',
          confirmPassword: 'NewPassword@123456'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify can login with new password
      const newLoginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.changePass,
          password: 'NewPassword@123456'
        })
        .expect(200);

      expect(newLoginResponse.body.success).toBe(true);

      // Clean up
      await prisma.auditLog.deleteMany({ where: { userId: changePassUser.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: changePassUser.id } });
      await prisma.user.delete({ where: { id: changePassUser.id } });
    });

    it('should fail with wrong current password', async () => {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'Test@123456'
        });

      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
        .send({
          currentPassword: 'WrongPassword@123',
          newPassword: 'NewPassword@123456',
          confirmPassword: 'NewPassword@123456'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should fail when new password same as current', async () => {
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmails.user,
          password: 'Test@123456'
        });

      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
        .send({
          currentPassword: 'Test@123456',
          newPassword: 'Test@123456',
          confirmPassword: 'Test@123456'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });
});
