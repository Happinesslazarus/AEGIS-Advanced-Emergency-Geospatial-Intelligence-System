const fs = require('fs');
const filePath = 'aegis-v6/server/src/routes/extendedRoutes.ts';
const src = fs.readFileSync(filePath, 'utf8');
const start = src.indexOf('//Safe Zone / Shelter Capacity Alerts');
const re = /\r?\nexport default router\r?\n/;
const m = re.exec(src);
if (start < 0 || !m) { console.error('markers not found'); process.exit(1); }
const exportIdx = m.index;
const block = src.slice(start, exportIdx);
const header = "/**\n * Operational alert routes (Safe Zones + Metro/Transit).\n * Extracted from extendedRoutes.ts (C3).\n */\nimport { Router, Request, Response } from 'express'\nimport { authMiddleware, AuthRequest } from '../middleware/auth.js'\nimport { requireOperator } from '../middleware/internalAuth.js'\nimport { asyncRoute } from '../utils/asyncRoute.js'\nimport { AppError } from '../utils/AppError.js'\nimport * as notificationService from '../services/notificationService.js'\nimport { broadcastAlert } from '../services/socket.js'\nimport pool from '../models/db.js'\n\nconst router = Router()\n\n";
const footer = '\n\nexport default router\n';
fs.writeFileSync('aegis-v6/server/src/routes/operationalAlertRoutes.ts', header + block + footer);
console.log('wrote operationalAlertRoutes.ts');
let replaced = src.slice(0, start) +
  '//Safe Zone + Metro/Transit alerts extracted to operationalAlertRoutes.ts (C3)\n\n' +
  src.slice(exportIdx + m[0].length);
if (!/export default router\s*$/.test(replaced.trimEnd())) {
  replaced = replaced.replace(/\s*$/, '\n\nexport default router\n');
}
fs.writeFileSync(filePath, replaced);
console.log('extendedRoutes.ts now ' + replaced.split(/\r?\n/).length + ' lines');
