// Clean ONLY decorative separator lines from the 6 reverted files
// Does NOT touch emoji — only removes/cleans decorative comment lines
import { readFileSync, writeFileSync } from 'fs'

const ROOT = 'e:/aegis-v6-fullstack/aegis-v6'
const files = [
  'client/src/pages/CitizenDashboard.tsx',
  'client/src/pages/CitizenPage.tsx',
  'client/src/components/citizen/PreparednessGuide.tsx',
  'client/src/data/preparedness.ts',
  'client/src/components/admin/AdminMessaging.tsx',
  'client/src/components/citizen/ReportForm.tsx',
  'client/src/contexts/LocationContext.tsx',
  'client/src/utils/chatbotEngine.ts',
]

let totalRemoved = 0
let totalModified = 0

for (const rel of files) {
  const path = `${ROOT}/${rel}`
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch (e) {
    console.log(`SKIP ${rel}: ${e.message}`)
    continue
  }

  const lines = content.split('\n')
  const result = []
  let removed = 0
  let modified = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Pattern 1: Pure decorative comment lines (JS/TS style)
    // e.g. // ════════════════  or  /* ─────────────── */  or  // ──────────
    if (/^\s*(\/\/|\/?\*)\s*[─═━┄╌▬\-]{4,}\s*(\*\/)?\s*$/.test(line)) {
      removed++
      continue
    }

    // Pattern 2: JSX decorative comment lines
    // e.g. {/* ═══════════════════════════════════ */}
    if (/^\s*\{\/\*\s*[─═━┄╌▬\-]{4,}\s*\*\/\}\s*$/.test(line)) {
      removed++
      continue
    }

    // Pattern 3: Decorated section headers in JSX
    // e.g. {/* ═══════════ TEXT ═══════════ */} → {/* TEXT */}
    const jsxHeaderMatch = line.match(/^(\s*)\{\/\*\s*[─═━┄╌▬]+\s+(.+?)\s+[─═━┄╌▬]+\s*\*\/\}/)
    if (jsxHeaderMatch) {
      const indent = jsxHeaderMatch[1]
      const text = jsxHeaderMatch[2].trim()
      result.push(`${indent}{/* ${text} */}`)
      modified++
      continue
    }

    // Pattern 4: Decorated headers in regular comments
    // e.g. // ── TEXT ──────── → // TEXT
    const commentHeaderMatch = line.match(/^(\s*\/\/\s*)[─═━┄╌▬]+\s+(.+?)\s*[─═━┄╌▬]*\s*$/)
    if (commentHeaderMatch) {
      const prefix = commentHeaderMatch[1]
      const text = commentHeaderMatch[2].trim()
      // Only transform if the line has actual decorative chars (not just dashes in URLs etc.)
      if (/[─═━┄╌▬]/.test(line)) {
        result.push(`${prefix}${text}`)
        modified++
        continue
      }
    }

    // Pattern 5: // -+ prefix decorative
    // e.g. // -+ POST /upload → // POST /upload
    if (/^\s*\/\/\s*-\+\s+/.test(line)) {
      result.push(line.replace(/^(\s*\/\/\s*)-\+\s+/, '$1'))
      modified++
      continue
    }

    result.push(line)
  }

  // Remove consecutive blank lines left by removals
  const cleaned = []
  let prevBlank = false
  for (const line of result) {
    const blank = !line.trim()
    if (blank && prevBlank) continue
    cleaned.push(line)
    prevBlank = blank
  }

  if (removed > 0 || modified > 0) {
    writeFileSync(path, cleaned.join('\n'), 'utf8')
    console.log(`${rel}: removed ${removed} lines, modified ${modified} lines`)
    totalRemoved += removed
    totalModified += modified
  } else {
    console.log(`${rel}: no changes`)
  }
}

console.log(`\nTotal: removed ${totalRemoved}, modified ${totalModified}`)
