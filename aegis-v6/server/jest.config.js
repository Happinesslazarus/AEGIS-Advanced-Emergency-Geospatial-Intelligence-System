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
