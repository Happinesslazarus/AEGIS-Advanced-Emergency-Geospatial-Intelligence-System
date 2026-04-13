/**
 * Module: landing.spec.ts
 *
 * Landing test suite (automated tests for this feature).
 *
 * Simple explanation:
 * Verifies that landing works correctly.
 */

import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test('renders AEGIS hero title', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1, [class*="title"]').first()).toBeVisible()
  })

  test('has citizen interface link', async ({ page }) => {
    await page.goto('/')
    const citizenLink = page.getByRole('link', { name: /citizen/i })
    await expect(citizenLink).toBeVisible()
  })
})
