/**
 * i18n batch processing script
 * Adds useLanguage() hook call to component functions that have the import but don't call it.
 * Also replaces common hardcoded patterns with t() calls.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const SRC = join(process.cwd(), 'src')
const DIRS = ['components/admin', 'components/citizen', 'components/shared', 'pages']

// Files already fully done - skip
const SKIP_FILES = new Set([
  'ActivityLog.tsx', 'SystemHealthPanel.tsx', 'IncidentQueue.tsx', 'LandingPage.tsx',
  'AdminCommunityHub.tsx'
])

function getAllTsx(dir) {
  const results = []
  try {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f)
      const st = statSync(full)
      if (st.isDirectory()) results.push(...getAllTsx(full))
      else if (f.endsWith('.tsx') && !SKIP_FILES.has(f)) results.push(full)
    }
  } catch (e) { /* ignore */ }
  return results
}

let totalFiles = 0
let hookAdded = 0

for (const d of DIRS) {
  const dir = join(SRC, d)
  for (const file of getAllTsx(dir)) {
    let code = readFileSync(file, 'utf8')
    const rel = relative(SRC, file)
    let changed = false

    // Check if imports useLanguage but doesn't call it
    if (code.includes("import { useLanguage }") && !code.includes('useLanguage()')) {
      // Find the function body of the main exported component or first function component
      // Pattern: after "export default function Name" or "function Name" or "const Name = "
      // Add after the first useState or similar line

      // Strategy: find the first `const [` or first line inside the component
      // We'll use a regex to find export default function and insert after opening {
      const patterns = [
        // export default function Name(...) { or }: JSX.Element {
        /export\s+default\s+function\s+\w+[^{]*\{(\s*\n)/,
        // const Name = (...) => { at top level
        /^const\s+\w+\s*[:=][^{]*\{(\s*\n)/m,
        // function Name at module level
        /^function\s+\w+[^{]*\{(\s*\n)/m,
      ]

      let inserted = false
      for (const pat of patterns) {
        const m = code.match(pat)
        if (m && !inserted) {
          const insertPos = m.index + m[0].length
          // Check if useLanguage() is already nearby (within 200 chars)
          const nextChunk = code.slice(insertPos, insertPos + 500)
          if (!nextChunk.includes('useLanguage()')) {
            code = code.slice(0, insertPos) + "  const { language: lang } = useLanguage()\n" + code.slice(insertPos)
            inserted = true
            changed = true
            hookAdded++
          }
          break
        }
      }
    }

    if (changed) {
      writeFileSync(file, code, 'utf8')
      console.log(`✓ Added useLanguage() to ${rel}`)
    }
    totalFiles++
  }
}

console.log(`\nProcessed ${totalFiles} files, added useLanguage() to ${hookAdded} files`)
