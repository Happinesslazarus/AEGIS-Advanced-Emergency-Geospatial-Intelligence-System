/**
 * Module: accessibilityUtils.test.ts
 *
 * Tests for the accessibility utility functions — a collection of pure helpers
 * that implement WCAG (Web Content Accessibility Guidelines) requirements such
 * as focus management, keyboard navigation, motion reduction, and colour contrast.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   beforeEach/afterEach    = setup/teardown that runs before/after every test
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.spyOn()              = wraps an existing function to track calls without replacing it
 *   vi.restoreAllMocks()    = restores all spied functions to their originals
 *   getFocusableElements()  = returns all visible, non-disabled elements that can receive
 *                             keyboard focus inside a given container
 *   FOCUSABLE_SELECTORS     = CSS selector string listing all natively-focusable HTML elements
 *                             (button, input, select, textarea, a[href], [tabindex], etc.)
 *   focusFirstElement()     = moves keyboard focus to the first focusable element
 *   focusLastElement()      = moves keyboard focus to the last focusable element
 *   createFocusTrap()       = wraps a container so Tab/Shift-Tab cycle only within it;
 *                             essential for modals (WCAG 2.1 success criterion 2.4.3)
 *   activate/deactivate     = methods returned by createFocusTrap() to enable/disable the trap
 *   createRovingTabindex()  = implements the "roving tabindex" pattern for widget navigation:
 *                             one item has tabindex=0 (in tab order), others have tabindex=-1
 *                             (reachable only via arrow keys); used for toolbars, menus, tabs
 *   prefersReducedMotion()  = returns true if the OS accessibility setting "reduce motion"
 *                             is enabled (i.e. window.matchMedia('(prefers-reduced-motion: reduce)'))
 *   getSafeAnimationDuration() = returns the requested duration normally, or 0 if reduced
 *                             motion is preferred (disables CSS transitions for those users)
 *   getContrastRatio()      = calculates the WCAG contrast ratio between two hex colours;
 *                             ratio ranges 1:1 (identical) to 21:1 (black on white)
 *   meetsContrastAA()       = returns true if ratio ≥ 4.5:1 for normal text (or ≥ 3:1 for
 *                             large text, ≥ 18pt or 14pt bold) — WCAG AA standard
 *   meetsContrastAAA()      = returns true if ratio ≥ 7:1 for normal text — stricter AAA standard
 *   getAccessibleTextColor()= picks black (#000000) or white (#ffffff) to maximise contrast
 *                             against a given background colour
 *   generateAriaId()        = creates a unique ID string (e.g. 'aegis-1234') for use in
 *                             aria-labelledby / aria-describedby attributes
 *   createAriaDescribedBy() = returns { 'aria-describedby': id } attribute object
 *   createAriaLabelledBy()  = returns { 'aria-labelledby': 'id1 id2...' } attribute object
 *   getComputedStyle()      = browser API that returns the CSS properties of an element;
 *                             jsdom always returns empty strings, so it must be mocked
 *   offsetParent            = DOM property for an element's nearest positioned ancestor;
 *                             jsdom always returns null, so visibility checks need a mock
 *   tabindex=0              = element is in the natural tab order
 *   tabindex=-1             = element is focusable via JavaScript but not via Tab key
 *   aria-hidden="true"      = hides element from the accessibility tree (screen readers skip it)
 *   requestAnimationFrame   = schedules a callback before the next paint; used by focus-trap
 *                             to defer the initial focus so the DOM has time to be ready
 *   loop option             = when true, arrow navigation wraps from last item back to first
 *   orientation option      = 'horizontal' uses ArrowLeft/Right; 'vertical' uses ArrowUp/Down
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getFocusableElements,
  focusFirstElement,
  focusLastElement,
  createFocusTrap,
  createRovingTabindex,
  prefersReducedMotion,
  getSafeAnimationDuration,
  getContrastRatio,
  meetsContrastAA,
  meetsContrastAAA,
  getAccessibleTextColor,
  generateAriaId,
  createAriaDescribedBy,
  createAriaLabelledBy,
  FOCUSABLE_SELECTORS,
} from '../utils/accessibility'

// ---------------------------------------------------------------------------
// jsdom workarounds — jsdom does not implement CSS visibility or offsetParent
// ---------------------------------------------------------------------------

// Mock getComputedStyle to return visible styles (jsdom always returns empty strings)
const mockVisibleStyles = () => {
  const originalGetComputedStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    const styles = originalGetComputedStyle(el)
    return {
      ...styles,
      display: 'block',      // pretend element is block-displayed (not hidden via display:none)
      visibility: 'visible', // pretend element is not visibility:hidden
      opacity: '1',          // pretend element is not fully transparent
    } as CSSStyleDeclaration
  })
}

// Mock offsetParent — jsdom always returns null, causing visibility checks to fail
// Setting it to document.body makes the element appear as if it is in the rendered layout
const mockOffsetParent = (element: HTMLElement) => {
  Object.defineProperty(element, 'offsetParent', {
    get: () => document.body, // non-null → element is visible in the layout
    configurable: true,
  })
}

// ---------------------------------------------------------------------------
// getFocusableElements — discovers all keyboard-focusable elements in a subtree
// ---------------------------------------------------------------------------
describe('getFocusableElements', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container) // attach to real DOM so querySelector works
    mockVisibleStyles()
  })

  afterEach(() => {
    container.remove()
    vi.restoreAllMocks() // put getComputedStyle back to original
  })

  test('returns empty array for empty container', () => {
    // No elements inside → nothing to focus
    const elements = getFocusableElements(container)
    expect(elements).toEqual([])
  })

  test('finds buttons when visible', () => {
    // A visible, enabled <button> must be in the focusable set
    container.innerHTML = '<button>Click me</button>'
    const btn = container.querySelector('button')!
    mockOffsetParent(btn) // make it appear visually present
    
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(1)
    expect(elements[0].tagName).toBe('BUTTON')
  })

  test('finds links with href when visible', () => {
    // <a href="..."> is focusable; <a> without href is not (not in the tab order)
    container.innerHTML = '<a href="/test">Link</a>'
    const link = container.querySelector('a')!
    mockOffsetParent(link)
    
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(1)
    expect(elements[0].tagName).toBe('A')
  })

  test('finds inputs when visible', () => {
    // Visible text inputs are in the natural tab order
    container.innerHTML = '<input type="text" />'
    const input = container.querySelector('input')!
    mockOffsetParent(input)
    
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(1)
    expect(elements[0].tagName).toBe('INPUT')
  })

  test('excludes disabled elements', () => {
    // Disabled form controls are never focusable via keyboard
    container.innerHTML = `
      <button disabled>Disabled</button>
      <button id="enabled">Enabled</button>
    `
    const enabledBtn = container.querySelector('#enabled')!
    mockOffsetParent(enabledBtn as HTMLElement) // only the enabled one is "visible"
    
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(1)
    expect(elements[0].textContent).toBe('Enabled')
  })

  test('excludes hidden inputs', () => {
    // type="hidden" inputs have no visual presence and must not be focusable
    container.innerHTML = `
      <input type="hidden" />
      <input id="visible" type="text" />
    `
    const visibleInput = container.querySelector('#visible')!
    mockOffsetParent(visibleInput as HTMLElement)
    
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(1)
    expect(elements[0].getAttribute('type')).toBe('text')
  })

  test('excludes aria-hidden elements', () => {
    // aria-hidden="true" removes elements from the accessibility tree entirely;
    // a screen reader cannot reach them, so they must not be in the focusable set
    container.innerHTML = `
      <button aria-hidden="true">Hidden</button>
      <button id="visible">Visible</button>
    `
    const visibleBtn = container.querySelector('#visible')!
    mockOffsetParent(visibleBtn as HTMLElement)
    
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(1)
    expect(elements[0].textContent).toBe('Visible')
  })

  test('finds elements with positive tabindex when visible', () => {
    // Non-interactive elements (like <div>) become focusable when given tabindex="0"
    container.innerHTML = '<div tabindex="0">Focusable div</div>'
    const div = container.querySelector('div')!
    mockOffsetParent(div)
    
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(1)
  })

  test('excludes elements with tabindex=-1', () => {
    // tabindex="-1" means "focusable via JS but NOT via the Tab key"
    // getFocusableElements only returns elements reachable via keyboard Tab
    container.innerHTML = '<div tabindex="-1">Not focusable</div>'
    const elements = getFocusableElements(container)
    expect(elements).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// focusFirstElement — moves focus to the first item in a container
// ---------------------------------------------------------------------------
describe('focusFirstElement', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    mockVisibleStyles()
  })

  afterEach(() => {
    container.remove()
    vi.restoreAllMocks()
  })

  test('returns false for empty container', () => {
    // Nothing to focus; return value signals to callers whether focus was moved
    const result = focusFirstElement(container)
    expect(result).toBe(false)
  })

  test('focuses first element and returns true', () => {
    // Should move focus to the first button and return true to confirm success
    container.innerHTML = `
      <button id="first">First</button>
      <button id="second">Second</button>
    `
    const firstBtn = container.querySelector('#first')!
    const secondBtn = container.querySelector('#second')!
    mockOffsetParent(firstBtn as HTMLElement)
    mockOffsetParent(secondBtn as HTMLElement)
    
    const result = focusFirstElement(container)
    expect(result).toBe(true)
    expect(document.activeElement?.id).toBe('first') // first button is now focused
  })
})

// ---------------------------------------------------------------------------
// focusLastElement — moves focus to the last item (e.g. Shift-Tab entry point)
// ---------------------------------------------------------------------------
describe('focusLastElement', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    mockVisibleStyles()
  })

  afterEach(() => {
    container.remove()
    vi.restoreAllMocks()
  })

  test('returns false for empty container', () => {
    const result = focusLastElement(container)
    expect(result).toBe(false)
  })

  test('focuses last element and returns true', () => {
    // When the user Shift-Tabs past the first element, focus should land on the last one
    container.innerHTML = `
      <button id="first">First</button>
      <button id="second">Second</button>
    `
    const firstBtn = container.querySelector('#first')!
    const secondBtn = container.querySelector('#second')!
    mockOffsetParent(firstBtn as HTMLElement)
    mockOffsetParent(secondBtn as HTMLElement)
    
    const result = focusLastElement(container)
    expect(result).toBe(true)
    expect(document.activeElement?.id).toBe('second') // last button is now focused
  })
})

// ---------------------------------------------------------------------------
// createFocusTrap — confines Tab key cycling within a modal or dialog
// ---------------------------------------------------------------------------
describe('createFocusTrap', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    container.innerHTML = `
      <button id="btn1">First</button>
      <input id="input1" type="text" />
      <button id="btn2">Last</button>
    `
    document.body.appendChild(container)
    mockVisibleStyles()
    
    // Make all interactive elements appear visible to getFocusableElements
    container.querySelectorAll('button, input').forEach(el => {
      mockOffsetParent(el as HTMLElement)
    })
  })

  afterEach(() => {
    container.remove()
    vi.restoreAllMocks()
  })

  test('returns activate and deactivate functions', () => {
    // The trap API is just two functions — simple to use by modal components
    const trap = createFocusTrap(container)
    expect(typeof trap.activate).toBe('function')
    expect(typeof trap.deactivate).toBe('function')
  })

  test('activate focuses first element', async () => {
    // On activation, focus is sent to the first element in the trap (btn1)
    const trap = createFocusTrap(container)
    trap.activate()
    
    // Wait one animation frame — focus is deferred via requestAnimationFrame
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    expect(document.activeElement?.id).toBe('btn1')
  })

  test('registers Tab keydown handler when activated', async () => {
    // Activation must add a keydown listener to intercept Tab presses
    const trap = createFocusTrap(container)
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    
    trap.activate()
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    
    trap.deactivate()
    addEventListenerSpy.mockRestore()
  })

  test('removes Tab keydown handler when deactivated', async () => {
    // Deactivation must clean up the keydown listener to prevent memory leaks
    const trap = createFocusTrap(container)
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
    
    trap.activate()
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    trap.deactivate()
    
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    
    removeEventListenerSpy.mockRestore()
  })

  test('deactivate returns focus to previous element', async () => {
    // When the modal closes, focus should return to wherever it was before the modal opened
    // (e.g. the button that opened the modal — critical for screen-reader navigation flow)
    const outsideBtn = document.createElement('button')
    outsideBtn.id = 'outside'
    document.body.appendChild(outsideBtn)
    outsideBtn.focus() // focus is here before the trap opens
    
    const trap = createFocusTrap(container)
    trap.activate()
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(document.activeElement?.id).toBe('btn1') // focus now inside trap
    
    trap.deactivate()
    expect(document.activeElement?.id).toBe('outside') // focus returned to original element
    
    outsideBtn.remove()
  })
})

// ---------------------------------------------------------------------------
// createRovingTabindex — manages keyboard navigation inside widgets (menus, tabs)
// ---------------------------------------------------------------------------
describe('createRovingTabindex', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    container.innerHTML = `
      <button class="item">Item 1</button>
      <button class="item">Item 2</button>
      <button class="item">Item 3</button>
    `
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  test('returns cleanup function', () => {
    // The cleanup function removes event listeners when the widget unmounts
    const { cleanup } = createRovingTabindex(container, '.item')
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  test('sets first item tabindex to 0', () => {
    // On initialisation, first item gets tabindex=0 (in tab order);
    // all others get tabindex=-1 (reachable only via arrow keys)
    createRovingTabindex(container, '.item')
    const items = container.querySelectorAll('.item')
    expect(items[0].getAttribute('tabindex')).toBe('0')  // in tab order
    expect(items[1].getAttribute('tabindex')).toBe('-1') // skip with Tab
    expect(items[2].getAttribute('tabindex')).toBe('-1') // skip with Tab
  })

  test('handles ArrowRight navigation', () => {
    // Pressing ArrowRight should move focus (and tabindex=0) to the next item
    createRovingTabindex(container, '.item', { orientation: 'horizontal' })
    
    const items = container.querySelectorAll('.item')
    ;(items[0] as HTMLElement).focus() // start at first item
    
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true, // bubbles up to the container's keydown listener
    })
    items[0].dispatchEvent(event)
    
    // After navigation: item 0 loses tabindex=0, item 1 gains it
    expect(items[0].getAttribute('tabindex')).toBe('-1')
    expect(items[1].getAttribute('tabindex')).toBe('0')
  })

  test('handles ArrowLeft navigation', () => {
    // Pressing ArrowLeft should move focus back to the previous item
    createRovingTabindex(container, '.item', { orientation: 'horizontal' })
    
    const items = container.querySelectorAll('.item')
    items[0].setAttribute('tabindex', '-1')
    items[1].setAttribute('tabindex', '0') // start at item 1
    ;(items[1] as HTMLElement).focus()
    
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
    items[1].dispatchEvent(event)
    
    expect(items[0].getAttribute('tabindex')).toBe('0')  // moved back to item 0
    expect(items[1].getAttribute('tabindex')).toBe('-1')
  })

  test('handles Home key', () => {
    // Home key should jump focus to the very first item regardless of current position
    createRovingTabindex(container, '.item')
    
    const items = container.querySelectorAll('.item')
    items[2].setAttribute('tabindex', '0')  // currently at last item
    items[0].setAttribute('tabindex', '-1')
    items[1].setAttribute('tabindex', '-1')
    ;(items[2] as HTMLElement).focus()
    
    const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true })
    items[2].dispatchEvent(event)
    
    expect(items[0].getAttribute('tabindex')).toBe('0')  // jumped to first
    expect(items[2].getAttribute('tabindex')).toBe('-1')
  })

  test('handles End key', () => {
    // End key should jump focus to the very last item
    createRovingTabindex(container, '.item')
    
    const items = container.querySelectorAll('.item')
    ;(items[0] as HTMLElement).focus() // start at first item
    
    const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true })
    items[0].dispatchEvent(event)
    
    expect(items[2].getAttribute('tabindex')).toBe('0')  // jumped to last
    expect(items[0].getAttribute('tabindex')).toBe('-1')
  })

  test('loops when loop option is true (default)', () => {
    // When loop:true, pressing ArrowRight on the last item wraps to the first
    createRovingTabindex(container, '.item', { loop: true })
    
    const items = container.querySelectorAll('.item')
    items[0].setAttribute('tabindex', '-1')
    items[1].setAttribute('tabindex', '-1')
    items[2].setAttribute('tabindex', '0') // start at last item
    ;(items[2] as HTMLElement).focus()
    
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    items[2].dispatchEvent(event)
    
    // Wrap-around: last → first
    expect(items[0].getAttribute('tabindex')).toBe('0')
    expect(items[2].getAttribute('tabindex')).toBe('-1')
  })

  test('returns empty cleanup for no items', () => {
    // If the selector matches nothing, cleanup must still be callable without errors
    const emptyContainer = document.createElement('div')
    document.body.appendChild(emptyContainer)
    
    const { cleanup } = createRovingTabindex(emptyContainer, '.nonexistent')
    expect(() => cleanup()).not.toThrow()
    
    emptyContainer.remove()
  })
})

// ---------------------------------------------------------------------------
// prefersReducedMotion — reads the OS "reduce motion" accessibility setting
// ---------------------------------------------------------------------------
describe('prefersReducedMotion', () => {
  const originalMatchMedia = window.matchMedia // save original to restore after tests

  afterEach(() => {
    window.matchMedia = originalMatchMedia // restore so other tests are not affected
  })

  test('returns false when motion is not reduced', () => {
    // matchMedia returns {matches:false} → user has not requested reduced motion
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    expect(prefersReducedMotion()).toBe(false)
  })

  test('returns true when motion is reduced', () => {
    // matchMedia returns {matches:true} → OS accessibility setting is active
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    expect(prefersReducedMotion()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getSafeAnimationDuration — returns 0 when motion should be suppressed
// ---------------------------------------------------------------------------
describe('getSafeAnimationDuration', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  test('returns default duration when motion is allowed', () => {
    // User has no preference → use the requested duration as-is (e.g. 300ms transition)
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    expect(getSafeAnimationDuration(300)).toBe(300)
  })

  test('returns 0 when reduced motion is preferred', () => {
    // Disable all animations → pass 0 to make CSS transitions instant
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    expect(getSafeAnimationDuration(300)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getContrastRatio — WCAG contrast algorithm (luminance-based ratio)
// ---------------------------------------------------------------------------
describe('getContrastRatio', () => {
  test('returns 21 for black on white', () => {
    // Perfect contrast: black (#000) vs white (#fff) = 21:1 (maximum possible ratio)
    const ratio = getContrastRatio('#000000', '#ffffff')
    expect(ratio).toBeCloseTo(21, 0) // allow ±0.5 rounding
  })

  test('returns 21 for white on black', () => {
    // Contrast is symmetric: A vs B = B vs A
    const ratio = getContrastRatio('#ffffff', '#000000')
    expect(ratio).toBeCloseTo(21, 0)
  })

  test('returns 1 for same colors', () => {
    // Identical colours = no contrast at all = 1:1 (minimum possible ratio)
    const ratio = getContrastRatio('#ff0000', '#ff0000')
    expect(ratio).toBe(1)
  })

  test('returns 0 for invalid colors', () => {
    // Gracefully handle bad input; 0 signals "cannot evaluate" to the caller
    const ratio = getContrastRatio('invalid', '#ffffff')
    expect(ratio).toBe(0)
  })

  test('handles colors without hash', () => {
    // Accept hex colours both with and without the leading '#' character
    const ratio = getContrastRatio('000000', 'ffffff')
    expect(ratio).toBeCloseTo(21, 0)
  })
})

// ---------------------------------------------------------------------------
// meetsContrastAA — WCAG AA minimum contrast (4.5:1 normal, 3:1 large text)
// ---------------------------------------------------------------------------
describe('meetsContrastAA', () => {
  test('black on white meets AA for normal text', () => {
    // 21:1 >> 4.5:1 → always passes WCAG AA
    expect(meetsContrastAA('#000000', '#ffffff')).toBe(true)
  })

  test('low contrast fails AA for normal text', () => {
    // Light grey on slightly lighter grey (~1.35:1) — far below the 4.5:1 threshold
    expect(meetsContrastAA('#aaaaaa', '#cccccc')).toBe(false)
  })

  test('large text parameter is accepted', () => {
    // Large text (≥18pt regular or ≥14pt bold) only needs 3:1 ratio for AA
    // #767676 on #ffffff is ~4.54:1, which passes both normal and large AA tests
    expect(meetsContrastAA('#767676', '#ffffff', true)).toBe(true)
    expect(meetsContrastAA('#767676', '#ffffff', false)).toBe(true)
    expect(meetsContrastAA('#000000', '#ffffff', true)).toBe(true) // black always passes
  })
})

// ---------------------------------------------------------------------------
// meetsContrastAAA — WCAG AAA enhanced contrast (7:1 normal, 4.5:1 large text)
// ---------------------------------------------------------------------------
describe('meetsContrastAAA', () => {
  test('black on white meets AAA', () => {
    // 21:1 >> 7:1 → passes the stricter AAA standard
    expect(meetsContrastAAA('#000000', '#ffffff')).toBe(true)
  })

  test('medium contrast passes AA but fails AAA for normal text', () => {
    // #767676 on #ffffff ≈ 4.54:1 — above AA threshold (4.5:1) but below AAA (7:1)
    expect(meetsContrastAA('#767676', '#ffffff')).toBe(true)   // passes AA
    expect(meetsContrastAAA('#767676', '#ffffff')).toBe(false) // fails AAA
  })
})

// ---------------------------------------------------------------------------
// getAccessibleTextColor — chooses black or white text based on background
// ---------------------------------------------------------------------------
describe('getAccessibleTextColor', () => {
  test('returns black for light backgrounds', () => {
    // White/pale backgrounds have high luminance → black text gives best contrast
    expect(getAccessibleTextColor('#ffffff')).toBe('#000000')
    expect(getAccessibleTextColor('#eeeeee')).toBe('#000000')
  })

  test('returns white for dark backgrounds', () => {
    // Dark backgrounds have low luminance → white text gives best contrast
    expect(getAccessibleTextColor('#000000')).toBe('#ffffff')
    expect(getAccessibleTextColor('#333333')).toBe('#ffffff')
  })

  test('returns black for invalid color', () => {
    // Safe default: when colour cannot be parsed, black is safer (more readable on most surfaces)
    expect(getAccessibleTextColor('invalid')).toBe('#000000')
  })
})

// ---------------------------------------------------------------------------
// generateAriaId — creates unique IDs for ARIA attribute values
// ---------------------------------------------------------------------------
describe('generateAriaId', () => {
  test('generates unique IDs', () => {
    // Two successive calls must not collide (IDs are used to link labels to controls)
    const id1 = generateAriaId()
    const id2 = generateAriaId()
    expect(id1).not.toBe(id2)
  })

  test('uses default prefix', () => {
    // Default prefix 'aegis-' namespaces IDs to this application
    const id = generateAriaId()
    expect(id.startsWith('aegis-')).toBe(true)
  })

  test('uses custom prefix', () => {
    // Component-specific prefixes make IDs more readable in the DOM debugger
    const id = generateAriaId('modal')
    expect(id.startsWith('modal-')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createAriaDescribedBy — helper to build aria-describedby attribute objects
// ---------------------------------------------------------------------------
describe('createAriaDescribedBy', () => {
  test('returns aria-describedby attribute', () => {
    // aria-describedby links an input to its description text (e.g. error message)
    const attrs = createAriaDescribedBy('input-1', 'help-1')
    expect(attrs).toEqual({ 'aria-describedby': 'help-1' })
  })
})

// ---------------------------------------------------------------------------
// createAriaLabelledBy — helper to build aria-labelledby attribute objects
// ---------------------------------------------------------------------------
describe('createAriaLabelledBy', () => {
  test('returns aria-labelledby with single ID', () => {
    // aria-labelledby links a region to the element whose text is its label
    const attrs = createAriaLabelledBy('title-1')
    expect(attrs).toEqual({ 'aria-labelledby': 'title-1' })
  })

  test('returns aria-labelledby with multiple IDs', () => {
    // Multiple IDs are joined with a space; both elements contribute to the label
    const attrs = createAriaLabelledBy('title-1', 'subtitle-1')
    expect(attrs).toEqual({ 'aria-labelledby': 'title-1 subtitle-1' })
  })
})

// ---------------------------------------------------------------------------
// FOCUSABLE_SELECTORS — the global CSS selector string listing all focusable tags
// ---------------------------------------------------------------------------
describe('FOCUSABLE_SELECTORS', () => {
  test('is a string', () => {
    // Must be a CSS selector string that querySelectorAll() can accept
    expect(typeof FOCUSABLE_SELECTORS).toBe('string')
  })

  test('includes button selector', () => {
    // Buttons are the most common interactive element — must be covered
    expect(FOCUSABLE_SELECTORS).toContain('button')
  })

  test('includes input selector', () => {
    // Form inputs must be reachable by keyboard
    expect(FOCUSABLE_SELECTORS).toContain('input')
  })

  test('includes anchor selector', () => {
    // Only <a> with an href is natively focusable; bare <a> without href is not
    expect(FOCUSABLE_SELECTORS).toContain('a[href]')
  })
})

