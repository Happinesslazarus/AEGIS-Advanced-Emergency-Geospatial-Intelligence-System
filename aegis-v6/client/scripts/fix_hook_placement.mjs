 * Fix script: move useLanguage() from inside function parameter destructuring
 * to the function body (after the opening brace).
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const SRC = join(process.cwd(), 'src')

const FILES = [
  'components/admin/AdminAlertBroadcast.tsx',
  'components/admin/CommandCenter.tsx',
  'components/admin/IncidentCommandConsole.tsx',
  'components/admin/ResourceDeploymentConsole.tsx',
  'components/admin/UserAccessManagement.tsx',
  'components/shared/AlertCaptionOverlay.tsx',
  'components/shared/DisasterMap.tsx',
  'components/shared/IncidentMapLayers.tsx',
  'components/shared/Map3D.tsx',
  'components/shared/Map3DView.tsx',
]

const HOOK_LINE = '  const { language: lang } = useLanguage()\n'

for (const rel of FILES) {
  const file = join(SRC, rel)
  let code = readFileSync(file, 'utf8')
  
  // Pattern: the hook line is inside function params
  // Remove from where it currently is
  const hookRegex = /\n\s*const \{ language: lang \} = useLanguage\(\)\n/
  if (!hookRegex.test(code)) {
    console.log(`SKIP ${rel} — hook line not found`)
    continue
  }
  
  // Remove the hook line
  code = code.replace(hookRegex, '\n')
  
  // Now find the function body opening — various patterns
  // }: Props) {  or  }: Props): JSX.Element {  or  }) {  or  }): JSX.Element {
  const bodyPatterns = [
    /\}:\s*\w+\)(?::\s*[\w.<>| ]+)?\s*\{\n/,   // }: Props): ReturnType {
    /\}:\s*\w+\)\s*\{\n/,                         // }: Props) {
    /\}\)\s*\{\n/,                                  // }) {
    /\}\):\s*[\w.<>| ]+\s*\{\n/,                   // }): JSX.Element {
  ]
  
  let m = null
  for (const pat of bodyPatterns) {
    m = code.match(pat)
    if (m) break
  }
  
  if (m) {
    const insertPos = m.index + m[0].length
    // Check if hook already exists right after
    const nextChunk = code.slice(insertPos, insertPos + 200)
    if (!nextChunk.startsWith('  const { language: lang }')) {
      code = code.slice(0, insertPos) + HOOK_LINE + code.slice(insertPos)
      writeFileSync(file, code, 'utf8')
      console.log(`✓ Fixed ${rel}`)
    } else {
      console.log(`ALREADY OK ${rel}`)
    }
  } else {
    console.log(`WARN ${rel} — could not find function body opening`)
  }
}
