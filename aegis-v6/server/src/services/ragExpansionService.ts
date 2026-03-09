/**
 * services/ragExpansionService.ts — RAG Knowledge Base Builder
 *
 * Expands the RAG document store (rag_documents table) with:
 *   1. Wikipedia flood knowledge articles
 *   2. UK Government flood guidance documents
 *   3. Historical flood event summaries
 *   4. News article content
 *   5. Climate/weather pattern knowledge
 *   6. Emergency response procedures
 *
 * Uses text-based search as primary (pgvector optional enhancement).
 * All content is chunked, deduplicated, and indexed for retrieval.
 */

import pool from '../models/db.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1  RAG DOCUMENT STORE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

interface RAGDocument {
  title: string
  content: string
  source: string
  category: string
  metadata?: Record<string, any>
}

const CHUNK_SIZE = 500 // tokens (roughly words)
const CHUNK_OVERLAP = 50

/** Split text into overlapping chunks for RAG retrieval */
function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/)
  if (words.length <= chunkSize) return [text]

  const chunks: string[] = []
  let start = 0
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length)
    chunks.push(words.slice(start, end).join(' '))
    start += chunkSize - overlap
    if (start >= words.length) break
  }
  return chunks
}

/** Store a document (chunked) in the RAG table */
async function storeRAGDocument(doc: RAGDocument): Promise<number> {
  const chunks = chunkText(doc.content)
  let stored = 0

  // Try to get embedding function (may not be available if no API key)
  let embedFn: ((text: string) => Promise<number[]>) | null = null
  try {
    const { embedText } = await import('./embeddingRouter.js')
    embedFn = embedText
  } catch { /* embedding provider not configured */ }

  for (let i = 0; i < chunks.length; i++) {
    try {
      const title = chunks.length > 1 ? `${doc.title} [Part ${i + 1}/${chunks.length}]` : doc.title
      const meta = JSON.stringify({
        ...doc.metadata,
        chunk_index: i,
        total_chunks: chunks.length,
        original_title: doc.title,
      })

      // Generate embedding vector if provider available
      let embeddingVector: number[] | null = null
      if (embedFn) {
        try {
          embeddingVector = await embedFn(`${title}. ${chunks[i]}`)
        } catch { /* embedding failed for this chunk */ }
      }

      if (embeddingVector) {
        const pgArray = `{${embeddingVector.join(',')}}`
        await pool.query(`
          INSERT INTO rag_documents (title, content, source, category, metadata, embedding_vector, embedding_dimensions)
          VALUES ($1, $2, $3, $4, $5, $6::double precision[], $7)
          ON CONFLICT DO NOTHING
        `, [title, chunks[i], doc.source, doc.category, meta, pgArray, embeddingVector.length])
      } else {
        await pool.query(`
          INSERT INTO rag_documents (title, content, source, category, metadata)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [title, chunks[i], doc.source, doc.category, meta])
      }
      stored++
    } catch { /* skip duplicates */ }
  }
  return stored
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  KNOWLEDGE BASE: FLOOD MANAGEMENT EXPERTISE
// ═══════════════════════════════════════════════════════════════════════════════

const FLOOD_KNOWLEDGE_BASE: RAGDocument[] = [
  {
    title: 'UK Flood Risk Assessment Framework',
    content: `The UK uses a comprehensive flood risk assessment framework managed by the Environment Agency (England), SEPA (Scotland), NRW (Wales), and DfI Rivers (Northern Ireland). Risk is categorised into four levels: Low (less than 1 in 1000 annual probability), Medium (between 1 in 100 and 1 in 1000), High (greater than 1 in 100 for rivers, 1 in 200 for sea), and Very Significant (greater than 1 in 30). The assessment considers three components: hazard (source of flooding), pathway (route flood water takes), and receptor (people, property, environment at risk). Strategic Flood Risk Assessments (SFRAs) are produced by local planning authorities using Environment Agency data, historical records, and climate projections. The National Planning Policy Framework (NPPF) requires that development should not increase flood risk and should reduce it where possible through Sustainable Drainage Systems (SuDS).`,
    source: 'UK Government DEFRA',
    category: 'flood_policy',
  },
  {
    title: 'Types of Flooding in the UK',
    content: `The UK experiences several distinct flood types: 1) Fluvial/River flooding - when rivers overtop their banks due to prolonged rainfall saturating catchments. Common in winter months. Major UK rivers prone: Thames, Severn, Trent, Dee, Tay. 2) Pluvial/Surface water flooding - when rainfall exceeds drainage capacity. Most common flood type, affecting 3.2 million properties. Hard to predict. 3) Coastal/Tidal flooding - storm surges combine with high tides. East coast and Thames Estuary most vulnerable. Climate change increasing risk through sea level rise. 4) Groundwater flooding - water table rises above ground surface. Chalk and limestone areas in southern England most vulnerable. Can last weeks to months. 5) Sewer flooding - combined storm/foul sewers overwhelmed during heavy rain. Urban areas most affected. 6) Reservoir flooding - dam failure or overtopping. Very rare but catastrophic. 7) Flash flooding - rapid onset from intense rainfall over small catchments. Increasingly common with climate change.`,
    source: 'Environment Agency',
    category: 'flood_types',
  },
  {
    title: 'Flood Warning Systems in the UK',
    content: `The Environment Agency operates a 3-level flood warning system: 1) Flood Alert (yellow) - "Flooding is possible. Be prepared." Issued when flooding is expected to affect low-lying land and roads. Typically 2-3 hours advance warning. 2) Flood Warning (amber) - "Flooding is expected. Immediate action required." Issued when flooding to properties is expected. Includes specific areas at risk. 3) Severe Flood Warning (red) - "Severe flooding. Danger to life." Issued when significant risk to life or substantial damage to property. This is the highest level and rare. SEPA operates a similar system for Scotland with Flood Alert, Flood Warning, and Severe Flood Warning levels. Met Office issues weather warnings independently using a 4-level system: Yellow, Amber, Red for rainfall and storms. The Flood Forecasting Centre (FFC) is a joint operation between Met Office and Environment Agency providing 5-day flood guidance to emergency responders.`,
    source: 'Environment Agency / SEPA',
    category: 'flood_warnings',
  },
  {
    title: 'Climate Change Impact on UK Flooding',
    content: `Climate projections (UKCP18) indicate significant increases in UK flood risk: Temperature rise of 1.5-4.5°C by 2100 depending on emissions pathway. Winter rainfall expected to increase 10-30% by 2080s. Summer rainfall may decrease but become more intense (more flash floods). Sea level rise of 0.3-1.1m by 2100 along UK coastline. The Committee on Climate Change estimates that without adaptation: properties at significant flood risk will increase from 1.8 million to 2.6 million by 2050. Current flood defences protect to approx 1 in 100 year standard. Climate change means a "1 in 100 year" flood today may become a "1 in 30 year" event by 2080. The Environment Agency estimates £1 billion annual investment needed in flood defences. Key adaptation measures: managed retreat from coastlines, upstream natural flood management (tree planting, leaky dams), property-level resilience, improved drainage infrastructure, enhanced early warning systems using AI/ML.`,
    source: 'UKCP18 Climate Projections',
    category: 'climate_change',
  },
  {
    title: 'Emergency Response to Flooding',
    content: `UK emergency flood response follows the Civil Contingencies Act 2004 framework. Category 1 responders (fire, police, ambulance, local authorities, Environment Agency) activate multi-agency flood plans. Key response phases: 1) Preparedness - maintain flood plans, warning systems, sandbag stocks, emergency shelters. 2) Response - activate flood warnings, deploy pumps and temporary barriers, evacuate at-risk populations, open rest centres, coordinate through Strategic/Tactical/Operational command structure (Gold/Silver/Bronze). 3) Recovery - building drying (6-12 months typical), insurance claims, mental health support, infrastructure repair. Average recovery time after major flood: 2-3 years for full community recovery. The Bellwin scheme provides government financial assistance to councils for immediate emergency costs. COBR (Cabinet Office Briefing Rooms) convenes for major national flooding events. Military assistance (MACA) can be requested through MoD for severe flooding requiring additional resources.`,
    source: 'UK Government Cabinet Office',
    category: 'emergency_response',
  },
  {
    title: 'Sustainable Drainage Systems (SuDS)',
    content: `SuDS manage surface water to reduce flood risk while providing environmental benefits. Key SuDS techniques: 1) Permeable surfaces - allow water to infiltrate directly through car parks and paths. Reduces runoff by 60-100%. 2) Green roofs - retain 40-90% of rainfall depending on depth. Reduce peak runoff by 50-90%. 3) Rain gardens and bioretention - shallow planted depressions that filter and absorb runoff. Remove 80-95% of sediment, 70-90% of metals. 4) Swales - vegetated channels that convey and treat water. Velocity reduction slows flood peak. 5) Detention basins - store water temporarily during storms. Reduce peak flow by 50-80%. 6) Constructed wetlands - treat and attenuate water. Support biodiversity. 7) Attenuation tanks - underground storage. Space-efficient for urban areas. Since 2019, major developments in England must include SuDS to limit surface water discharge to greenfield rates. The SuDS Manual (CIRIA C753) defines design standards.`,
    source: 'CIRIA SuDS Manual',
    category: 'flood_management',
  },
  {
    title: 'Flood Insurance in the UK',
    content: `The Flood Re scheme, launched in 2016, ensures affordable home insurance for properties at high flood risk. Funded by a levy on insurers (£180M/year). Properties built after 2009 are excluded (to discourage building in flood zones). Council tax band-based caps on flood element of premium: Band A-B max £210, Band C-D max £336, Band E-F max £630, Band G-H max £1260. Only available to domestic properties (not businesses). The scheme is designed to transition to risk-reflective pricing by 2039, with increasing premiums as government invests in defences. Currently covers approximately 350,000 high-risk homes. Before Flood Re, some homeowners in flood zones could not obtain insurance at any price, leading to property values dropping 20-30%. Business flood insurance remains purely commercial, with premiums of £5000-50000+ for high-risk properties.`,
    source: 'Flood Re / ABI',
    category: 'flood_insurance',
  },
  {
    title: 'River Gauge Monitoring and Interpretation',
    content: `The UK has approximately 1500 river gauging stations operated by the Environment Agency and SEPA. Most use ultrasonic or pressure transducer sensors recording every 15 minutes. Key terminology: Stage height (water level in metres above a fixed datum), Flow/Discharge (volume in cubic metres per second or cumecs), Rating curve (mathematical relationship between stage and flow, unique to each site). Warning thresholds: Typical Range (normal seasonal variation), Percentile levels (50th = median, 95th = unusually high), Flood Warning threshold (site-specific based on when flooding begins), Highest on Record (used for extreme event comparison). Rate of change is critical: rivers rising faster than 0.1m/hour in headwater catchments or 0.05m/hour in lowland rivers indicate significant flood risk. Lag time between rainfall and peak river level varies: 2-6 hours for small steep catchments, 12-48 hours for large lowland rivers. Antecedent conditions (soil moisture) determine how much rainfall runs off into rivers.`,
    source: 'Environment Agency / SEPA',
    category: 'monitoring',
  },
  {
    title: 'Natural Flood Management',
    content: `Natural Flood Management (NFM) uses natural processes to reduce flood risk. Evidence from UK pilot projects: 1) Upland woodland planting - increases rainfall interception by 25-45%, improves soil infiltration. Reduces peak flow by 5-15% at catchment scale. 2) Floodplain reconnection - removing embankments to allow natural inundation of floodplains. Stores water during peak and releases slowly. Can reduce downstream peak by 10-25%. 3) Leaky debris dams - creates temporary storage in streams. Individual dam stores 30-50 cubic metres. Networks of 50-100 dams can significantly attenuate peaks. 4) Peat restoration - blocking drainage channels restores water storage capacity. Degraded peat can hold 100-200mm less water than intact peat per hectare. 5) Beaver reintroduction - natural dam building creates wetland habitat that attenuates flood peaks. Landmark studies in Devon showed 30% peak flow reduction downstream of beaver activity. 6) Soil management - reducing compaction on agricultural land improves infiltration. Can reduce surface runoff by 50%.`,
    source: 'DEFRA Evidence Directory',
    category: 'flood_management',
  },
  {
    title: 'AEGIS AI System Architecture',
    content: `AEGIS (Adaptive Emergency Governance and Intelligence System) is a hybrid AI disaster intelligence platform built for UK flood management. Architecture: Frontend (React 18 + TypeScript + Tailwind + Leaflet mapping), Backend (Express.js + PostgreSQL with PostGIS), AI Engine (Python FastAPI with XGBoost, LightGBM, CatBoost, PyTorch). Key AI capabilities: 1) Multi-source data fusion - 10 real-time data sources fused using weighted ensemble (river gauges, rainfall, soil moisture, citizen reports, historical matching, terrain, satellite imagery, seasonal patterns, urban density). 2) NLP Pipeline - sentiment analysis, fake report detection, severity classification, category extraction using HuggingFace Transformers. 3) Flood fingerprinting - cosine similarity matching of current conditions against historical events to predict development patterns. 4) LLM chatbot with specialist agents (Crisis Responder, Trauma Support, Preparedness Coach) using Gemini/Groq with RAG retrieval. 5) Governance engine with confidence tracking, model drift detection, human-in-the-loop review, XAI explanations. 6) Real-time alerting via email, SMS, Telegram, push notifications.`,
    source: 'AEGIS Documentation',
    category: 'system',
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// §3  BUILD RAG INDEX FROM ALL SOURCES
// ═══════════════════════════════════════════════════════════════════════════════

export async function expandRAGKnowledgeBase(): Promise<{
  totalDocuments: number
  newDocuments: number
  sources: Record<string, number>
}> {
  console.log('[RAG] Expanding knowledge base...')
  const sources: Record<string, number> = {}
  let newDocs = 0

  // Ensure rag_documents table has required columns
  await pool.query(`
    ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS category VARCHAR(100);
    ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS metadata JSONB;
  `).catch(() => {})

  // Phase 1: Inject expert knowledge base
  console.log('[RAG] Phase 1: Expert knowledge base...')
  for (const doc of FLOOD_KNOWLEDGE_BASE) {
    const stored = await storeRAGDocument(doc)
    newDocs += stored
    sources[doc.category] = (sources[doc.category] || 0) + stored
  }

  // Phase 2: Import from flood_archives
  console.log('[RAG] Phase 2: Historical flood archives...')
  try {
    const { rows } = await pool.query(`
      SELECT event_name, description, region, severity, event_date, damage_gbp, affected_people
      FROM flood_archives
      WHERE description IS NOT NULL AND LENGTH(description) > 50
      LIMIT 200
    `)
    for (const row of rows) {
      const content = `${row.event_name} (${row.region}, ${row.event_date || 'date unknown'}): ${row.description}. Severity: ${row.severity}. ${row.affected_people ? `Affected: ${row.affected_people} people.` : ''} ${row.damage_gbp ? `Estimated damage: £${(row.damage_gbp / 1e6).toFixed(1)}M.` : ''}`
      const stored = await storeRAGDocument({
        title: `Historical Event: ${row.event_name}`,
        content,
        source: 'flood_archives',
        category: 'historical_events',
      })
      newDocs += stored
      sources['historical_events'] = (sources['historical_events'] || 0) + stored
    }
  } catch (err: any) {
    console.warn(`[RAG] Flood archives import failed: ${err.message}`)
  }

  // Phase 3: Import from wiki_flood_knowledge
  console.log('[RAG] Phase 3: Wikipedia flood knowledge...')
  try {
    const { rows } = await pool.query(`
      SELECT title, extract FROM wiki_flood_knowledge
      WHERE extract IS NOT NULL AND LENGTH(extract) > 100
      LIMIT 200
    `)
    for (const row of rows) {
      const stored = await storeRAGDocument({
        title: `Wikipedia: ${row.title}`,
        content: row.extract,
        source: 'wikipedia',
        category: 'encyclopedic',
      })
      newDocs += stored
      sources['encyclopedic'] = (sources['encyclopedic'] || 0) + stored
    }
  } catch (err: any) {
    console.warn(`[RAG] Wikipedia import failed: ${err.message}`)
  }

  // Phase 4: Import from news_articles
  console.log('[RAG] Phase 4: News articles...')
  try {
    const { rows } = await pool.query(`
      SELECT title, description, content, source_name, published_at
      FROM news_articles
      WHERE (content IS NOT NULL AND LENGTH(content) > 50)
         OR (description IS NOT NULL AND LENGTH(description) > 50)
      LIMIT 200
    `)
    for (const row of rows) {
      const text = row.content || row.description || ''
      const stored = await storeRAGDocument({
        title: `News: ${row.title}`,
        content: `${row.title}. ${text}. Source: ${row.source_name || 'Unknown'} (${row.published_at || 'date unknown'})`,
        source: 'news',
        category: 'news',
      })
      newDocs += stored
      sources['news'] = (sources['news'] || 0) + stored
    }
  } catch (err: any) {
    console.warn(`[RAG] News import failed: ${err.message}`)
  }

  // Phase 5: Import from existing citizen reports (top-quality ones)
  console.log('[RAG] Phase 5: High-quality citizen reports...')
  try {
    const { rows } = await pool.query(`
      SELECT title, description, severity, category, ai_confidence
      FROM reports
      WHERE deleted_at IS NULL
        AND ai_confidence > 70
        AND LENGTH(description) > 100
      ORDER BY ai_confidence DESC
      LIMIT 100
    `)
    for (const row of rows) {
      const stored = await storeRAGDocument({
        title: `Citizen Report: ${row.title}`,
        content: `${row.title}. ${row.description}. Category: ${row.category}. Severity: ${row.severity}. AI Confidence: ${row.ai_confidence}%.`,
        source: 'citizen_reports',
        category: 'citizen_intelligence',
      })
      newDocs += stored
      sources['citizen_intelligence'] = (sources['citizen_intelligence'] || 0) + stored
    }
  } catch (err: any) {
    console.warn(`[RAG] Reports import failed: ${err.message}`)
  }

  // Get total
  let total = 0
  try {
    const r = await pool.query('SELECT COUNT(*) as c FROM rag_documents')
    total = parseInt(r.rows[0].c) || 0
  } catch { /* ignore */ }

  console.log(`[RAG] Knowledge base expanded: ${newDocs} new documents added. Total: ${total}`)
  return { totalDocuments: total, newDocuments: newDocs, sources }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  RAG RETRIEVAL — Vector similarity first, full-text fallback
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retrieve relevant RAG documents.
 *
 * Strategy:
 *   1. If embedding provider is configured → generate query embedding →
 *      cosine similarity search via `search_rag_by_vector()` SQL function.
 *   2. If no embedding provider OR no embedded docs → fall back to
 *      PostgreSQL full-text search with `ts_rank_cd`.
 *   3. Last resort: ILIKE pattern matching.
 */
export async function ragRetrieve(query: string, limit = 5): Promise<Array<{
  title: string
  content: string
  source: string
  relevance: number
}>> {
  try {
    // ── Phase 1: Try vector similarity search (requires embedding provider) ──
    try {
      // Dynamic import to avoid circular deps; this may throw if no provider
      const { embedText } = await import('./embeddingRouter.js')
      const queryVector = await embedText(query)

      if (queryVector && queryVector.length > 0) {
        // Convert JS array to PG double precision array literal
        const pgArray = `{${queryVector.join(',')}}`

        const { rows } = await pool.query(`
          SELECT id, title, content, source, category,
            cosine_similarity(embedding_vector, $1::double precision[]) AS relevance
          FROM rag_documents
          WHERE embedding_vector IS NOT NULL
            AND array_length(embedding_vector, 1) = $2
          ORDER BY cosine_similarity(embedding_vector, $1::double precision[]) DESC
          LIMIT $3
        `, [pgArray, queryVector.length, limit])

        if (rows.length > 0) {
          console.log(`[RAG] Vector search returned ${rows.length} results (top similarity: ${rows[0].relevance?.toFixed(3)})`)
          return rows
        }
      }
    } catch (embErr: any) {
      // Embedding provider not configured or failed — fall through to text search
      console.warn(`[RAG] Vector search unavailable: ${embErr.message} — using full-text search`)
    }

    // ── Phase 2: Full-text search with ts_rank_cd ──
    const { rows } = await pool.query(`
      SELECT title, content, source,
        ts_rank_cd(
          to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, '')),
          plainto_tsquery('english', $1)
        ) as relevance
      FROM rag_documents
      WHERE to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''))
        @@ plainto_tsquery('english', $1)
      ORDER BY relevance DESC
      LIMIT $2
    `, [query, limit])

    if (rows.length > 0) {
      console.log(`[RAG] Full-text search returned ${rows.length} results`)
      return rows
    }

    // ── Phase 3: ILIKE pattern matching (last resort) ──
    const keywords = query.split(/\s+/).filter(w => w.length > 3).slice(0, 5)
    if (keywords.length === 0) return []

    const patterns = keywords.map((_, i) => `(title ILIKE $${i + 1} OR content ILIKE $${i + 1})`)
    const params = keywords.map(k => `%${k}%`)

    const fallback = await pool.query(`
      SELECT title, content, source, 0.3 as relevance
      FROM rag_documents
      WHERE ${patterns.join(' OR ')}
      LIMIT $${keywords.length + 1}
    `, [...params, limit])

    console.log(`[RAG] ILIKE fallback returned ${fallback.rows.length} results`)
    return fallback.rows
  } catch (err: any) {
    console.error(`[RAG] Retrieval error: ${err.message}`)
    return []
  }
}
