/**
 * Retrieval-Augmented Generation (RAG) for the AEGIS chat service.
 *
 * retrieveRAGContext() embeds the query, performs vector similarity search over
 * the knowledge base, then optionally reranks results with a cross-encoder.
 */
import pool from '../models/db.js'
import { logger } from './logger.js'
import { devLog } from '../utils/logger.js'
import { embedText } from './embeddingRouter.js'

/**
 * Cross-encoder re-ranking: score each (query, document) pair with a
 * HuggingFace Inference API cross-encoder model, then sort by score.
 * Uses ms-marco-MiniLM-L-6-v2 -- free tier, ~6ms per pair.
 */
export async function crossEncoderRerank(
  query: string,
  docs: Array<{ title: string; content: string; source: string; similarity?: number }>,
  topK: number = 3,
): Promise<Array<{ title: string; content: string; source: string; similarity?: number; rerank_score: number }>> {
  const hfKey = process.env.HF_API_KEY
  if (!hfKey || docs.length <= topK) {
    //No HF key or too few docs -- skip re-ranking
    return docs.slice(0, topK).map(d => ({ ...d, rerank_score: d.similarity ?? 0 }))
  }

  const model = 'cross-encoder/ms-marco-MiniLM-L-6-v2'
  const url = `https://api-inference.huggingface.co/models/${model}`

  try {
    const pairs = docs.map(d => ({
      source_sentence: query,
      sentences: [d.content.substring(0, 512)],  // Cross-encoder needs short passages
    }))

    //HF inference API expects a flat request for text-classification / sentence-similarity
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          source_sentence: query,
          sentences: docs.map(d => d.content.substring(0, 512)),
        },
      }),
    })

    if (!res.ok) {
      devLog(`[RAG Rerank] HF API ${res.status} -- skipping re-rank`)
      return docs.slice(0, topK).map(d => ({ ...d, rerank_score: d.similarity ?? 0 }))
    }

    const scores: number[] = await res.json() as number[]
    if (!Array.isArray(scores) || scores.length !== docs.length) {
      return docs.slice(0, topK).map(d => ({ ...d, rerank_score: d.similarity ?? 0 }))
    }

    const scored = docs.map((d, i) => ({ ...d, rerank_score: scores[i] }))
    scored.sort((a, b) => b.rerank_score - a.rerank_score)
    devLog(`[RAG Rerank] Re-ranked ${docs.length} docs, top score: ${scored[0]?.rerank_score?.toFixed(4)}`)
    return scored.slice(0, topK)
  } catch (err: any) {
    devLog(`[RAG Rerank] Error: ${err.message} -- using original order`)
    return docs.slice(0, topK).map(d => ({ ...d, rerank_score: d.similarity ?? 0 }))
  }
}

export async function retrieveRAGContext(query: string, limit = 12): Promise<string> {
  try {
    //Phase 1: Hybrid retrieval -- vector similarity + BM25 full-text in parallel
    let vectorRows: any[] = []
    let bm25Rows: any[] = []

    const candidateLimit = Math.max(limit * 3, 20)

    //Run vector search and BM25 full-text search concurrently
    const [vectorResult, bm25Result] = await Promise.allSettled([
      //Vector similarity search
      (async () => {
        const embedding = await embedText(query)
        if (!embedding || embedding.length === 0) return []
        const pgArray = `{${embedding.join(',')}}`
        const { rows } = await pool.query(
          `SELECT title, content, source,
            cosine_similarity(embedding_vector, $1::double precision[]) as similarity
           FROM rag_documents
           WHERE embedding_vector IS NOT NULL
             AND array_length(embedding_vector, 1) = $2
           ORDER BY cosine_similarity(embedding_vector, $1::double precision[]) DESC
           LIMIT $3`,
          [pgArray, embedding.length, candidateLimit],
        )
        return rows
      })(),
      //BM25 full-text search
      (async () => {
        const { rows } = await pool.query(
          `SELECT title, content, source,
            ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $1)) as bm25_score
           FROM rag_documents
           WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
           ORDER BY bm25_score DESC
           LIMIT $2`,
          [query, candidateLimit],
        )
        return rows
      })(),
    ])

    if (vectorResult.status === 'fulfilled') vectorRows = vectorResult.value
    else logger.warn({ err: vectorResult.reason }, '[Chat RAG] Vector search failed -- using BM25 only')

    if (bm25Result.status === 'fulfilled') bm25Rows = bm25Result.value

    //Phase 2: Reciprocal Rank Fusion (RRF) -- merge both result sets
    const RRF_K = 60 // standard RRF constant
    const scoreMap = new Map<string, { doc: any; score: number }>()

    //Score vector results by rank
    vectorRows.forEach((doc, rank) => {
      const key = `${doc.title}::${doc.source}`
      const existing = scoreMap.get(key)
      const rrfScore = 1 / (RRF_K + rank + 1)
      if (existing) {
        existing.score += rrfScore
      } else {
        scoreMap.set(key, { doc, score: rrfScore })
      }
    })

    //Score BM25 results by rank
    bm25Rows.forEach((doc, rank) => {
      const key = `${doc.title}::${doc.source}`
      const existing = scoreMap.get(key)
      const rrfScore = 1 / (RRF_K + rank + 1)
      if (existing) {
        existing.score += rrfScore // documents found by BOTH methods get boosted
      } else {
        scoreMap.set(key, { doc, score: rrfScore })
      }
    })

    //Sort by fused score
    const fusedCandidates = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map(({ doc, score }) => ({ ...doc, fusion_score: score }))

    if (fusedCandidates.length === 0) return ''

    //Phase 3: Cross-encoder re-ranking for final precision
    const reranked = await crossEncoderRerank(query, fusedCandidates, limit)
    devLog(`[Chat RAG] Hybrid retrieval: ${vectorRows.length} vector + ${bm25Rows.length} BM25 ? ${fusedCandidates.length} fused ? re-ranked top ${reranked.length}`)

    return '\n\n--- RELEVANT KNOWLEDGE BASE ---\n' +
      reranked.map((r: any) => `[${r.source}] ${r.title}:\n${r.content}`).join('\n\n') +
      '\n--- END KNOWLEDGE BASE ---\n'
  } catch (err: any) {
    logger.warn({ err }, '[Chat] RAG retrieval error')
    return ''
  }
}

