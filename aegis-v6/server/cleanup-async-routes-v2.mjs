/**
 * cleanup-async-routes-v2.mjs
 *
 * Handles CRLF line endings (Windows files).
 * Removes outer catch(err){next(err)} patterns left after signature transform.
 */

import { readFileSync, writeFileSync } from 'fs'

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: node cleanup-async-routes-v2.mjs <file>'); process.exit(1) }

const raw = readFileSync(filePath, 'utf8')
const original = raw
// Normalize to LF for processing
let src = raw.replace(/\r\n/g, '\n')
const wasCRLF = raw.includes('\r\n')

// ── Step 1: Remove outer catch blocks ──────────────────────────────────────
// Pattern:
//   } catch (err) {
//     next(err)
//   }
// })
const catchPatterns = [
  // 2-space indent (top-level route)
  /\n  \} catch \(err\) \{\n    next\(err\)\n  \}\n\}\)/g,
  // 4-space indent (route inside a block)
  /\n    \} catch \(err\) \{\n      next\(err\)\n    \}\n  \}\)/g,
]
let removedCatch = 0
for (const pattern of catchPatterns) {
  const before = (src.match(pattern) || []).length
  src = src.replace(pattern, '\n})')
  removedCatch += before
}

// Verify remaining
const remainingCatch = (src.match(/catch \(err\) \{/g) || []).length

// ── Report ──────────────────────────────────────────────────────────────────
const linesBefore = original.split(/\r?\n/).length
const linesAfter = src.split('\n').length

console.log(`File: ${filePath}`)
console.log(`CRLF detected: ${wasCRLF}`)
console.log(`Outer catch(err) blocks removed: ${removedCatch}`)
console.log(`Remaining catch(err) blocks:     ${remainingCatch}`)
console.log(`Lines before: ${linesBefore}`)
console.log(`Lines after:  ${linesAfter}`)
console.log(`Net reduction: ${linesBefore - linesAfter} lines`)

// Restore CRLF if original had it
if (wasCRLF) {
  src = src.replace(/\n/g, '\r\n')
}

writeFileSync(filePath, src, 'utf8')
console.log('Done.')
