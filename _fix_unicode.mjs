/**
 * Fix all corrupted Unicode replacement characters (U+FFFD / mojibake)
 * across the AEGIS codebase.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = 'e:/aegis-v6-fullstack/aegis-v6';
const EXTS = new Set(['.ts', '.tsx']);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'coverage') continue;
    const st = statSync(full);
    if (st.isDirectory()) files.push(...walk(full));
    else if (EXTS.has(extname(entry))) files.push(full);
  }
  return files;
}

// Specific foreign-language fixes for globalEmergencyDB.ts
const FOREIGN_FIXES = [
  ['L\uFFFDnea 106', 'Línea 106'],
  ['L\uFFFDnea 113', 'Línea 113'],
  ['Met \uFFFDireann', 'Met Éireann'],
  ['SOS Amiti\uFFFD', 'SOS Amitié'],
  ['S\uFFFDcurit\uFFFD Civile', 'Sécurité Civile'],
  ['M\uFFFDt\uFFFDo-France', 'Météo-France'],
  ['Tel\uFFFDfono de la Esperanza', 'Teléfono de la Esperanza'],
  ['Protecci\uFFFDn Civil', 'Protección Civil'],
  ['Pr\uFFFDvention du Suicide', 'Prévention du Suicide'],
  ['Sj\uFFFDlvmordslinjen', 'Självmordslinjen'],
  ['bezpec\uFFFD', 'bezpečí'],
  ['CHM\uFFFD', 'ČHMÚ'],
  ['T\uFFFDm Vi', 'Tâm Vi'],  // T�m Vi?t -> Tâm Việt (handle partial)
];

let totalFixed = 0;

for (const file of walk(ROOT)) {
  let content = readFileSync(file, 'utf-8');
  if (!content.includes('\uFFFD')) continue;

  const origContent = content;
  const relPath = file.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', '');

  // Apply foreign-language fixes first (globalEmergencyDB.ts)
  if (relPath.includes('globalEmergencyDB')) {
    for (const [bad, good] of FOREIGN_FIXES) {
      content = content.replaceAll(bad, good);
    }
  }

  // In regionConfig.ts template strings, replace bullet-point usage
  // Pattern: backtick + � + space (used as bullet points in template literals)
  if (relPath.includes('regionConfig')) {
    // Replace `\uFFFD **` with `• **` (bullet points in template strings)
    content = content.replaceAll('`\uFFFD **', '`• **');
    // Also handle the standalone pattern inside template lines
    content = content.replaceAll("'\\n')\n", "'\\n')\n");
  }

  // Replace any remaining \uFFFD with em-dash (used as arrow/separator in comments)
  content = content.replaceAll('\uFFFD', '\u2014');

  if (content !== origContent) {
    writeFileSync(file, content, 'utf-8');
    const count = (origContent.match(/\uFFFD/g) || []).length;
    totalFixed += count;
    console.log(`  Fixed ${count} in ${relPath}`);
  }
}

console.log(`\nTotal: ${totalFixed} corrupted characters fixed.`);
