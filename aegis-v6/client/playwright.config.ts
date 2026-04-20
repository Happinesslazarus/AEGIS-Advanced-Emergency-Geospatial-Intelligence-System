/**
 * File: playwright.config.ts
 *
 * What this file does:
 * Playwright end-to-end test configuration for the Aegis client. Runs
 * all tests in ./e2e/ against Chromium and Firefox. In CI, tests run
 * single-threaded with 2 retries; locally they run in parallel.
 *
 * Key settings:
 * - baseURL: http://localhost:5173 (dev server) or E2E_BASE_URL env var
 * - trace: on-first-retry    -- captures Playwright trace on flaky retries
 * - screenshot: only-on-failure -- saves screenshots when a test fails
 * - webServer              -- in CI, starts `npm run preview` on port 4173
 *
 * How it connects:
 * - Run with: npx playwright test (from aegis-v6/client/)
 * - Test files in: client/e2e/
 * - HTML report saved to client/playwright-report/
 * - Requires the client and server both running (or CI Docker setup)
 * - Learn more: https://playwright.dev/docs/test-configuration
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: process.env.CI ? {
    command: 'npm run preview',
    port: 4173,
    reuseExistingServer: false,
  } : undefined,
})
