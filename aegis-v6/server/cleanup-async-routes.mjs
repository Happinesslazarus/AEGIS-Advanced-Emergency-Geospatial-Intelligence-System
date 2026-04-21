/**
 * cleanup-async-routes.mjs
 *
 * Step 2: signatures are already wrapped with asyncRoute(...).
 * This script:
 *   1. Removes `  } catch (err) {\n    next(err)\n  }\n})` → `})`
 *   2. Removes the first `  try {` inside each asyncRoute handler
 *      (the outer try is now redundant since asyncRoute catches for us).
 */

import { readFileSync, writeFileSync } from 'fs'

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: node cleanup-async-routes.mjs <file>'); process.exit(1) }

let src = readFileSync(filePath, 'utf8')
const original = src

// ── Step 1: Remove outer catch blocks ──────────────────────────────────────
// Pattern (4 lines):
//   } catch (err) {
//     next(err)
//   }
// })
// These always appear with exactly 2-space and 4-space indentation.
// We replace the 4-line block with just `})`
const catchPattern = /\n  \} catch \(err\) \{\n    next\(err\)\n  \}\n\}\)/g
src = src.replace(catchPattern, '\n})')

// Also handle the case where `})` has preceding spaces (e.g. inside another block)
// Catch blocks that close with `  })` (indented route)
const catchPatternIndented = /\n    \} catch \(err\) \{\n      next\(err\)\n    \}\n  \}\)/g
src = src.replace(catchPatternIndented, '\n  })')

// ── Step 2: Remove the outer `try {` from asyncRoute handlers ──────────────
// After `asyncRoute(async (...) => {`, the next non-empty line is `  try {`
// We need to remove it.
// Strategy: split into lines, find asyncRoute openings, remove the first try {
const lines = src.split('\n')
const result = []
let i = 0
let removedTryCount = 0

while (i < lines.length) {
  const line = lines[i]

  // Detect asyncRoute handler opening
  if (line.includes('asyncRoute(async')) {
    result.push(line)
    i++
    // Skip blank lines and find the first `try {`
    while (i < lines.length) {
      const next = lines[i]
      const trimmed = next.trim()
      if (trimmed === 'try {') {
        // Remove this line (the outer try)
        removedTryCount++
        i++
        break
      }
      // If we hit something that's not blank and not `try {`, stop looking
      if (trimmed !== '') {
        break
      }
      result.push(next)
      i++
    }
    continue
  }

  result.push(line)
  i++
}

src = result.join('\n')

// ── Report ──────────────────────────────────────────────────────────────────
const catchBefore = (original.match(/catch \(err\) \{/g) || []).length
const catchAfter = (src.match(/catch \(err\) \{/g) || []).length
const removedCatch = catchBefore - catchAfter

console.log(`File: ${filePath}`)
console.log(`Outer catch(err) blocks removed: ${removedCatch}`)
console.log(`Outer try{ blocks removed:        ${removedTryCount}`)
console.log(`Lines before: ${original.split('\n').length}`)
console.log(`Lines after:  ${src.split('\n').length}`)
console.log(`Net reduction: ${original.split('\n').length - src.split('\n').length} lines`)

if (removedCatch !== removedTryCount) {
  console.warn(`WARNING: catch removals (${removedCatch}) != try removals (${removedTryCount}) — manual check needed`)
}

writeFileSync(filePath, src, 'utf8')
console.log('Done.')
