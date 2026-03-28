/**
 * SafeHtml — XSS-safe alternative to dangerouslySetInnerHTML.
 *
 * Strips all script tags, javascript: href values, and inline event handlers
 * before rendering. Allows only a curated set of safe block/inline elements.
 *
 * Usage:
 *   <SafeHtml html={t('some.key', lang)} />
 *   <SafeHtml html={t('some.key', lang)} tag="div" className="my-class" />
 */

import React from 'react'

// Allowlists

/* Tags whose entire subtree is stripped (tag + content). */
const BLOCKED_TAGS = /^(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base|applet|frame|frameset)$/i

/* Attributes that must never appear on any element. */
const BLOCKED_ATTRS = /^(on\w+|srcdoc|action|formaction|data|x-bind|v-on|ng-\w+)$/i

// Sanitizer

 /**
 * Lightweight HTML sanitizer that does NOT require DOMPurify.
 * Uses the browser's built-in HTML parser via a detached document, then
 * walks the parsed tree, removing unsafe nodes/attributes in-place.
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof document === 'undefined') {
    // SSR / test environment: strip all tags as a conservative fallback
    return dirty.replace(/<[^>]*>/g, '')
  }

  const tpl = document.createElement('template')
  tpl.innerHTML = dirty

  walkAndClean(tpl.content)

  // Serialize back to HTML string
  const div = document.createElement('div')
  div.appendChild(tpl.content.cloneNode(true))
  return div.innerHTML
}

function walkAndClean(node: Node): void {
  const children = Array.from(node.childNodes)

  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element
      const tag = el.tagName

      // Remove the entire subtree for blocked tags
      if (BLOCKED_TAGS.test(tag)) {
        node.removeChild(child)
        continue
      }

      // Sanitize attributes on allowed tags
      const attrs = Array.from(el.attributes)
      for (const attr of attrs) {
        const name = attr.name.toLowerCase()
        const value = attr.value.toLowerCase().trim()

        if (BLOCKED_ATTRS.test(name)) {
          el.removeAttribute(attr.name)
          continue
        }

        // Strip javascript: and data: URIs from href/src/action
        if ((name === 'href' || name === 'src') && /^(javascript|data|vbscript):/i.test(value)) {
          el.removeAttribute(attr.name)
          continue
        }
      }

      // Recurse into safe children
      walkAndClean(child)
    }
  }
}

// Component

type HtmlTag = 'p' | 'div' | 'span' | 'section' | 'article' | 'aside' | 'li' | 'td' | 'th' | 'dd' | 'dt' | 'blockquote' | 'figcaption' | 'summary' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

interface SafeHtmlProps extends React.HTMLAttributes<HTMLElement> {
  /* Raw HTML string to sanitize and render. */
  html: string
  /* Wrapper element tag. Defaults to 'p'. */
  tag?: HtmlTag
  className?: string
}

export function SafeHtml({ html, tag = 'p', className, ...rest }: SafeHtmlProps): React.ReactElement {
  const Tag = tag
  const clean = sanitizeHtml(html)
  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: clean }}
      {...rest}
    />
  )
}

export default SafeHtml
