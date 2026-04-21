/**
 * transform-async-routes.mjs
 *
 * Transforms Express route handlers in a given file from:
 *
 *   router.METHOD('/path', [mw,] async (req: T, res: Response, next: NextFunction) => {
 *     try {
 *       BODY
 *     } catch (err) {
 *       next(err)
 *     }
 *   })
 *
 * to:
 *
 *   router.METHOD('/path', [mw,] asyncRoute(async (req: T, res: Response) => {
 *     BODY
 *   }))
 *
 * Rules:
 *  - Only removes OUTER catch(err){next(err)} patterns.
 *  - Inner try/catch blocks (different variable name, or empty catch) are preserved.
 *  - Adds `asyncRoute` import at the top of the file.
 *  - Removes `NextFunction` from the handler parameter (kept in other uses like middleware).
 *
 * Usage:  node transform-async-routes.mjs <file>
 */

import { readFileSync, writeFileSync } from 'fs'

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: node transform-async-routes.mjs <file>'); process.exit(1) }

let src = readFileSync(filePath, 'utf8')
const original = src

// ── Step 1: Add asyncRoute import ──────────────────────────────────────────
// Insert after the first block of imports (after the last existing import from utils or middleware)
if (!src.includes("from '../utils/asyncRoute.js'") && !src.includes("from \"../utils/asyncRoute.js\"")) {
  // Add after the last top-level import line
  src = src.replace(
    /(import [^\n]+\n)(\n*const router)/,
    "$1import { asyncRoute } from '../utils/asyncRoute.js'\n$2"
  )
}

// ── Step 2: Transform handler signatures ───────────────────────────────────
// Matches ", next: NextFunction)" inside async handler params and wraps with asyncRoute
// Pattern: , async (PARAMS, next: NextFunction) => {
// Careful: only match when it's a route handler (after router.METHOD), not middleware defs
src = src.replace(
  /,\s*async\s*\(([^)]+?),\s*next\s*:\s*NextFunction\s*\)\s*=>\s*\{/g,
  (match, params) => {
    const cleanedParams = params.trim()
    return `, asyncRoute(async (${cleanedParams}) => {`
  }
)

// ── Step 3: Remove the first `try {` inside each asyncRoute handler ─────────
// After `asyncRoute(async (...) => {` the very next non-blank statement is `  try {`
// We need to remove only these opening try lines — but NOT inner tries.
// Strategy: track line-by-line state.

const lines = src.split('\n')
const result = []
let inAsyncRoute = false
let openBraceDepth = 0
let removedOpenTry = false
let routeHandlerDepth = 0

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const trimmed = line.trim()

  // Detect start of asyncRoute handler
  if (!inAsyncRoute && line.includes('asyncRoute(async')) {
    inAsyncRoute = true
    openBraceDepth = 0
    removedOpenTry = false
    routeHandlerDepth = 0
    result.push(line)
    // Count opening braces on this line
    for (const ch of line) {
      if (ch === '{') openBraceDepth++
      if (ch === '}') openBraceDepth--
    }
    continue
  }

  if (inAsyncRoute) {
    // Count braces to track depth
    let opened = 0, closed = 0
    for (const ch of line) {
      if (ch === '{') opened++
      if (ch === '}') closed++
    }

    // First `  try {` directly inside the handler (openBraceDepth == 1) - remove it
    if (!removedOpenTry && openBraceDepth === 1 && trimmed === 'try {') {
      removedOpenTry = true
      // Don't push this line (removing the outer try {)
      openBraceDepth += opened - closed
      continue
    }

    openBraceDepth += opened - closed

    // Detect the outer catch block: `} catch (err) {` followed by `next(err)` then `}` then `})`
    // This occurs when openBraceDepth goes back to 1 and we see the catch pattern
    if (removedOpenTry && openBraceDepth === 1 && trimmed === '} catch (err) {') {
      // Peek ahead - should be `next(err)` then `  }` then `})`
      const nextLine = (lines[i + 1] || '').trim()
      const afterNext = (lines[i + 2] || '').trim()
      const closingLine = (lines[i + 3] || '').trim()
      if (
        nextLine === 'next(err)' &&
        afterNext === '}' &&
        (closingLine === '})' || closingLine === '})')
      ) {
        // Remove the catch block + transform closing })  to  }))
        i += 2 // skip `next(err)` and `}`
        // The next line will be `})` - transform to `}))`
        // We need to push the closing of the asyncRoute body
        result.push(line.replace('} catch (err) {', '}')) // closing brace of try block
        // Don't push the catch lines - just close asyncRoute
        // Find and fix the `})` or `  })` on line i+1
        const closeLine = lines[i + 1]
        result.push(closeLine + ')')  // `})` → `}))`
        i++ // skip the `})` line
        inAsyncRoute = false
        removedOpenTry = false
        openBraceDepth = 0
        continue
      }
    }

    result.push(line)
    continue
  }

  result.push(line)
}

src = result.join('\n')

// ── Step 4: Remove unused NextFunction from import ─────────────────────────
// Only remove from the Router import line if NextFunction is no longer used
// as a standalone type (keep if used in middleware definitions)
const nextFunctionUsages = (src.match(/NextFunction/g) || []).length
if (nextFunctionUsages <= 1) {
  // Only in the import - safe to remove from import
  src = src.replace(/, NextFunction/, '')
}

// ── Report ─────────────────────────────────────────────────────────────────
const removed = (original.match(/catch \(err\) \{/g) || []).length
const remaining = (src.match(/catch \(err\) \{/g) || []).length
const transformed = removed - remaining

console.log(`File: ${filePath}`)
console.log(`Outer try/catch blocks found:  ${removed}`)
console.log(`Successfully transformed:      ${transformed}`)
console.log(`Remaining catch(err) blocks:   ${remaining}`)
console.log(`Lines before: ${original.split('\n').length}`)
console.log(`Lines after:  ${src.split('\n').length}`)
console.log(`Net reduction: ${original.split('\n').length - src.split('\n').length} lines`)

writeFileSync(filePath, src, 'utf8')
console.log('Done.')
