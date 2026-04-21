/**
 * Semantic response caching for the AEGIS chat service.
 *
 * Caches LLM responses by query embedding so repeated or semantically similar
 * queries are served instantly from the database cache.
 */
import crypto from 'crypto'
import pool from '../models/db.js'
import { logger } from './logger.js'
import { generateEmbeddings } from './embeddingRouter.js'

export function hashQuery(text: string): string {
  return crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex')
}

export async function getCachedResponse(queryHash: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `UPDATE response_cache SET hit_count = hit_count + 1
       WHERE query_hash = $1 AND expires_at > now()
       RETURNING response_text`,
      [queryHash],
    )
    return rows.length > 0 ? rows[0].response_text : null
  } catch {
    return null
  }
}

export async function cacheResponse(queryHash: string, queryText: string, response: string, model: string): Promise<void> {
  try {
    //Generate embedding for semantic cache lookup
    let embeddingStr: string | null = null
    try {
      const embResult = await generateEmbeddings({ texts: [queryText] })
      if (embResult.embeddings.length > 0 && embResult.embeddings[0].length > 0) {
        embeddingStr = `[${embResult.embeddings[0].join(',')}]`
      }
    } catch {
      //Embedding generation is best-effort
    }

    await pool.query(
      `INSERT INTO response_cache (query_hash, query_text, response_text, model_used, ttl_seconds, expires_at, embedding_vector)
       VALUES ($1, $2, $3, $4, 3600, now() + INTERVAL '1 hour', $5::vector)
       ON CONFLICT (query_hash) DO UPDATE SET
         response_text = $3, model_used = $4, hit_count = 0,
         expires_at = now() + INTERVAL '1 hour',
         embedding_vector = COALESCE($5::vector, response_cache.embedding_vector)`,
      [queryHash, queryText, response, model, embeddingStr],
    )
  } catch (err: any) {
    logger.warn({ err }, '[Chat] Cache write failed')
  }
}

export async function getQueryEmbedding(text: string): Promise<string> {
  const embResult = await generateEmbeddings({ texts: [text] })
  if (embResult.embeddings.length > 0 && embResult.embeddings[0].length > 0) {
    return `[${embResult.embeddings[0].join(',')}]`
  }
  throw new Error('No embedding generated')
}

