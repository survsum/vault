/**
 * Jest Test Setup
 * 
 * This file runs before all tests and sets up the test environment.
 */

// Set NODE_ENV to 'test' to disable rate limiting and enable test-specific behaviors
process.env.NODE_ENV = 'test';

// Increase timeout for database operations
jest.setTimeout(30000);

// Suppress console logs during tests (optional, uncomment if needed)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };
