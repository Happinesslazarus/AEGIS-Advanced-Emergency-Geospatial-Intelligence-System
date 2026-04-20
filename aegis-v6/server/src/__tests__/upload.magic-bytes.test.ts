/**
 * Unit tests for validateMagicBytes middleware in middleware/upload.ts.
 *
 * Covers:
 * - Valid JPEG file passes through
 * - Valid PNG file passes through
 * - File whose bytes do not match its extension is rejected with HTTP 400
 * - File with an unsupported extension is rejected with HTTP 400
 * - Deletes files from disk on rejection (no orphaned files)
 */

import path from 'path'
import fs from 'fs'
import os from 'os'
import type { Request, Response, NextFunction } from 'express'

/**
//Strategy:
//  1. Write real bytes to a temp file on disk
//  2. Point the Multer-style req.file at that path
//  3. Call validateMagicBytes with a mock req/res
//  4. Assert on status code, response body, and whether the file was deleted

 */
/** Write bytes to a real temp file and return the path */
function writeTempFile(bytes: Buffer, filename: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-test-'))
  const tmpPath = path.join(dir, filename)
  fs.writeFileSync(tmpPath, bytes)
  return tmpPath
}

interface MockRes {
  _status: number
  _body: unknown
  status(code: number): this
  json(body: unknown): this
}

function buildMockReqRes(file: { originalname: string; path: string }) {
  const req = { file } as unknown as Request

  const mockRes: MockRes = {
    _status: 200,
    _body: undefined,
    status(code: number) { this._status = code; return this },
    json(body: unknown) { this._body = body; return this },
  }

  const next = jest.fn() as unknown as NextFunction

  return { req, res: mockRes as unknown as Response, mockRes, next }
}

//Dynamically import -- keeps the module graph clean
let validateMagicBytes: (req: Request, res: Response, next: NextFunction) => void

beforeAll(async () => {
  const mod = await import('../middleware/upload.js')
  validateMagicBytes = mod.validateMagicBytes
})

// -
//JPEG (FF D8 FF)
// -

describe('validateMagicBytes', () => {
  describe('valid files', () => {
    it('passes a genuine JPEG through to next()', () => {
      const jpegMagic = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01])
      const tmpPath = writeTempFile(jpegMagic, 'photo.jpg')
      const { req, res, next } = buildMockReqRes({ originalname: 'photo.jpg', path: tmpPath })

      validateMagicBytes(req, res, next)

      expect(next).toHaveBeenCalled()
      expect((res as any)._status).toBe(200)
      //File must still exist (not deleted on success)
      expect(fs.existsSync(tmpPath)).toBe(true)
      fs.rmSync(path.dirname(tmpPath), { recursive: true })
    })

    it('passes a genuine PNG through to next()', () => {
      const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D])
      const tmpPath = writeTempFile(pngMagic, 'image.png')
      const { req, res, next } = buildMockReqRes({ originalname: 'image.png', path: tmpPath })

      validateMagicBytes(req, res, next)

      expect(next).toHaveBeenCalled()
      fs.rmSync(path.dirname(tmpPath), { recursive: true })
    })

    it('passes a genuine GIF through to next()', () => {
      //GIF89a starts with 47 49 46 38 39 61
      const gifMagic = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00])
      const tmpPath = writeTempFile(gifMagic, 'anim.gif')
      const { req, res, next } = buildMockReqRes({ originalname: 'anim.gif', path: tmpPath })

      validateMagicBytes(req, res, next)

      expect(next).toHaveBeenCalled()
      fs.rmSync(path.dirname(tmpPath), { recursive: true })
    })
  })

  describe('rejected files', () => {
    it('rejects and deletes a file whose bytes do not match its .jpg extension', () => {
      //Write PNG bytes but claim the file is a .jpg
      const pngBytesInJpgFile = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D])
      const tmpPath = writeTempFile(pngBytesInJpgFile, 'disguised.jpg')
      const { req, res, next } = buildMockReqRes({ originalname: 'disguised.jpg', path: tmpPath })

      validateMagicBytes(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect((res as any)._status).toBe(400)
      expect((res as any)._body).toMatchObject({ error: expect.stringContaining('magic bytes') })
      //File must have been deleted
      expect(fs.existsSync(tmpPath)).toBe(false)
    })

    it('rejects and deletes an executable disguised as a .jpg', () => {
      //MZ header = Windows PE executable
      const exeBytes = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00])
      const tmpPath = writeTempFile(exeBytes, 'malware.jpg')
      const { req, res, next } = buildMockReqRes({ originalname: 'malware.jpg', path: tmpPath })

      validateMagicBytes(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect((res as any)._status).toBe(400)
      expect(fs.existsSync(tmpPath)).toBe(false)
    })

    it('rejects a file with an unsupported extension', () => {
      const anyBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]) // PDF magic bytes
      const tmpPath = writeTempFile(anyBytes, 'document.pdf')
      const { req, res, next } = buildMockReqRes({ originalname: 'document.pdf', path: tmpPath })

      validateMagicBytes(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect((res as any)._status).toBe(400)
      expect((res as any)._body).toMatchObject({ error: expect.stringContaining('Unsupported') })
      expect(fs.existsSync(tmpPath)).toBe(false)
    })
  })
})
