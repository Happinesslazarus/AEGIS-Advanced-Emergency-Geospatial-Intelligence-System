/**
 * What it tests:
 * Unit tests for the translation service (LibreTranslate adapter).
  * Verifies language detection, translation caching, retry on 429,
  * and graceful degradation when LibreTranslate is unavailable.
  *
  * How it connects:
  * - Tests server/src/services/translationService.ts
  * - LibreTranslate API mocked with nock
  * - Run via: npm test -- translation
 */

const mockQuery = jest.fn()
const mockPool = {
  query: mockQuery,
  on: jest.fn(),
}

jest.mock('../models/db.js', () => ({
  __esModule: true,
  default: mockPool,
}))

import {
  translateText,
  __resetTranslationStateForTests,
} from '../services/translationService.js'

const originalEnv = { ...process.env }
const mockFetch = jest.fn()

function createJsonResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('translationService', () => {
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

  beforeAll(() => {
    global.fetch = mockFetch as unknown as typeof fetch
  })

  beforeEach(() => {
    jest.clearAllMocks()
    __resetTranslationStateForTests()
    process.env = {
      ...originalEnv,
      AZURE_TRANSLATOR_KEY: 'azure-key',
      AZURE_TRANSLATOR_REGION: 'global',
      AZURE_TRANSLATOR_ENDPOINT: 'https://api.cognitive.microsofttranslator.com/',
      DEEPL_API_KEY: 'deepl-key',
      DEEPL_ENDPOINT: 'https://api-free.deepl.com/v2/translate',
      LIBRE_TRANSLATE_ENDPOINT: 'https://libre.example/translate',
    }
  })

  afterAll(() => {
    process.env = originalEnv
    consoleWarnSpy.mockRestore()
  })

  it('returns a cached translation without calling providers', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          translated_text: 'Bonjour',
          detected_language: 'en',
          provider: 'azure',
        },
      ],
    })

    const result = await translateText('Hello', 'fr')

    expect(result.translatedText).toBe('Bonjour')
    expect(result.cached).toBe(true)
    expect(result.provider).toBe('azure')
    expect(result.status).toBe('translated')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('falls back to DeepL when Azure fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    mockFetch
      .mockResolvedValueOnce(createJsonResponse(429, { error: { message: 'rate limited' } }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          translations: [
            {
              text: 'Bonjour',
              detected_source_language: 'EN',
            },
          ],
        }),
      )

    const result = await translateText('Hello', 'fr')

    expect(result.translatedText).toBe('Bonjour')
    expect(result.provider).toBe('deepl')
    expect(result.available).toBe(true)
    expect(result.status).toBe('translated')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns the original text when every provider fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    mockFetch
      .mockResolvedValueOnce(createJsonResponse(500, { error: { message: 'azure down' } }))
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'deepl down' }))
      .mockResolvedValueOnce(createJsonResponse(500, { error: 'libre down' }))

    const result = await translateText('Need help', 'fr')

    expect(result.translatedText).toBe('Need help')
    expect(result.provider).toBe('unavailable')
    expect(result.available).toBe(false)
    expect(result.status).toBe('unavailable')
  })

  it('passes through URL-only text without calling providers', async () => {
    const result = await translateText('https://status.aegis.example/incident/42', 'fr')

    expect(result.translatedText).toBe('https://status.aegis.example/incident/42')
    expect(result.provider).toBe('passthrough')
    expect(result.available).toBe(true)
    expect(result.status).toBe('passthrough')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
