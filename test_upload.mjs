// Quick test script for image upload endpoint
import { readFileSync, writeFileSync } from 'fs'

// Create a minimal valid JPEG (smallest possible JPEG file)
const jpegHeader = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
])
writeFileSync('e:\\aegis-v6-fullstack\\test_tiny.jpg', jpegHeader)

// Upload using fetch (Node 18+)
const formData = new FormData()
const blob = new Blob([jpegHeader], { type: 'image/jpeg' })
formData.append('image', blob, 'test_tiny.jpg')

try {
  const res = await fetch('http://localhost:3001/api/chat/upload-image', {
    method: 'POST',
    body: formData,
  })
  console.log('Status:', res.status)
  const body = await res.json()
  console.log('Body:', JSON.stringify(body, null, 2))
} catch (err) {
  console.error('Error:', err.message)
}
