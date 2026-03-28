// Test if backend API is reachable at all
try {
  const res = await fetch('http://localhost:3001/api/chat/status')
  console.log('Status endpoint:', res.status)
  const text = await res.text()
  console.log('Response (first 200 chars):', text.slice(0, 200))
} catch (err) {
  console.error('Cannot reach server:', err.message)
}

// Also try upload
const formData = new FormData()
const jpegHeader = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
])
const blob = new Blob([jpegHeader], { type: 'image/jpeg' })
formData.append('image', blob, 'test.jpg')

try {
  const res = await fetch('http://localhost:3001/api/chat/upload-image', {
    method: 'POST',
    body: formData,
  })
  console.log('Upload endpoint:', res.status)
  const text = await res.text()
  console.log('Upload response (first 300 chars):', text.slice(0, 300))
} catch (err) {
  console.error('Upload error:', err.message)
}
