/**
 * Jest Configuration
 * 
 * This file configures Jest for testing the Digital Evidence Vault API.
 */

module.exports = {
  // Set NODE_ENV to 'test' for all tests
  testEnvironment: 'node',
  
  // Setup file to run before tests
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Test match patterns
  testMatch: ['**/tests/**/*.test.js'],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js' // Exclude server entry point
  ],
  
  // Coverage thresholds (optional, can enable later)
  // coverageThreshold: {
  //   global: {
  //     branches: 80,
  //     functions: 80,
  //     lines: 80,
  //     statements: 80
  //   }
  // },
  
  // Timeout for tests (10 seconds)
  testTimeout: 10000,
  
  // Verbose output
  verbose: true,
  
  // Force exit after tests complete
  forceExit: true,
  
  // Clear mocks between tests
  clearMocks: true
};
