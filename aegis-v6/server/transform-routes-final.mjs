/**
 * transform-routes-final.mjs
 *
 * Single-pass transformation of Express route files from:
 *
 *   router.METHOD('/path', [mw,] async (req: T, res: Response, next: NextFunction) => {
 *     try {
 *       BODY
 *     } catch (err) {
 *       next(err)
 *     }
 *   })
 *
 * To:
 *
 *   router.METHOD('/path', [mw,] asyncRoute(async (req: T, res: Response) => {
 *     BODY
 *   }))
 *
 * What it does in order (all on LF-normalised source):
 *   1. Adds `asyncRoute` import after last existing import block.
 *   2. Removes `next: NextFunction` from async handler params and wraps with asyncRoute(.
 *   3. Handles the MULTI-LINE outer catch:
 *        \n  } catch (err) {\n    next(err)\n  }\n})   →  \n}))
 *   4. Handles the ONE-LINE outer catch (compact style):
 *        \n  } catch (err) { next(err) }\n})            →  \n}))
 *   5. Removes the outer `try {` that is the first statement inside each asyncRoute handler.
 */

import { readFileSync, writeFileSync } from 'fs'

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: node transform-routes-final.mjs <file>'); process.exit(1) }

const raw = readFileSync(filePath, 'utf8')
const wasCRLF = raw.includes('\r\n')
// Normalise to LF for all processing
let src = raw.replace(/\r\n/g, '\n')
const original = src

// ── 1. Add asyncRoute import ────────────────────────────────────────────────
if (!src.includes("asyncRoute")) {
  src = src.replace(
    /(import [^\n]+\n)(\n*const router)/,
    "$1import { asyncRoute } from '../utils/asyncRoute.js'\n$2"
  )
}

// ── 2. Wrap handler signatures with asyncRoute( and remove next: NextFunction ─
// Handles trailing comma after params (e.g. "res: Response, next: NextFunction)")
// Handles both "next: NextFunction" at end and whitespace variants
src = src.replace(
  /,\s*async\s*\(([^)]+?),\s*next\s*:\s*NextFunction\s*\)\s*=>/g,
  (_, params) => `, asyncRoute(async (${params.trim()}) =>`
)

// ── 3. Multi-line outer catch → })) ────────────────────────────────────────
// Pattern (always 2-space indent for top-level route body):
//   } catch (err) {\n    next(err)\n  }\n})
// We need to replace the whole 4-line block AND convert }) → }))
src = src.replace(
  /\n  \} catch \(err\) \{\n    next\(err\)\n  \}\n\}\)/g,
  '\n}))'
)

// ── 4. One-line outer catch → })) ──────────────────────────────────────────
src = src.replace(
  /\n  \} catch \(err\) \{ next\(err\) \}\n\}\)/g,
  '\n}))'
)

// Also handle 4-space-indented variants (routes inside conditionals or blocks)
src = src.replace(
  /\n    \} catch \(err\) \{\n      next\(err\)\n    \}\n  \}\)/g,
  '\n  }))'
)

// ── 5. Remove outer `try {` from each asyncRoute handler ───────────────────
// After `asyncRoute(async (...) => {`, the next non-blank line is `  try {`
// Only remove when the line is EXACTLY `  try {` (2-space indent = top-level of handler)
const lines = src.split('\n')
const result = []
let i = 0
let removedTry = 0

while (i < lines.length) {
  const line = lines[i]

  if (line.includes('asyncRoute(async')) {
    result.push(line)
    i++
    // Skip blank lines; remove the first `  try {` we find
    while (i < lines.length) {
      const next = lines[i]
      const trimmed = next.trim()
      if (trimmed === 'try {') {
        removedTry++
        i++
        break
      }
      if (trimmed !== '') break  // non-blank, non-try → stop looking
      result.push(next)
      i++
    }
    continue
  }

  result.push(line)
  i++
}
src = result.join('\n')

// ── 6. Remove NextFunction from import if no longer used ───────────────────
const nfUsages = (src.match(/NextFunction/g) || []).length
if (nfUsages === 1) {
  // Only the import remains — remove it
  src = src.replace(/, NextFunction/, '')
} else if (nfUsages === 0) {
  src = src.replace(/, NextFunction/, '')
}

// ── Report ──────────────────────────────────────────────────────────────────
const catchBefore = (original.match(/catch \(err\)/g) || []).length
const catchAfter  = (src.match(/catch \(err\)/g) || []).length
const linesBefore = original.split('\n').length
const linesAfter  = src.split('\n').length

console.log(`File: ${filePath}`)
console.log(`Outer catch(err) removed:  ${catchBefore - catchAfter} / ${catchBefore}`)
console.log(`Outer try{} removed:       ${removedTry}`)
console.log(`Lines before: ${linesBefore}   →   after: ${linesAfter}   (−${linesBefore - linesAfter})`)

if (catchBefore - catchAfter !== removedTry) {
  console.warn(`⚠  catch removals (${catchBefore - catchAfter}) ≠ try removals (${removedTry}) — check manually`)
}

// Restore CRLF if original had it
if (wasCRLF) src = src.replace(/\n/g, '\r\n')
writeFileSync(filePath, src, 'utf8')
console.log('Done.')
