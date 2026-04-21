/**
 * A1 codemod: replace raw res.json() / res.status(N).json() with
 * res.success() and res.fail() in all server/src route/handler files.
 *
 * Patterns handled:
 *   res.json({ success: true, ...data })         → res.success({ ...data })
 *   res.json({ error: '...' })                   → res.fail('...')
 *   res.status(2xx).json({ ...data })            → res.success({ ...data }, 2xx)
 *   res.status(4xx/5xx).json({ error: '...' })   → res.fail('...', 4xx/5xx)
 *   res.status(4xx/5xx).json({ message: '...' }) → res.fail('...', 4xx/5xx)
 *
 * Single-line forms only — multi-line forms are left untouched (too risky).
 * The script is idempotent: running twice produces the same result.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const ROOT = new URL('../server/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let totalFiles = 0
let totalChanges = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
    } else if (extname(entry) === '.ts') {
      processFile(full)
    }
  }
}

function processFile(filePath) {
  const original = readFileSync(filePath, 'utf8')
  let text = original
  let changes = 0

  // ─── helper: apply a regex and count changes ───────────────────────────────
  function apply(re, replacement) {
    const before = text
    text = text.replace(re, replacement)
    const delta = (before.split('\n').filter((l, i) => l !== text.split('\n')[i]).length)
    // count by match occurrences instead
    let count = 0
    let m
    const rCopy = new RegExp(re.source, re.flags)
    while ((m = rCopy.exec(before)) !== null) count++
    changes += count
  }

  // ─── 1. res.status(2xx).json({ success: true, ...rest }) ──────────────────
  // → res.success({ ...rest }, 2xx)
  apply(
    /\bres\.status\((2\d\d)\)\.json\(\s*\{\s*success\s*:\s*true,?\s*([\s\S]*?)\s*\}\s*\)/g,
    (_, code, rest) => {
      rest = rest.trim().replace(/,$/, '')
      if (!rest) return `res.success({}, ${code})`
      return `res.success({ ${rest} }, ${code})`
    }
  )

  // ─── 2. res.json({ success: true, ...rest }) ──────────────────────────────
  // → res.success({ ...rest })
  apply(
    /\bres\.json\(\s*\{\s*success\s*:\s*true,?\s*([\s\S]*?)\s*\}\s*\)/g,
    (_, rest) => {
      rest = rest.trim().replace(/,$/, '')
      if (!rest) return `res.success({})`
      return `res.success({ ${rest} })`
    }
  )

  // ─── 3. res.status(4xx/5xx).json({ error: '...' }) ────────────────────────
  // → res.fail('...', 4xx/5xx)   (single-quoted or template-literal error strings)
  apply(
    /\bres\.status\(([45]\d\d)\)\.json\(\s*\{\s*error\s*:\s*((?:'[^']*'|"[^"]*"|`[^`]*`))\s*\}\s*\)/g,
    (_, code, msg) => `res.fail(${msg}, ${code})`
  )

  // ─── 4. res.status(4xx/5xx).json({ message: '...' }) ─────────────────────
  apply(
    /\bres\.status\(([45]\d\d)\)\.json\(\s*\{\s*message\s*:\s*((?:'[^']*'|"[^"]*"|`[^`]*`))\s*\}\s*\)/g,
    (_, code, msg) => `res.fail(${msg}, ${code})`
  )

  // ─── 5. res.json({ error: '...' }) ───────────────────────────────────────
  // → res.fail('...')
  apply(
    /\bres\.json\(\s*\{\s*error\s*:\s*((?:'[^']*'|"[^"]*"|`[^`]*`))\s*\}\s*\)/g,
    (_, msg) => `res.fail(${msg})`
  )

  // ─── 6. res.json({ message: '...' }) ─────────────────────────────────────
  apply(
    /\bres\.json\(\s*\{\s*message\s*:\s*((?:'[^']*'|"[^"]*"|`[^`]*`))\s*\}\s*\)/g,
    (_, msg) => `res.fail(${msg})`
  )

  if (text !== original) {
    writeFileSync(filePath, text, 'utf8')
    totalFiles++
    totalChanges += changes
    console.log(`  patched  ${filePath.replace(ROOT, '').replace(/\\/g, '/')}  (est. ${changes} replacements)`)
  }
}

console.log(`\nA1 codemod: scanning ${ROOT}\n`)
walk(ROOT)
console.log(`\nDone. ${totalFiles} files patched, ~${totalChanges} replacements.\n`)
