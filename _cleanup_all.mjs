/**
 * Comprehensive cleanup script for AEGIS v6 codebase.
 * Removes decorative separator lines, Unicode emoji in scripts,
 * and any remaining corrupted characters from ALL project files.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, extname, basename } from 'path'

const ROOT = 'e:/aegis-v6-fullstack/aegis-v6'
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'venv', '.venv', '__pycache__', '.next', '.cache', '.nyc_output'])
const PROCESS_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.ps1', '.sh', '.bash',
  '.yaml', '.yml', '.sql', '.css', '.html',
])
// Also process specific filenames with no ext
const PROCESS_NAMES = new Set(['.env', '.env.example', '.env.test', 'Dockerfile', 'Modelfile'])

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    try {
      const st = statSync(full)
      if (st.isDirectory()) files.push(...walk(full))
      else {
        const ext = extname(entry).toLowerCase()
        const name = basename(entry)
        if (PROCESS_EXTS.has(ext) || PROCESS_NAMES.has(name)) files.push(full)
      }
    } catch {}
  }
  return files
}

// Unicode box-drawing and decorative characters
const DECO = '[─═━┄╌▬┈┉╍╎╏┆┇┊┋━]'
// ASCII repeated decorative
const ASCII_DECO = '[\\-=_~]'

// Regex: Pure decorative line (line is ONLY comment marker + decorative chars)
// Matches: // ────────── or # ═══════════ or  * ───── or /* ──── */ etc.
const PURE_DECO = new RegExp(
  `^(\\s*(?:\\/\\/|#|\\/?\\*+|\\*+\\/?)\\s*)(?:${DECO}|${ASCII_DECO}|\\s){3,}\\s*(\\*\\/)?\\s*$`
)

// Standalone decorative lines without any comment marker
// Like: ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STANDALONE_DECO = new RegExp(`^\\s*(?:${DECO}|${ASCII_DECO}){5,}\\s*$`)

// Decorated section headers: {/* ═══════════ TEXT ═══════════ */}  →  {/* TEXT */}
// Also: // ── TEXT ────────── → // TEXT
// Also: # ── TEXT ────────── → # TEXT
const DECO_HEADER_JSX = new RegExp(
  `^(\\s*\\{/\\*\\s*)(?:${DECO}|${ASCII_DECO})+\\s+(.+?)\\s+(?:${DECO}|${ASCII_DECO})+\\s*(\\*/\\})\\s*$`
)
const DECO_HEADER_COMMENT = new RegExp(
  `^(\\s*(?:\\/\\/|#|/\\*|\\*)\\s*)(?:${DECO}|${ASCII_DECO})+\\s+(.+?)\\s+(?:${DECO}|${ASCII_DECO})+\\s*(\\*/)?\\s*$`
)
// Also: // ── TEXT (no trailing decoration, just leading)
const DECO_HEADER_LEADING = new RegExp(
  `^(\\s*(?:\\/\\/|#|/\\*|\\*)\\s*)(?:${DECO}){2,}\\s+(.+?)\\s*$`
)

// Prefix decorative markers: // -+ POST /upload → // POST /upload
const PREFIX_DECO = /^(\s*\/\/\s*)-\+\s+/

// Emoji map for PowerShell/shell scripts (replace with text)
const EMOJI_MAP = {
  '🔹': '[*]',
  '✅': '[OK]',
  '⚠️': '[!]',
  '❌': '[ERR]',
  '📍': '   ',
  '🚀': '[*]',
  '🔧': '[*]',
  '📦': '[*]',
  '🌐': '[*]',
  '💡': '[*]',
  '🔥': '[!]',
  '⚡': '[*]',
  '🛑': '[ERR]',
  '✨': '[*]',
  '🎯': '[*]',
  '📝': '[*]',
  '🗄️': '[*]',
  '🔒': '[*]',
  '💾': '[*]',
  '🔑': '[*]',
}

// Broad emoji regex (all common emoji ranges)
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu

