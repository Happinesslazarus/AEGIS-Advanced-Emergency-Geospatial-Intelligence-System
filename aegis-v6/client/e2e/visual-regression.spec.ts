/**
 * Module: visual-regression.spec.ts
 *
 * Visual-regression test suite (automated tests for this feature).
 *
 * Simple explanation:
 * Verifies that visual-regression works correctly.
 */

import { test, expect } from '@playwright/test'

//VISUAL TEST CONFIGURATION

/** Default snapshot options */
const SNAPSHOT_OPTIONS = {
  maxDiffPixels: 100, // Allow small anti-aliasing differences
  maxDiffPixelRatio: 0.01, // 1% tolerance
  threshold: 0.2, // Color comparison threshold
}

/** Viewports to test */
const VIEWPORTS = {
  mobile: { width: 375, height: 812 }, // iPhone X
  tablet: { width: 768, height: 1024 }, // iPad
  desktop: { width: 1920, height: 1080 },
}

/** Themes to test */
const THEMES = ['default', 'light', 'midnight', 'ocean', 'forest', 'sunset', 'crimson', 'slate']

//VISUAL REGRESSION TESTS

test.describe('Visual Regression - Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('homepage renders correctly', async ({ page }) => {
    await expect(page).toHaveScreenshot('landing-page.png', SNAPSHOT_OPTIONS)
  })

  test('dark mode renders correctly', async ({ page }) => {
    //Enable dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      localStorage.setItem('aegis-theme', 'default')
    })
    await page.waitForTimeout(100)
    
    await expect(page).toHaveScreenshot('landing-page-dark.png', SNAPSHOT_OPTIONS)
  })

  test('mobile viewport', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await expect(page).toHaveScreenshot('landing-page-mobile.png', SNAPSHOT_OPTIONS)
  })

  test('high contrast mode', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.classList.add('high-contrast')
    })
    await page.waitForTimeout(100)
    
    await expect(page).toHaveScreenshot('landing-page-high-contrast.png', SNAPSHOT_OPTIONS)
  })
})

test.describe('Visual Regression - Theme Consistency', () => {
  for (const theme of THEMES) {
    test(`theme: ${theme}`, async ({ page }) => {
      await page.goto('/')
      
      await page.evaluate((themeName) => {
        localStorage.setItem('aegis-theme', themeName)
        document.documentElement.setAttribute('data-theme', themeName)
        const isDark = themeName !== 'light' && themeName !== 'sunset'
        document.documentElement.classList.toggle('dark', isDark)
      }, theme)
      
      await page.waitForTimeout(200) // Allow theme transition
      
      await expect(page).toHaveScreenshot(`theme-${theme}.png`, SNAPSHOT_OPTIONS)
    })
  }
})

test.describe('Visual Regression - Component States', () => {
  test('button hover state', async ({ page }) => {
    await page.goto('/')
    
    const button = page.locator('button').first()
    await button.hover()
    
    await expect(button).toHaveScreenshot('button-hover.png', SNAPSHOT_OPTIONS)
  })

  test('button focus state', async ({ page }) => {
    await page.goto('/')
    
    const button = page.locator('button').first()
    await button.focus()
    
    await expect(button).toHaveScreenshot('button-focus.png', SNAPSHOT_OPTIONS)
  })
})

test.describe('Visual Regression - Responsive Layouts', () => {
  const pages = ['/', '/about', '/privacy', '/alerts']
  
  for (const pagePath of pages) {
    test.describe(pagePath, () => {
      test.beforeEach(async ({ page }) => {
        await page.goto(pagePath)
        await page.waitForLoadState('networkidle')
      })

      test('desktop', async ({ page }) => {
        await page.setViewportSize(VIEWPORTS.desktop)
        await expect(page).toHaveScreenshot(`${pagePath.replace(/\//g, '-') || 'home'}-desktop.png`, SNAPSHOT_OPTIONS)
      })

      test('tablet', async ({ page }) => {
        await page.setViewportSize(VIEWPORTS.tablet)
        await expect(page).toHaveScreenshot(`${pagePath.replace(/\//g, '-') || 'home'}-tablet.png`, SNAPSHOT_OPTIONS)
      })

      test('mobile', async ({ page }) => {
        await page.setViewportSize(VIEWPORTS.mobile)
        await expect(page).toHaveScreenshot(`${pagePath.replace(/\//g, '-') || 'home'}-mobile.png`, SNAPSHOT_OPTIONS)
      })
    })
  }
})

