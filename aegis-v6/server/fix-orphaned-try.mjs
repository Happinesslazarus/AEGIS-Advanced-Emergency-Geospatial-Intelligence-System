/**
 * fix-orphaned-try.mjs
 *
 * After the main transformation, some asyncRoute handlers have:
 *   asyncRoute(async (...) => {
 *     if (!permissions) throw ...   ← non-blank before try
 *     try {
 *       BODY
 *     }))                            ← catch was removed, bare try remains
 *
 * This is a syntax error. This script removes those bare `  try {` lines
 * (2-space indent, inside an asyncRoute handler, where there is no
 * corresponding `} catch` before the `}))` closing).
 *
 * Also handles: find `  try {` at 4-space indent inside asyncRoute with the
 * same orphan pattern.
 */

import { readFileSync, writeFileSync } from 'fs'

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: node fix-orphaned-try.mjs <file>'); process.exit(1) }

const raw = readFileSync(filePath, 'utf8')
const wasCRLF = raw.includes('\r\n')
let src = raw.replace(/\r\n/g, '\n')

const lines = src.split('\n')
const result = []
let removed = 0

// Strategy: when we're inside an asyncRoute handler, track whether we've
// seen a `try {` without a matching `catch`. If the handler closes (})
// without a catch after the try, the try is orphaned — remove it.
// We do a single-pass with a state machine.

// Simpler approach: scan the file and for each `  try {` line at 2-space
// indent, check if the NEXT occurrence of `} catch` at the same indent level
// appears BEFORE the matching `}` (which would be the handler close).
// If not — it's orphaned, remove it.

// Even simpler: just look for:
//   any `  try {` (or `    try {`) line
//   where within the following lines there is no `} catch` before `})`  or `}))` at the same indent as the try's closing
//
// Since we already removed the catch, orphaned tries will have their
// corresponding `}` be `})` or `}))` (route close), not `} catch`.

// Walk line by line
let i = 0
while (i < lines.length) {
  const line = lines[i]

  // Look for a try { at 2-space or 4-space indent
  if (/^  try \{$/.test(line) || /^    try \{$/.test(line)) {
    // Look ahead to find if there's a catch before the handler closes
    const indent = line.match(/^(\s+)/)?.[1] || '  '
    let depth = 1
    let hasCatch = false
    let j = i + 1
    while (j < lines.length && depth > 0) {
      const ahead = lines[j]
      const aheadTrimmed = ahead.trim()
      // Count brace depth (naively, handling template literals imperfectly)
      for (const ch of ahead) {
        if (ch === '{') depth++
        if (ch === '}') depth--
        if (depth === 0) break
      }
      // Check for catch at the same indent level (before depth hits 0)
      if (depth >= 0 && (aheadTrimmed.startsWith('} catch') || aheadTrimmed.startsWith('} finally'))) {
        hasCatch = true
        break
      }
      j++
    }

    if (!hasCatch) {
      // Orphaned try — remove this line
      removed++
      i++
      continue
    }
  }

  result.push(line)
  i++
}

src = result.join('\n')

// Report
const triesBefore = (raw.replace(/\r\n/g, '\n').match(/^\s+try \{$/gm) || []).length
const triesAfter = (src.match(/^\s+try \{$/gm) || []).length
console.log(`File: ${filePath}`)
console.log(`Orphaned try{ blocks removed: ${removed}`)
console.log(`try{ remaining: ${triesAfter}`)
console.log(`Lines: ${raw.split(/\r?\n/).length} → ${src.split('\n').length} (−${raw.split(/\r?\n/).length - src.split('\n').length})`)

if (wasCRLF) src = src.replace(/\n/g, '\r\n')
writeFileSync(filePath, src, 'utf8')
console.log('Done.')
