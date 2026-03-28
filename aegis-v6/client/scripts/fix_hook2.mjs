 * Fix: Remove useLanguage() from inside destructured params and add it to the function body.
 * Reads the file, finds the problematic pattern, and moves the hook.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const SRC = join(process.cwd(), 'src')
const HOOK = "  const { language: lang } = useLanguage()\n"

const FILES = [
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

for (const rel of FILES) {
  const file = join(SRC, rel)
  let code = readFileSync(file, 'utf8')
  
  // Remove the misplaced line
  const badLine = "  const { language: lang } = useLanguage()\n"
  if (!code.includes(badLine)) {
    console.log(`SKIP ${rel} — line not found`)
    continue
  }
  
  code = code.replace(badLine, '')
  
  // Find the function body opening — look for the pattern }: TypeName) { or }): ReturnType {
  // We need to find the closing of the parameter destructuring
  // Pattern possibilities:
  //   }: Props) {
  //   }: Props): JSX.Element {
  //   }: CommandCenterProps) {
  //   }): JSX.Element | null {
  const bodyOpenMatch = code.match(/\}: \w+\)(?::\s*[\w.<>| ]+)?\s*\{[\r\n]/)
  if (bodyOpenMatch) {
    const insertPos = bodyOpenMatch.index + bodyOpenMatch[0].length
    code = code.slice(0, insertPos) + HOOK + code.slice(insertPos)
    writeFileSync(file, code, 'utf8')
    console.log(`✓ Fixed ${rel}`)
  } else {
    console.log(`WARN ${rel} — body opening not found`)
    // Try to handle the case, write the removed version anyway
    writeFileSync(file, code, 'utf8')
  }
}