test.describe('Visual Regression - Animation Timing', () => {
  test('modal animation completes', async ({ page }) => {
    await page.goto('/')
    
    //Trigger a modal (adjust selector as needed)
    const trigger = page.locator('[data-modal-trigger]').first()
    if (await trigger.count() > 0) {
      await trigger.click()
      
      //Wait for animation to complete (300ms + buffer)
      await page.waitForTimeout(400)
      
      await expect(page).toHaveScreenshot('modal-open.png', SNAPSHOT_OPTIONS)
    }
  })

  test('dropdown animation completes', async ({ page }) => {
    await page.goto('/')
    
    const dropdown = page.locator('[data-dropdown-trigger]').first()
    if (await dropdown.count() > 0) {
      await dropdown.click()
      await page.waitForTimeout(250)
      
      await expect(page).toHaveScreenshot('dropdown-open.png', SNAPSHOT_OPTIONS)
    }
  })
})

test.describe('Visual Regression - Cross-Browser Quirks', () => {
  test('focus ring visibility', async ({ page }) => {
    await page.goto('/')
    
    //Tab to first focusable element
    await page.keyboard.press('Tab')
    
    const focused = page.locator(':focus')
    await expect(focused).toBeVisible()
    
    //Screenshot focused element
    await expect(focused).toHaveScreenshot('focus-ring.png', {
      ...SNAPSHOT_OPTIONS,
      maxDiffPixels: 200, // Focus rings can vary across browsers
    })
  })

  test('scrollbar styling', async ({ page }) => {
    //Navigate to a page with scrollable content
    await page.goto('/alerts')
    await page.setViewportSize({ width: 1200, height: 600 })
    
    //Scroll to trigger scrollbar visibility
    await page.evaluate(() => window.scrollTo(0, 500))
    
    await expect(page).toHaveScreenshot('scrollbar-styling.png', {
      ...SNAPSHOT_OPTIONS,
      maxDiffPixels: 500, // Scrollbars vary significantly across browsers
    })
  })
})

//ACCESSIBILITY VISUAL TESTS

test.describe('Visual Regression - Accessibility', () => {
  test('large text mode', async ({ page }) => {
    await page.goto('/')
    
    await page.evaluate(() => {
      document.documentElement.classList.add('large-text')
    })
    
    await expect(page).toHaveScreenshot('accessibility-large-text.png', SNAPSHOT_OPTIONS)
  })

  test('reduced motion mode', async ({ page }) => {
    await page.goto('/')
    
    await page.evaluate(() => {
      document.documentElement.classList.add('reduce-motion')
    })
    
    //Trigger something that would normally animate
    await page.mouse.move(500, 300)
    
    await expect(page).toHaveScreenshot('accessibility-reduced-motion.png', SNAPSHOT_OPTIONS)
  })

  test('forced colors mode simulation', async ({ page }) => {
    await page.goto('/')
    
    //We can't truly force Windows High Contrast Mode,
    //but we can test our CSS handles it
    await page.addStyleTag({
      content: `
        @media (forced-colors: active) {
          * { border-color: CanvasText !important; }
        }
      `
    })
    
    await expect(page).toHaveScreenshot('accessibility-forced-colors.png', {
      ...SNAPSHOT_OPTIONS,
      maxDiffPixels: 1000, // Forced colors significantly changes appearance
    })
  })
})

//RTL LAYOUT TESTS

test.describe('Visual Regression - RTL Layouts', () => {
  test('Arabic RTL layout', async ({ page }) => {
    await page.goto('/')
    
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl')
      document.documentElement.setAttribute('lang', 'ar')
    })
    
    await expect(page).toHaveScreenshot('rtl-layout.png', SNAPSHOT_OPTIONS)
  })
})