function isDecoLine(line) {
  // Don't touch markdown table separators: |---|---|
  if (line.includes('|') && /\|.*[-─═]{2,}.*\|/.test(line)) return false
  // Don't touch markdown HR
  if (/^\s*---\s*$/.test(line)) return false
  // Don't touch yaml document separators
  if (/^\s*---\s*$/.test(line)) return false
  // Don't touch string content (inside quotes or template literals)
  if (/['"`].*[-─═]{5,}.*['"`]/.test(line)) return false
  // Don't touch BOLD/NC echo decorative lines in .sh (leave those as terminal formatting)
  if (/echo.*\$\{BOLD\}.*━/.test(line)) return false

  if (PURE_DECO.test(line)) return true
  if (STANDALONE_DECO.test(line)) return true
  return false
}

function cleanDecoHeader(line) {
  let m

  // JSX: {/* ═══ TEXT ═══ */}
  m = line.match(DECO_HEADER_JSX)
  if (m) return `${m[1]}${m[2].trim()} ${m[3]}`

  // Comment: // ═══ TEXT ═══ or # ═══ TEXT ═══ or /* ═══ TEXT ═══ */
  m = line.match(DECO_HEADER_COMMENT)
  if (m) {
    const suffix = m[3] ? ` ${m[3]}` : ''
    return `${m[1]}${m[2].trim()}${suffix}`
  }

  // Leading only: // ── TEXT
  m = line.match(DECO_HEADER_LEADING)
  if (m) return `${m[1]}${m[2].trim()}`

  return line
}

function cleanPrefixDeco(line) {
  return line.replace(PREFIX_DECO, '$1')
}

function replaceEmoji(line, ext) {
  // For .ps1 and .sh files, replace known emoji with text equivalents
  if (ext === '.ps1' || ext === '.sh' || ext === '.bash') {
    for (const [emoji, text] of Object.entries(EMOJI_MAP)) {
      if (line.includes(emoji)) line = line.replaceAll(emoji, text)
    }
    // Remove any remaining emoji
    line = line.replace(EMOJI_REGEX, '')
  }
  return line
}

function processFile(filePath) {
  const ext = extname(filePath).toLowerCase()
  let content
  try { content = readFileSync(filePath, 'utf-8') } catch { return 0 }
  
  const origContent = content
  const lines = content.split('\n')
  const result = []
  let removedLines = 0
  let modifiedLines = 0

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Step 1: Remove pure decorative lines
    if (isDecoLine(line)) {
      removedLines++
      continue
    }

    // Step 2: Clean decorated section headers
    const cleaned = cleanDecoHeader(line)
    if (cleaned !== line) {
      line = cleaned
      modifiedLines++
    }

    // Step 3: Clean prefix decorative markers (// -+ TEXT)
    const cleaned2 = cleanPrefixDeco(line)
    if (cleaned2 !== line) {
      line = cleaned2
      modifiedLines++
    }

    // Step 4: Replace emoji in shell scripts
    const cleaned3 = replaceEmoji(line, ext)
    if (cleaned3 !== line) {
      line = cleaned3
      modifiedLines++
    }

    // Step 5: Replace any remaining U+FFFD
    if (line.includes('\uFFFD')) {
      line = line.replaceAll('\uFFFD', '\u2014')
      modifiedLines++
    }

    result.push(line)
  }

  // Remove double blank lines left after removing decorative lines
  const finalLines = []
  let prevBlank = false
  for (const line of result) {
    const isBlank = line.trim() === ''
    if (isBlank && prevBlank) continue
    finalLines.push(line)
    prevBlank = isBlank
  }

  const finalContent = finalLines.join('\n')
  if (finalContent !== origContent) {
    writeFileSync(filePath, finalContent, 'utf-8')
    const relPath = filePath.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', '')
    console.log(`  ${relPath}: removed ${removedLines} lines, modified ${modifiedLines} lines`)
    return removedLines + modifiedLines
  }
  return 0
}

// Run
console.log('Scanning all files...')
const allFiles = walk(ROOT)
console.log(`Found ${allFiles.length} files to process\n`)

let totalChanges = 0
for (const f of allFiles) {
  totalChanges += processFile(f)
}

console.log(`\nTotal changes: ${totalChanges} across all files`)
