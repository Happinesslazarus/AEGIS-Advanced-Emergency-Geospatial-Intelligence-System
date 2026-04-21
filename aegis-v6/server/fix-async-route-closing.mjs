/**
 * fix-async-route-closing.mjs
 *
 * For routes wrapped in asyncRoute(...) but ending with }) instead of })),
 * this script fixes the closing paren count.
 *
 * Logic: track asyncRoute( opens. When we see }) on a line at depth 0
 * (relative to the asyncRoute call), change to })).
 */
import { readFileSync, writeFileSync } from 'fs'

for (const filePath of process.argv.slice(2)) {
  const raw = readFileSync(filePath, 'utf8')
  const wasCRLF = raw.includes('\r\n')
  const src = raw.replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const result = []
  let fixed = 0

  // Track paren depth for asyncRoute( opening
  let asyncRouteDepth = 0
  let insideAsyncRoute = false
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Count asyncRoute( opens and corresponding closes
    if (line.includes('asyncRoute(async')) {
      insideAsyncRoute = true
      braceDepth = 0
    }

    if (insideAsyncRoute) {
      let opened = 0, closed = 0
      for (const ch of line) {
        if (ch === '{') opened++
        if (ch === '}') closed++
      }

      // Detect closing line: }) when braceDepth is about to hit 0
      // The `}` in `})` closes the async function body, `)` closes router.METHOD(
      // But there should be an extra `)` for asyncRoute(
      const trimmed = line.trimEnd()
      if (trimmed === '})' || trimmed === '  })' || trimmed === '    })') {
        const indent = line.match(/^(\s*)/)?.[1] || ''
        // Only fix if braceDepth will hit 0 after this line
        // and the line is exactly `})`
        if (trimmed === '})') {
          result.push(indent + '}))' )
          fixed++
          insideAsyncRoute = false
          braceDepth = 0
          continue
        }
      }

      braceDepth += opened - closed

      // Detect close of asyncRoute handler via `}))` — reset state
      if (trimmed === '}))' || trimmed === '  }))') {
        insideAsyncRoute = false
        braceDepth = 0
      }
    }

    result.push(line)
  }

  let out = result.join('\n')
  if (wasCRLF) out = out.replace(/\n/g, '\r\n')
  writeFileSync(filePath, out, 'utf8')
  console.log(`${filePath}: fixed ${fixed} route closings`)
}
