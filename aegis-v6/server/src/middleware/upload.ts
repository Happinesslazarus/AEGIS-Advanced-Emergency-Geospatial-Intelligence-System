/**
 * Handles file uploads (evidence images, avatars) using Multer. After the file
 * is saved to disk, validateMagicBytes checks that the file's actual content
 * matches its declared extension — preventing attackers from uploading
 * disguised executables as .jpg files.
 *
 * - Used by reportRoutes.ts (evidence uploads) and uploadRoutes.ts (general uploads)
 * - Files are stored in server/uploads/ with UUID filenames to prevent collisions
 * - The static file server in index.ts serves uploaded files to the frontend
 *
 * - uploadEvidence — Multer middleware for up to 3 evidence images/videos (10 MB each)
 * - uploadAvatar — Multer middleware for a single avatar image (2 MB)
 * - validateMagicBytes — post-upload middleware that verifies file content
 * */

import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { Request, Response, NextFunction } from 'express'
import { logger } from '../services/logger.js'

// Magic byte signatures per file extension.
// Reading the first 12 bytes of the saved file and comparing against these
// prevents attackers from uploading malware.exe renamed to photo.jpg.
// MP4/MOV signatures start at byte offset 4 (after the 4-byte length field).
type MagicSig = { bytes: Buffer; offset: number }

const MAGIC_BYTES: Record<string, MagicSig[]> = {
  '.jpg':  [{ bytes: Buffer.from([0xFF, 0xD8, 0xFF]), offset: 0 }],
  '.jpeg': [{ bytes: Buffer.from([0xFF, 0xD8, 0xFF]), offset: 0 }],
  '.jfif': [{ bytes: Buffer.from([0xFF, 0xD8, 0xFF]), offset: 0 }],
  '.png':  [{ bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47]), offset: 0 }],
  '.gif':  [{ bytes: Buffer.from([0x47, 0x49, 0x46, 0x38]), offset: 0 }],
  '.webp': [{ bytes: Buffer.from([0x52, 0x49, 0x46, 0x46]), offset: 0 }],
  '.mp4':  [{ bytes: Buffer.from([0x66, 0x74, 0x79, 0x70]), offset: 4 }],
  '.mov':  [{ bytes: Buffer.from([0x66, 0x74, 0x79, 0x70]), offset: 4 }],
}

const UPLOAD_DIR_EVIDENCE = path.join(process.cwd(), 'uploads', 'evidence')
const UPLOAD_DIR_AVATARS  = path.join(process.cwd(), 'uploads', 'avatars')

// Create upload directories on startup if they don't already exist.
// Using { recursive: true } avoids errors if parents also need creating.
for (const dir of [UPLOAD_DIR_EVIDENCE, UPLOAD_DIR_AVATARS]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function validateMagicBytes(req: Request, res: Response, next: NextFunction): void {
  const files: Express.Multer.File[] = []
  if ((req as any).file) files.push((req as any).file)
  if (Array.isArray((req as any).files)) files.push(...(req as any).files)

  for (const file of files) {
    try {
      const ext = path.extname(file.originalname).toLowerCase()
      const signatures = MAGIC_BYTES[ext]
      if (!signatures) {
        fs.unlinkSync(file.path)
        res.status(400).json({ error: `Unsupported file type: ${ext}` })
        return
      }
      const buf = Buffer.alloc(12)
      const fd = fs.openSync(file.path, 'r')
      try {
        fs.readSync(fd, buf, 0, 12, 0)
      } finally {
        fs.closeSync(fd)
      }

      const valid = signatures.some(sig =>
        buf.subarray(sig.offset, sig.offset + sig.bytes.length).equals(sig.bytes)
      )
      if (!valid) {
        fs.unlinkSync(file.path)
        res.status(400).json({ error: `File appears to have incorrect format. Expected ${ext} but magic bytes don't match.` })
        return
      }
    } catch (err) {
      logger.error({ err, file: file.originalname }, '[Upload] File validation failed')
      try { fs.unlinkSync(file.path) } catch {}
      res.status(400).json({ error: 'File validation failed.' })
      return
    }
  }
  next()
}

// UUID filenames prevent path traversal and filename collision attacks.
// Extension is taken from the original name only for the MIME extension;
// the actual file content is verified by validateMagicBytes later.
const storageEvidence = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_EVIDENCE),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${uuid()}${ext}`)
  },
})

const storageAvatars = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_AVATARS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${uuid()}${ext}`)
  },
})

function fileFilterEvidence(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  const allowed = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.mp4', '.mov']
  const ext = path.extname(file.originalname).toLowerCase()
  if (allowed.includes(ext)) {
    cb(null, true)
  } else {
    cb(new Error(`File type ${ext} not supported. Allowed: ${allowed.join(', ')}`))
  }
}

// uploadEvidence accepts up to 3 files per request, max 10 MB each.
// The 'evidence' field name must match what the frontend FormData uses.
export const uploadEvidence = multer({
  storage: storageEvidence,
  fileFilter: fileFilterEvidence,
  limits: { fileSize: 10 * 1024 * 1024 },
}).array('evidence', 3)

// uploadAvatar: single image only, 2 MB max, no video.
export const uploadAvatar = multer({
  storage: storageAvatars,
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp']
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, allowed.includes(ext))
  },
  limits: { fileSize: 2 * 1024 * 1024 },
}).single('avatar')
