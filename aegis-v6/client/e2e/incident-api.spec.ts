import { test, expect } from '@playwright/test'

const API = process.env.E2E_API_URL || 'http://localhost:3001'

test.describe('Incident API (smoke)', () => {
  test('GET /api/v1/incidents/registry returns incident list', async ({ request }) => {
    const res = await request.get(`${API}/api/v1/incidents/registry`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body) || (body && typeof body === 'object')).toBeTruthy()
  })

  test('GET /api/v1/incidents/flood/active returns 200', async ({ request }) => {
    const res = await request.get(`${API}/api/v1/incidents/flood/active`)
    expect(res.status()).toBe(200)
  })

  test('GET /api/v1/incidents/all/dashboard returns 200', async ({ request }) => {
    const res = await request.get(`${API}/api/v1/incidents/all/dashboard`)
    expect(res.status()).toBe(200)
  })
})
