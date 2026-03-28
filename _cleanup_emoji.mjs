// Remove emoji from console.log/error/warn in all TS/TSX files
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const ROOT = 'e:/aegis-v6-fullstack/aegis-v6'
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.venv', '__pycache__', '.next', '.cache'])
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js'])

// Emoji → text replacement map
// Meaningful status emoji get text equivalents, decorative emoji get removed
const REPLACEMENTS = [
  ['✅', '[OK]'],
  ['❌', '[ERR]'],
  ['⚠️', '[WARN]'],
  ['⏳', '[WAIT]'],
  ['🔹', ''],
  ['🔌', ''],
  ['📨', ''],
  ['👥', ''],
  ['🔔', ''],
  ['🔄', ''],
  ['📤', ''],
  ['📊', ''],
  ['💚', ''],
  ['🧹', ''],
  ['📫', ''],
  ['🔧', ''],
  ['📍', ''],
  ['🚀', ''],
  ['💾', ''],
  ['🛑', ''],
  ['📦', ''],
  ['🔶', ''],
  ['🟢', ''],
  ['🔴', ''],
  ['🟡', ''],
  ['🟠', ''],
  ['📈', ''],
  ['🏥', ''],
  ['🔒', ''],
  ['🔓', ''],
  ['🗑', ''],
  ['📋', ''],
  ['🎯', ''],
  ['⚡', ''],
  ['💡', ''],
  ['🧪', ''],
  ['🐛', ''],
]

function walk(dir) {
  const entries = readdirSync(dir)
  const files = []
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    try {
      const st = statSync(full)
      if (st.isDirectory()) {
        files.push(...walk(full))
      } else if (EXTS.has(extname(entry))) {
        files.push(full)
      }
    } catch { /* skip */ }
  }
  return files
}

let totalFiles = 0
let totalReplacements = 0

const files = walk(ROOT)
for (const file of files) {
  let content = readFileSync(file, 'utf8')
  let changed = false
  
  for (const [emoji, text] of REPLACEMENTS) {
    if (content.includes(emoji)) {
      // Replace emoji, cleaning up extra spaces around it
      content = content.replaceAll(emoji, text)
      changed = true
    }
  }
  
  if (changed) {
    // Clean up double spaces left by removed emoji
    content = content.replace(/  +/g, (match, offset, str) => {
      // Only collapse multiple spaces in string literals and comments, not indentation
      const lineStart = str.lastIndexOf('\n', offset)
      const beforeOnLine = str.slice(lineStart + 1, offset)
      if (!beforeOnLine.trim()) return match // preserve indentation
      return ' '
    })
    
    writeFileSync(file, content, 'utf8')
    const rel = file.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', '')
    console.log(`Fixed: ${rel}`)
    totalFiles++
    totalReplacements++
  }
}

console.log(`\nDone: cleaned emoji from ${totalFiles} files`)
