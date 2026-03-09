/*
 * uploadRoutes.ts — File Upload Handler
 *
 * Handles uploads for:
 *   - User avatars
 *   - Community post images
 *   - Message attachments
 *   - Status update photos
 */

import express, { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'

const router = express.Router()

// ─── Upload Directory Setup ───────────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// ─── Multer Configuration ─────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organize files by type
    const uploadType = (req as any).uploadType || 'general'
    const typeDir = path.join(uploadsDir, uploadType)
    if (!fs.existsSync(typeDir)) {
      fs.mkdirSync(typeDir, { recursive: true })
    }
    cb(null, typeDir)
  },
  filename: (req, file, cb) => {
    // Create unique filename: timestamp-random.ext
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    const ext = path.extname(file.originalname)
    cb(null, `${timestamp}-${random}${ext}`)
  },
})

const fileFilter = (req: any, file: Express.Multer.File, cb: any) => {
  // Only allow images
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml'
  ]

  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP, SVG)'), false)
  }

  // Check file size (10MB max)
  if ((file as any).size > 10 * 1024 * 1024) {
    return cb(new Error('File size must be less than 10MB'), false)
  }

  cb(null, true)
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
})

// ───┐ POST /upload — Generic upload endpoint ──────────────────────────────────
// Requires auth (citizen or operator)
// Expects: file in `file` field
router.post('/upload', 
  (req: any, res: any, next: any) => {
    // Determine upload type
    const auth = req.headers.authorization || ''
    req.uploadType = 'general'
    next()
  },
  upload.single('file'), 
  authMiddleware, 
  (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' })
      }

      const uploadType = (req as any).uploadType || 'general'
      const url = `/uploads/${uploadType}/${req.file.filename}`

      res.json({
        success: true,
        url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      })
    } catch (err: any) {
      console.error('[Upload] POST /upload error:', err.message)
      res.status(500).json({ error: 'Failed to upload file' })
    }
  }
)

// ───┐ POST /upload/avatar — Avatar upload ──────────────────────────────────────
router.post('/upload/avatar',
  (req: any, res: any, next: any) => {
    req.uploadType = 'avatars'
    next()
  },
  upload.single('file'),
  authMiddleware,
  (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' })
      }

      const url = `/uploads/avatars/${req.file.filename}`

      res.json({
        success: true,
        url,
        filename: req.file.filename,
      })
    } catch (err: any) {
      console.error('[Upload] POST /upload/avatar error:', err.message)
      res.status(500).json({ error: 'Failed to upload avatar' })
    }
  }
)

// ───┐ POST /upload/community — Community post images ─────────────────────────
router.post('/upload/community',
  (req: any, res: any, next: any) => {
    req.uploadType = 'community'
    next()
  },
  upload.single('file'),
  authMiddleware,
  (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' })
      }

      const url = `/uploads/community/${req.file.filename}`

      res.json({
        success: true,
        url,
        filename: req.file.filename,
      })
    } catch (err: any) {
      console.error('[Upload] POST /upload/community error:', err.message)
      res.status(500).json({ error: 'Failed to upload image' })
    }
  }
)

export default router

