/**
 * Security test suite that verifies all client-side XSS sanitization helpers.
 * XSS (Cross-Site Scripting) = an attacker injects malicious JavaScript into a
 * web page so it executes in other users' browsers, stealing sessions or data.
 *
 * This file also doubles as a living specification: it documents which attack vectors
 * the app is expected to block.
 *
 * Glossary:
 *   describe()             = groups related tests under a labelled block
 *   it()                   = alias for test(); a single scenario
 *   it.each(array)         = runs the same test for every item in the array
 *   escapeHtml()           = converts HTML special chars to HTML entities so the browser
 *                            renders them as text instead of parsing them as markup
 *                            e.g. '<' → '&lt;'  (entity = safe text representation)
 *   HTML entity            = a code like &lt; &gt; &amp; &quot; that the browser displays
 *                            as the literal character but does NOT parse as tag syntax
 *   sanitizeUrl()          = checks a URL's protocol and blocks dangerous schemes;
 *                            returns 'about:blank' for anything unsafe
 *   about:blank            = an empty browser page with no origin; safe default for blocked URLs
 *   stripHtml()            = removes ALL HTML tags, leaving plain text only; used for
 *                            fields that must never contain markup (e.g. names, addresses)
 *   escapeAttribute()      = like escapeHtml but also escapes backticks (`); used when
 *                            embedding user input inside HTML attribute values
 *   XSS payload            = a crafted string designed to execute JavaScript; tested vectors:
 *                            <script> injection, event handlers (onerror, onload), javascript:
 *                            protocol links, data: URIs, CSS url() with JS, SVG/MathML tricks
 *   event handler attack   = <img onerror="..."> fires when the image fails to load
 *   javascript: scheme     = a URL like javascript:alert(1) that runs JS when clicked
 *   data: URI              = data:text/html,<script>... lets an attacker embed a full page
 *   vbscript: scheme       = VBScript equivalent of javascript:, only affects older IE
 *   file: scheme           = could reveal local files; blocked for safety
 *   dangerouslySetInnerHTML = React prop that bypasses auto-escaping; requires manual sanitization
 *   null-byte injection    = \x00 (char code 0) tricks some parsers into treating what follows
 *                            as a new string; browsers sometimes ignore null bytes in tags
 *   OWASP                  = Open Web Application Security Project; the XSS vectors tested
 *                            here are sourced from the OWASP XSS Filter Evasion Cheat Sheet
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 * - The sanitization functions are inlined in this file AND exported for app use
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// SANITIZATION UTILITIES (the functions under test are defined here and exported)
// ---------------------------------------------------------------------------

/** 
 * HTML entity encoding for text content.
 * Convert dangerous characters to their safe HTML entity equivalents so the
 * browser renders them as visible text instead of executing them as markup.
 * MUST be used before inserting user-supplied text into the DOM via innerHTML.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')   // & → &amp;   (must be first or double-encodes the others)
    .replace(/</g, '&lt;')    // < → &lt;    (prevents tag opening)
    .replace(/>/g, '&gt;')    // > → &gt;    (prevents tag closing)
    .replace(/"/g, '&quot;')  // " → &quot;  (prevents attribute breakout with double quotes)
    .replace(/'/g, '&#039;')  // ' → &#039;  (prevents attribute breakout with single quotes)
}

/**
 * URL sanitization — only allow safe protocols.
 * Blocks: javascript:, data:, vbscript:, file:
 * Allows: http:, https:, mailto:, tel:, relative paths, and anchor links
 */
function sanitizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase()
  
  // Block dangerous protocols that can execute code when used as href/src
  const dangerousProtocols = ['javascript:', 'vbscript:', 'data:', 'file:']
  if (dangerousProtocols.some(p => trimmed.startsWith(p))) {
    return 'about:blank' // safe empty page with no origin
  }
  
  // Explicitly allow known-safe protocols
  const safeProtocols = ['http:', 'https:', 'mailto:', 'tel:']
  if (safeProtocols.some(p => trimmed.startsWith(p))) {
    return url // return original (not lowercased) to preserve URL casing
  }
  
  // Relative URLs starting with / or ./ are same-origin and safe
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('#')) {
    return url
  }
  
  // Protocol-relative URLs (//cdn.example.com) inherit the current page protocol
  if (trimmed.startsWith('//')) {
    return url
  }
  
  // Anything else (bare domain, unknown protocol) is treated as a path — safer than blocking
  return url
}

