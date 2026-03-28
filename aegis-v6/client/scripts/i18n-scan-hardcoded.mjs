import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const rootDir = path.resolve(process.cwd(), 'src')
const includeExt = new Set(['.tsx'])
const ignoreDirs = new Set(['node_modules', 'dist', 'build'])
const attrNames = new Set(['title', 'aria-label', 'placeholder'])

const allowPatterns = [
  /^\s*$/,
  /^\d+[\d\s%.,:-]*$/,
  /^[A-Z0-9_]+$/,
  /^https?:\/\//i,
]

const violations = []

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }
    if (!includeExt.has(path.extname(entry.name))) continue
    scanFile(fullPath)
  }
}

function isLikelyUserFacing(text) {
  const value = text.replace(/\s+/g, ' ').trim()
  if (value.length < 3) return false
  if (!/[A-Za-z]/.test(value)) return false
  if (value.includes('{') || value.includes('}') || value.includes('=>')) return false
  return !allowPatterns.some((pattern) => pattern.test(value))
}

function addViolation(sourceFile, relative, kind, text, position) {
  if (!isLikelyUserFacing(text)) return
  const { line } = sourceFile.getLineAndCharacterOfPosition(position)
  violations.push({ file: relative, line: line + 1, kind, text: text.trim() })
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const relative = path.relative(process.cwd(), filePath).replace(/\\/g, '/')
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  function visit(node) {
    if (ts.isJsxText(node)) {
      addViolation(sourceFile, relative, 'jsx-text', node.getText(sourceFile), node.getStart(sourceFile))
    }

    if (ts.isJsxAttribute(node)) {
      const attr = node.name.getText(sourceFile)
      if (attrNames.has(attr) && node.initializer && ts.isStringLiteral(node.initializer)) {
        addViolation(sourceFile, relative, attr, node.initializer.text, node.initializer.getStart(sourceFile))
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

if (!fs.existsSync(rootDir)) {
  console.error('Could not find src directory.')
  process.exit(1)
}

walk(rootDir)

if (violations.length === 0) {
  console.log('[OK] No obvious hardcoded UI strings found.')
  process.exit(0)
}

console.error(`[ERR] Found ${violations.length} potential hardcoded UI strings:`)
for (const v of violations.slice(0, 300)) {
  console.error(`- ${v.file}:${v.line} [${v.kind}] "${v.text}"`)
}
if (violations.length > 300) {
  console.error(`...and ${violations.length - 300} more`)
}
process.exit(2)
