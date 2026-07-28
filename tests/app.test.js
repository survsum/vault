/**
 * App Basic Tests
 * 
 * These tests verify that the Express application loads correctly
 * and basic endpoints work without requiring a database connection.
 */

const request = require('supertest');
const app = require('../src/app');

describe('App Basic Tests', () => {
  
  describe('Health Check', () => {
    it('should return 200 and success message', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Digital Evidence Vault is healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/v1/unknown-route')
        .expect('Content-Type', /json/)
        .expect(404);
      
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('not found');
    });
  });

  describe('API Documentation', () => {
    it('should serve Swagger UI', async () => {
      const response = await request(app)
        .get('/api-docs/')
        .expect(200);
      
      expect(response.text).toContain('swagger');
    });
  });

  describe('Security Headers', () => {
    it('should set security headers via Helmet', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      // Helmet should remove X-Powered-By
      expect(response.headers).not.toHaveProperty('x-powered-by');
      
      // Helmet should set X-Content-Type-Options
      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
    });
  });

  describe('CORS', () => {
    it('should allow CORS requests', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);
      
      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });

  describe('Implemented Routes', () => {
    it('auth login should require valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@test.com', password: 'test' })
        .expect(401);
      
      expect(response.body).toHaveProperty('success', false);
      // Should reject invalid credentials, not return 501
    });
  });
});