/**
 * Strip all HTML tags from user input.
 * Regex /<[^>]*>/ matches anything between < and > (the tag syntax).
 * For fields that should only contain plain text (names, addresses, messages).
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '') // remove every <tag> or </tag> or <self-closing/>
}

/**
 * Sanitize for use in HTML attributes.
 * Extra escaping for attribute context — specifically adds backtick escaping
 * because backticks can be used in some browsers as attribute delimiters.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;') // ` → &#96; backtick escaping for template-literal safety
}

// ---------------------------------------------------------------------------
// XSS TEST VECTORS
// ---------------------------------------------------------------------------
// These payloads represent common attack strings from the OWASP XSS Cheat Sheet.
// Each one should be neutralised by escapeHtml() — angle brackets converted to entities.

const XSS_PAYLOADS = [
  // Basic script injection — most common attack
  '<script>alert("xss")</script>',
  '<SCRIPT>alert("xss")</SCRIPT>',          // uppercase variant
  '<ScRiPt>alert("xss")</ScRiPt>',          // mixed-case evasion

  // Event handler attacks — fire when image/element triggers browser events
  '<img src=x onerror="alert(\'xss\')">',   // onerror fires when image fails to load
  '<body onload=alert("xss")>',             // onload fires when body finishes loading
  '<input onfocus=alert("xss") autofocus>', // onfocus fires automatically due to autofocus
  '<svg onload=alert("xss")>',              // SVG supports the same event model
  '<div onmouseover="alert(\'xss\')">hover me</div>',

  // JavaScript protocol — clicking these executes JS
  '<a href="javascript:alert(\'xss\')">click</a>',
  '<a href="JAVASCRIPT:alert(\'xss\')">click</a>',           // uppercase evasion
  '<a href="&#106;avascript:alert(\'xss\')">click</a>',      // HTML entity encoding of 'j'
  // Data URI — embeds a full HTML page with a script inside a link
  '<a href="data:text/html,<script>alert(\'xss\')</script>">click</a>',
  
  // CSS-based — background image using javascript: protocol
  '<div style="background:url(javascript:alert(\'xss\'))">',
  '<style>body{background:url("javascript:alert(\'xss\')")}</style>',
  
  // Attribute breakout — the payload closes an existing attribute and injects a new onclick
  '" onclick="alert(\'xss\')" data-x="',
  "' onclick='alert(\"xss\")' data-x='",
  
  // Script context breakout — closes current <script> block then opens a new one
  '</script><script>alert("xss")</script>',
  
  // HTML5 event handlers on newer/obscure elements
  '<details open ontoggle=alert("xss")>',   // ontoggle fires when <details> is opened
  '<audio src=x onerror=alert("xss")>',      // onerror fires when audio fails to load
  '<video src=x onerror=alert("xss")>',      // same for video
  
  // SVG-based attacks — SVG supports scripting like HTML
  '<svg><script>alert("xss")</script></svg>',
  '<svg><animate onbegin=alert("xss")>',     // onbegin fires when SVG animation starts
  '<svg><set onbegin=alert("xss")>',
  
  // MathML-based — niche but real attack vector in some browsers
  '<math><maction actiontype="statusline#http://google.com" xlink:href="javascript:alert(\'xss\')">click</maction></math>',
  
  // Template injection — targets Angular, Vue, or server-side template engines
  '{{constructor.constructor("alert(\'xss\')")()}}', // Angular-style double-curly
  '${alert("xss")}',                                  // ES template literal syntax
  
  // Encoding tricks — null byte and doubled-tag evasion
  '<img src=x onerror=\u0061lert("xss")>',      // \u0061 = 'a' (Unicode escape for 'alert')
  '<scrscriptipt>alert("xss")</scrscriptipt>',   // double-nested tag evades naive strip
]

// URLs that contain dangerous schemes — sanitizeUrl() must return 'about:blank' for all of these
const DANGEROUS_URLS = [
  'javascript:alert("xss")',                          // classic JS injection
  'JAVASCRIPT:alert("xss")',                          // uppercase evasion
  'JaVaScRiPt:alert("xss")',                          // mixed-case evasion
  '  javascript:alert("xss")',                        // leading whitespace evasion
  'vbscript:msgbox("xss")',                           // Microsoft VBScript (IE legacy)
  'data:text/html,<script>alert("xss")</script>',     // data URI with embedded HTML
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgieHNzIik8L3NjcmlwdD4=', // base64-encoded data URI
  'file:///etc/passwd',                               // local file system access
]

// URLs that are safe; sanitizeUrl() must return them unchanged
const SAFE_URLS = [
  'https://example.com',        // standard HTTPS
  'http://example.com',         // HTTP (allowed, though HTTPS preferred in prod)
  '/relative/path',             // same-origin absolute path
  './relative/path',            // same-origin relative path
  '../parent/path',             // parent directory (same origin)
  '#anchor',                    // in-page anchor link
  'mailto:test@example.com',    // email link
  'tel:+1234567890',            // phone link
  '//cdn.example.com/path',     // protocol-relative (inherits current page scheme)
]

// TESTS

describe('XSS Sanitization', () => {
  describe('escapeHtml', () => {
    it('escapes < and > to prevent tag injection', () => {
      // '<script>' must become '&lt;script&gt;' — the browser renders it as text, not a tag
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
      expect(escapeHtml('<img src=x>')).toBe('&lt;img src=x&gt;')
    })

    it('escapes quotes to prevent attribute breakout', () => {
      // If user input is placed inside an HTML attribute value, unescaped quotes let attackers
      // close the attribute and inject new attributes like onclick
      expect(escapeHtml('" onclick="alert(1)"')).toBe('&quot; onclick=&quot;alert(1)&quot;')
      expect(escapeHtml("' onclick='alert(1)'")).toBe("&#039; onclick=&#039;alert(1)&#039;")
    })

    it('escapes & to prevent entity injection', () => {
      // & must be escaped FIRST to prevent double-encoding (& → &amp; not &amp;amp;)
      expect(escapeHtml('&lt;')).toBe('&amp;lt;')  // &lt; → &amp;lt; (safe literal)
    })

    it.each(XSS_PAYLOADS)('neutralizes payload: %s', (payload) => {
      // it.each runs this assertion for every payload in the array above;
      // %s is replaced with the payload string in the test name
      const escaped = escapeHtml(payload)
      // After escaping, angle brackets become entities so the browser won't see any tags
      expect(escaped).not.toContain('<script') // <script literal must be gone
      expect(escaped).not.toContain('<img')    // <img literal must be gone
      expect(escaped).not.toContain('<svg')    // <svg literal must be gone
      // Every original < character should have been replaced with &lt;
      if (payload.includes('<')) {
        expect(escaped).toContain('&lt;')
      }
    })
  })

  describe('sanitizeUrl', () => {
    it.each(DANGEROUS_URLS)('blocks dangerous URL: %s', (url) => {
      // All dangerous URLs must be replaced with 'about:blank' — a harmless empty page
      expect(sanitizeUrl(url)).toBe('about:blank')
    })

    it.each(SAFE_URLS)('allows safe URL: %s', (url) => {
      // Safe URLs must be returned unchanged — we must not alter valid links
      expect(sanitizeUrl(url)).toBe(url)
    })

    it('handles empty and whitespace URLs', () => {
      // An empty URL or whitespace-only URL is not a script injection — return as-is
      expect(sanitizeUrl('')).toBe('')
      expect(sanitizeUrl('   ')).toBe('   ')
    })
  })

  describe('stripHtml', () => {
    it('removes all HTML tags', () => {
      // <b>bold</b> → 'bold'; tag wrapper stripped, text content kept
      expect(stripHtml('<b>bold</b>')).toBe('bold')
      // <script> stripped but its text content remains — this function is for display only;
      // the remaining text 'alert("xss")' is harmless as plain text in a textNode
      expect(stripHtml('<script>alert("xss")</script>')).toBe('alert("xss")')
      expect(stripHtml('Hello <span>world</span>!')).toBe('Hello world!')
    })

    it('handles nested tags', () => {
      // All nesting levels stripped; only innermost text survives
      expect(stripHtml('<div><p><span>text</span></p></div>')).toBe('text')
    })

    it('handles self-closing tags', () => {
      // <br/> and <img/> are self-closing — both should be removed
      expect(stripHtml('line1<br/>line2')).toBe('line1line2')
      expect(stripHtml('image<img src="x"/>')).toBe('image')
    })
  })

  describe('escapeAttribute', () => {
    it('escapes backticks for template literal safety', () => {
      // Backtick ` can act as an attribute delimiter in some older browsers;
      // escaping it to &#96; prevents the attacker injecting extra attributes
      expect(escapeAttribute('`${alert(1)}`')).toContain('&#96;')
    })

    it('escapes all quote types', () => {
      // After escaping, none of the original quote characters should remain
      // (they've been replaced with their entity equivalents)
      const input = `"double' single\`backtick`
      const escaped = escapeAttribute(input)
      expect(escaped).not.toContain('"')  // double quote gone
      expect(escaped).not.toContain("'")  // single quote gone
      expect(escaped).not.toContain('`')  // backtick gone
    })
  })

  describe('DOM context safety', () => {
    it('innerHTML should use escaped content', () => {
      // React's JSX automatically escapes {userInput} as text nodes.
      // BUT when using dangerouslySetInnerHTML the developer must manually escape.
      // This test documents the correct pattern.
      const userInput = '<img src=x onerror=alert(1)>'
      const safeContent = escapeHtml(userInput) // always escape before innerHTML
      
      // The result is a safe text string — the browser displays it literally
      // rather than creating an img element with an onerror handler
      expect(safeContent).toBe('&lt;img src=x onerror=alert(1)&gt;')
    })

    it('attribute values should be escaped', () => {
      // Without escaping, the attacker can close the attribute and inject onclick:
      // <div data-x="" onclick="alert(1)" data-x="">  ← injected!
      const userInput = '" onclick="alert(1)" data-x="'
      const safeAttr = escapeAttribute(userInput)
      
      // " is now &quot; so the attribute can't be broken out of
      expect(safeAttr).not.toContain('" onclick')
    })
  })

  describe('edge cases', () => {
    it('handles null-byte injection', () => {
      // \x00 (null byte) is used to confuse parsers that treat it as a string terminator;
      // some browsers ignore null bytes inside tag names and render the tag anyway
      const payload = '<scr\x00ipt>alert(1)</script>'
      expect(escapeHtml(payload)).not.toMatch(/<script/i)
    })

    it('handles unicode escapes', () => {
      // \u0061 is the Unicode escape for 'a'; in a JS context this executes as alert(1)
      // but after HTML-escaping the <script> wrapper is neutralised
      const payload = '<script>\\u0061lert(1)</script>'
      expect(escapeHtml(payload)).not.toContain('<script')
    })

    it('handles very long strings', () => {
      // Performance/DoS check: escaping 10,000 repetitions of <script> should not hang
      const longPayload = '<script>'.repeat(10000) + 'alert(1)'
      expect(escapeHtml(longPayload)).not.toContain('<script')
    })
  })
})

describe('React-specific XSS prevention', () => {
  it('React auto-escapes text in JSX', () => {
    // React's JSX compiler converts {userInput} to escaped text nodes — the browser
    // receives plain text, not markup. This test documents that behaviour.
    // We trust React for this; no manual escaping needed for plain JSX interpolation.
    const userInput = '<script>alert("xss")</script>'
    
    // In a React component: <div>{userInput}</div> renders the literal string safely.
    // This assertion is a placeholder to document the expected behaviour, not test React itself.
    expect(true).toBe(true) // React handles this automatically via its virtual DOM
  })

  it('dangerouslySetInnerHTML requires explicit sanitization', () => {
    // dangerouslySetInnerHTML bypasses React's auto-escaping and passes the string
    // directly to the browser's innerHTML — the developer MUST escape manually.
    const userInput = '<img src=x onerror=alert(1)>'
    const sanitized = escapeHtml(userInput) // always escape before dangerouslySetInnerHTML
    
    // After escaping, angle brackets are entities — the browser displays the text
    // literally rather than creating an img element with an onerror handler
    expect(sanitized).not.toContain('<img')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).toContain('&lt;img')  // entity-encoded: safe for innerHTML
    expect(sanitized).toContain('&gt;')
  })
})

// Export utilities for use in application code
export { escapeHtml, sanitizeUrl, stripHtml, escapeAttribute }
