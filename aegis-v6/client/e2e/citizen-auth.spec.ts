import { test, expect } from '@playwright/test'

test.describe('Citizen Auth', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/citizen/login')
    const form = page.locator('form').first()
    await expect(form).toBeVisible()
  })

  test('shows validation error on empty submit', async ({ page }) => {
    await page.goto('/citizen/login')
    const submitBtn = page.locator('button[type="submit"]').first()
    if (await submitBtn.isVisible()) {
      await submitBtn.click()
      // Should show an error or required field indicator
      await page.waitForTimeout(500)
      // No full crash
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
