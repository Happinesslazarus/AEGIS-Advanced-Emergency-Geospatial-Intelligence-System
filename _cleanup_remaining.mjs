// Targeted cleanup for remaining 9 files with decorative lines
import { readFileSync, writeFileSync } from 'fs'

const files = [
  'aegis-v6/start-dev.mjs',
  'aegis-v6/scripts/dr/db-restore.sh',
  'aegis-v6/scripts/dr/db-verify-backup.sh',
  'aegis-v6/server/sql/migration_advanced_personalization.sql',
  'aegis-v6/server/sql/migration_citizen_profile_columns.sql',
  'aegis-v6/server/sql/migration_device_trust.sql',
  'aegis-v6/server/sql/migration_missing_tables.sql',
  'aegis-v6/server/sql/migration_row_level_security.sql',
  'aegis-v6/server/sql/migration_system_config.sql',
]

// Pure decorative line: entire content (after comment marker) is decorative chars
// Matches: -- ═══════, // ──────, # ══════, echo "═══════", console.log('╔══...╗')
const PURE_DECO = /^(\s*(?:--|\/\/|#|\/?\*)\s*)[─═━┄╌▬╔╗╚╝║╠╣╦╩╬┃┏┓┗┛]{3,}\s*$/

// Decorated section header: comment marker + deco + TEXT + deco
// Matches: -- ── reports ─────, -- ─── Citizens table columns ──────
const DECO_HEADER = /^(\s*(?:--|\/\/|#|\/?\*)\s*)[─═━┄╌▬]+\s+(.+?)\s*[─═━┄╌▬]+\s*$/

// Box drawing in echo/console.log output
const BOX_ECHO = /^(\s*(?:echo|console\.log)\s*[\("]+\s*)([╔╗╚╝║╠╣╦╩╬┃┏┓┗┛─═━]+)(.*)$/
const BOX_LINE_FULL = /^(\s*(?:echo|console\.log)\s*[\("]+\s*["'`]?\s*)[╔╗╚╝║╠╣╦╩╬─═━]+\s*["'`]?\s*[)"]?\s*$/

// Emoji replacements for .mjs files
const EMOJI_MAP = {
  '🔹': '[*]',
  '✅': '[OK]',
  '⚠️': '[!]',
  '❌': '[ERR]',
  '📍': '[-]',
  '🚀': '[>]',
  '💾': '[>]',
  '🔧': '[>]',
  '🛑': '[!]',
  '📦': '[>]',
}

let totalRemoved = 0
let totalModified = 0

for (const relPath of files) {
  const fullPath = `e:/aegis-v6-fullstack/${relPath}`
  let content
  try {
    content = readFileSync(fullPath, 'utf8')
  } catch (e) {
    console.log(`SKIP ${relPath}: ${e.message}`)
    continue
  }

  const lines = content.split('\n')
  const result = []
  let removed = 0
  let modified = 0

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Remove pure decorative lines (including box-drawing borders in echo/console.log)
    if (PURE_DECO.test(line)) {
      removed++
      continue
    }

    // Handle console.log/echo lines with box drawing chars
    // e.g. console.log('╔═══...═══╗') or echo "╔═══...╗"
    if (/[╔╗╚╝╠╣╦╩╬┃┏┓┗┛]/.test(line) && /(?:console\.log|echo)\s*[("']/.test(line)) {
      // Lines that are just box borders → remove
      if (/^\s*(?:console\.log|echo)\s*\(?["'`][╔╗╚╝║╠╣╦╩╬┃┏┓┗┛─═━\s]+["'`]\)?\s*;?\s*$/.test(line)) {
        removed++
        continue
      }
      // Lines with box chars + text (║ TITLE ║) → keep text, remove box
      line = line.replace(/[╔╗╚╝║╠╣╦╩╬┃┏┓┗┛]/g, ' ')
      // Clean up extra spaces
      line = line.replace(/\s{3,}/g, '  ')
      modified++
    }

    // Clean decorated section headers: -- ── text ─── → -- text
    const headerMatch = line.match(DECO_HEADER)
    if (headerMatch) {
      const prefix = headerMatch[1]
      const text = headerMatch[2].trim()
      line = `${prefix}${text}`
      modified++
    }

    // Replace emoji in .mjs/.sh files
    if (relPath.endsWith('.mjs') || relPath.endsWith('.sh')) {
      for (const [emoji, replacement] of Object.entries(EMOJI_MAP)) {
        if (line.includes(emoji)) {
          line = line.replaceAll(emoji, replacement)
          modified++
        }
      }
    }

    result.push(line)
  }

  // Remove double blank lines caused by removals
  const cleaned = []
  let prevBlank = false
  for (const line of result) {
    const blank = !line.trim()
    if (blank && prevBlank) continue
    cleaned.push(line)
    prevBlank = blank
  }

  if (removed > 0 || modified > 0) {
    writeFileSync(fullPath, cleaned.join('\n'), 'utf8')
    console.log(`${relPath}: removed ${removed} lines, modified ${modified} lines`)
    totalRemoved += removed
    totalModified += modified
  } else {
    console.log(`${relPath}: no changes needed`)
  }
}

console.log(`\nDone: removed ${totalRemoved} lines, modified ${totalModified} lines across ${files.length} files`)
