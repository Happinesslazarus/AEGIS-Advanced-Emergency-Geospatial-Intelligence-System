/**
 * fix-promise-void-signatures.mjs
 *
 * For routes that had `: Promise<void>` return type annotation,
 * the catch removal already changed }) → })) but the signature
 * wasn't wrapped with asyncRoute(.
 *
 * This script adds the asyncRoute( wrapper to these signatures.
 */
import { readFileSync, writeFileSync } from 'fs'

for (const filePath of process.argv.slice(2)) {
  const raw = readFileSync(filePath, 'utf8')
  const wasCRLF = raw.includes('\r\n')
  let src = raw.replace(/\r\n/g, '\n')

  // Transform: , async (PARAMS, next: NextFunction): Promise<void> =>
  // To:        , asyncRoute(async (PARAMS) =>
  src = src.replace(
    /,\s*async\s*\(([^)]+?),\s*next\s*:\s*NextFunction\s*\)\s*:\s*Promise<\w+>\s*=>/g,
    (_, params) => `, asyncRoute(async (${params.trim()}) =>`
  )

  // Also handle the rare ): void => variant
  src = src.replace(
    /,\s*async\s*\(([^)]+?),\s*next\s*:\s*NextFunction\s*\)\s*:\s*void\s*=>/g,
    (_, params) => `, asyncRoute(async (${params.trim()}) =>`
  )

  const changed = src !== raw.replace(/\r\n/g, '\n')
  if (wasCRLF) src = src.replace(/\n/g, '\r\n')
  writeFileSync(filePath, src, 'utf8')

  const sigs = (src.match(/asyncRoute\(async/g) || []).length
  const remaining = (src.match(/next\s*:\s*NextFunction/g) || []).length
  console.log(`${filePath}: ${sigs} asyncRoute signatures, ${remaining} remaining next:NextFunction`)
}
