/**
 * General-purpose file upload endpoints for community post images,
 * chat attachments, and other user media. Validates file types via
 * both extension and magic bytes.
 *
 * - Mounted at /api in index.ts (POST /api/upload/...)
 * - Uses Multer for multipart handling + validateMagicBytes for security
 * - Uploaded files served by the static handler in index.ts
 * */

import express, { Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import rateLimit from 'express-rate-limit'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { validateMagicBytes } from '../middleware/upload.js'
import { AppError } from '../utils/AppError.js'

const router = express.Router()

//20 uploads per user per 15 minutes
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip || 'unknown',
  message: { error: 'Too many uploads. Please wait before uploading again.' },
  standardHeaders: true,
  legacyHeaders: false,
})

//Upload Directory Setup
const uploadsDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

//Multer Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    //Organize files by type
    const uploadType = (req as any).uploadType || 'general'
    const typeDir = path.join(uploadsDir, uploadType)
    if (!fs.existsSync(typeDir)) {
      fs.mkdirSync(typeDir, { recursive: true })
    }
    cb(null, typeDir)
  },
  filename: (req, file, cb) => {
    //Create unique filename: timestamp-random.ext
    const timestamp = Date.now()
    const random = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    const ext = path.extname(file.originalname)
    cb(null, `${timestamp}-${random}${ext}`)
  },
})

const fileFilter = (req: any, file: Express.Multer.File, cb: any) => {
  //Only allow images
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ]

  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP, SVG)'), false)
  }

  //Check file size (10MB max)
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

//POST /upload -- Generic upload endpoint
//Requires auth (citizen or operator)
//Expects: file in `file` field
router.post('/upload',
  authMiddleware,
  uploadLimiter,
  (req: any, res: any, next: any) => {
    //Determine upload type
    const auth = req.headers.authorization || ''
    req.uploadType = 'general'
    next()
  },
  upload.single('file'),
  validateMagicBytes,
  (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw AppError.badRequest('No file provided')
    }

    const uploadType = (req as any).uploadType || 'general'
    const url = `/uploads/${uploadType}/${req.file.filename}`

    res.success({ url,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype })
  }
)

//POST /upload/avatar -- Avatar upload
router.post('/upload/avatar',
  authMiddleware,
  uploadLimiter,
  (req: any, res: any, next: any) => {
    req.uploadType = 'avatars'
    next()
  },
  upload.single('file'),
  (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw AppError.badRequest('No file provided')
    }

    const url = `/uploads/avatars/${req.file.filename}`

    res.success({ url,
      filename: req.file.filename })
  }
)

//POST /upload/community -- Community post images
router.post('/upload/community',
  authMiddleware,
  uploadLimiter,
  (req: any, res: any, next: any) => {
    req.uploadType = 'community'
    next()
  },
  upload.single('file'),
  (req: AuthRequest, res: Response) => {
    if (!req.file) {
      throw AppError.badRequest('No file provided')
    }

    const url = `/uploads/community/${req.file.filename}`

    res.success({ url,
      filename: req.file.filename })
  }
)

export default router

