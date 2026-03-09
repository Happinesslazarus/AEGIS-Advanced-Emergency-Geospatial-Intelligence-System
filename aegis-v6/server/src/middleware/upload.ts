/*
 * upload.ts - File upload middleware using Multer
 *
 * Configures Multer for handling multipart form data uploads.
 * Supports two upload types:
 *   1. Report evidence (photos/videos from citizens)
 *   2. Profile avatars (admin operator photos)
 *
 * Files are stored in the server/uploads/ directory with unique
 * filenames generated using UUID to prevent collisions.
 * 
 * Security measures:
 *   - File size limit: 10MB for evidence, 2MB for avatars
 *   - Allowed types: JPEG, PNG, WebP, GIF, MP4 for evidence
 *   - Allowed types: JPEG, PNG, WebP for avatars
 */

import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { Request, Response, NextFunction } from 'express'

// Magic byte signatures for allowed file types (#79)
const MAGIC_BYTES: Record<string, Buffer[]> = {
  '.jpg':  [Buffer.from([0xFF, 0xD8, 0xFF])],
  '.jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  '.jfif': [Buffer.from([0xFF, 0xD8, 0xFF])],
  '.png':  [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  '.gif':  [Buffer.from([0x47, 0x49, 0x46, 0x38])],
  '.webp': [Buffer.from([0x52, 0x49, 0x46, 0x46])], // RIFF header
  '.mp4':  [Buffer.from([0x00, 0x00, 0x00]), Buffer.from([0x66, 0x74, 0x79, 0x70])], // ftyp
  '.mov':  [Buffer.from([0x00, 0x00, 0x00])],
}

/**
 * Post-upload middleware that validates magic bytes of uploaded files.
 * Deletes files that don't match expected signatures.
 */
export function validateMagicBytes(req: Request, res: Response, next: NextFunction): void {
  const files: Express.Multer.File[] = []
  if ((req as any).file) files.push((req as any).file)
  if (Array.isArray((req as any).files)) files.push(...(req as any).files)

  for (const file of files) {
    try {
      const ext = path.extname(file.originalname).toLowerCase()
      const signatures = MAGIC_BYTES[ext]
      if (!signatures) {
        // Unknown extension — already filtered by multer, but be safe
        fs.unlinkSync(file.path)
        res.status(400).json({ error: `Unsupported file type: ${ext}` })
        return
      }
      const buf = Buffer.alloc(8) 
      const fd = fs.openSync(file.path, 'r')
      fs.readSync(fd, buf, 0, 8, 0)
      fs.closeSync(fd)

      const valid = signatures.some(sig => buf.subarray(0, sig.length).equals(sig))
      if (!valid) {
        fs.unlinkSync(file.path)
        res.status(400).json({ error: `File appears to have incorrect format. Expected ${ext} but magic bytes don't match.` })
        return
      }
    } catch (err: any) {
      // If validation fails, reject the file
      try { fs.unlinkSync(file.path) } catch {}
      res.status(400).json({ error: 'File validation failed.' })
      return
    }
  }
  next()
}

// Configure storage location and filename generation
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads'))
  },
  filename: (_req, file, cb) => {
    // Generate unique filename preserving the original extension
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${uuid()}${ext}`)
  },
})

// Validate that uploaded files are acceptable image or video types
function fileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  const allowed = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.mp4', '.mov']
  const ext = path.extname(file.originalname).toLowerCase()
  if (allowed.includes(ext)) {
    cb(null, true)
  } else {
    cb(new Error(`File type ${ext} not supported. Allowed: ${allowed.join(', ')}`))
  }
}

// Evidence upload: up to 10MB per file, max 3 files per report
export const uploadEvidence = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
}).array('evidence', 3)

// Avatar upload: up to 2MB, for operator profile photos
export const uploadAvatar = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp']
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, allowed.includes(ext))
  },
  limits: { fileSize: 2 * 1024 * 1024 },
}).single('avatar')
