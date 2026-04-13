/**
 * File: jest.config.js
 *
 * What this file does:
 * Jest configuration for the Aegis server-side tests. All tests run
 * sequentially (maxWorkers: 1) to prevent PostgreSQL deadlocks from
 * parallel TRUNCATE calls during fixture setup. forceExit ensures the
 * test runner exits cleanly even if pg.Pool connections are left open.
 *
 * Key settings:
 * - preset: ts-jest        — compiles TypeScript before running tests
 * - testEnvironment: node  — no DOM emulation needed (server tests only)
 * - testTimeout: 30s       — allows for real database connections in CI
 * - coverage threshold     — minimum 18% lines/statements (incremental)
 *
 * How it connects:
 * - Run with: npm test (from aegis-v6/server/)
 * - Test files in: server/src/__tests__/
 * - Coverage reports in: server/coverage/
 * - Requires a running PostgreSQL instance (set DATABASE_URL in .env.test)
 * - Learn more: https://jestjs.io/docs/configuration
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },

  // Run tests sequentially to avoid PostgreSQL deadlocks from parallel TRUNCATEs
  maxWorkers: 1,

  // Prevent jest from hanging when DB pools are left open
  forceExit: true,

  // Give integration tests time to connect to Postgres
  testTimeout: 30_000,

  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],

  // Only measure coverage on route / service / middleware files
  collectCoverageFrom: [
    'src/routes/aiRoutes.ts',
    'src/routes/chatRoutes.ts',
    'src/routes/communityRoutes.ts',
    'src/routes/citizenRoutes.ts',
    'src/routes/dataRoutes.ts',
    'src/routes/distressRoutes.ts',
    'src/routes/floodRoutes.ts',
    'src/routes/reportRoutes.ts',
    'src/routes/translationRoutes.ts',
    'src/services/chatService.ts',
    'src/services/cronJobs.ts',
    'src/services/modelMonitoringService.ts',
    'src/services/translationService.ts',
    'src/services/cacheService.ts',
    'src/routes/adminCacheRoutes.ts',
    'src/middleware/auth.ts',
    'src/middleware/internalAuth.ts',
    'src/middleware/validate.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],

  coverageThreshold: {
    global: {
      lines: 18,
      functions: 20,
      branches: 10,
      statements: 18,
    },
  },
}
