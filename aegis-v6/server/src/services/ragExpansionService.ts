/**
 * File: ragExpansionService.ts
 *
 * RAG knowledge base manager — chunks documents semantically (paragraph/header
 * boundaries with overlap), stores them with embeddings in rag_documents, and
 * retrieves relevant context using BM25 scoring, query expansion via disaster
 * synonyms, and result re-ranking.
 *
 * How it connects:
 * - Stores/retrieves from the rag_documents PostgreSQL table
 * - Uses embeddingRouter for vector embeddings (dynamic import)
 * - Consumed by chatService for context retrieval before LLM calls
 *
 * Simple explanation:
 * Manages the knowledge base the chatbot searches through to answer questions.
 */

import pool from '../models/db.js'
import { logger } from './logger.js'

// -1  RAG DOCUMENT STORE MANAGEMENT

interface RAGDocument {
  title: string
  content: string
  source: string
  category: string
  metadata?: Record<string, any>
}

const CHUNK_SIZE = 500 // tokens (roughly words)
const CHUNK_OVERLAP = 50

/**
 * Split text into semantically-aware chunks for RAG retrieval.
 * Priority: split on double newlines (paragraphs) > headers > sentence boundaries > word boundaries.
 * Falls back to fixed-size word splitting only for very large paragraphs.
 */
function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  // First pass: split on semantic boundaries (double newline = paragraph, markdown headers)
  const semanticSplitPattern = /\n\n+|(?=^#{1,4}\s)/gm
  const sections = text.split(semanticSplitPattern).map(s => s.trim()).filter(s => s.length > 0)

  // If only one section and it's small enough, return as-is
  if (sections.length <= 1 && text.split(/\s+/).length <= chunkSize) {
    return [text]
  }

  const chunks: string[] = []
  let currentChunk: string[] = []
  let currentWordCount = 0

  for (const section of sections) {
    const sectionWords = section.split(/\s+/).length

    // If a single section exceeds chunk size, split it on sentence boundaries
    if (sectionWords > chunkSize) {
      // Flush current chunk first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'))
        // Keep last part for overlap
        const overlapText = currentChunk[currentChunk.length - 1]
        const overlapWords = overlapText.split(/\s+/).length
        if (overlapWords <= overlap * 2) {
          currentChunk = [overlapText]
          currentWordCount = overlapWords
        } else {
          currentChunk = []
          currentWordCount = 0
        }
      }

      // Split large section on sentence boundaries
      const sentences = section.match(/[^.!?]+[.!?]+\s*/g) || [section]
      let sentenceChunk: string[] = []
      let sentenceWordCount = 0

      for (const sentence of sentences) {
        const sentWords = sentence.split(/\s+/).length
        if (sentenceWordCount + sentWords > chunkSize && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.join(' '))
          // Overlap: keep last sentence
          const lastSent = sentenceChunk[sentenceChunk.length - 1]
          sentenceChunk = [lastSent]
          sentenceWordCount = lastSent.split(/\s+/).length
        }
        sentenceChunk.push(sentence.trim())
        sentenceWordCount += sentWords
      }
      if (sentenceChunk.length > 0) {
        chunks.push(sentenceChunk.join(' '))
      }
      continue
    }

    // Accumulate sections into chunks
    if (currentWordCount + sectionWords > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'))
      // Overlap: keep last section
      const lastSection = currentChunk[currentChunk.length - 1]
      const lastWords = lastSection.split(/\s+/).length
      if (lastWords <= overlap * 2) {
        currentChunk = [lastSection]
        currentWordCount = lastWords
      } else {
        currentChunk = []
        currentWordCount = 0
      }
    }

    currentChunk.push(section)
    currentWordCount += sectionWords
  }

  // Flush remaining
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'))
  }

  return chunks.length > 0 ? chunks : [text]
}

/* Store a document (chunked) in the RAG table */
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

// -2  KNOWLEDGE BASE: FLOOD MANAGEMENT EXPERTISE

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
    content: `Climate projections (UKCP18) indicate significant increases in UK flood risk: Temperature rise of 1.5-4.5-C by 2100 depending on emissions pathway. Winter rainfall expected to increase 10-30% by 2080s. Summer rainfall may decrease but become more intense (more flash floods). Sea level rise of 0.3-1.1m by 2100 along UK coastline. The Committee on Climate Change estimates that without adaptation: properties at significant flood risk will increase from 1.8 million to 2.6 million by 2050. Current flood defences protect to approx 1 in 100 year standard. Climate change means a "1 in 100 year" flood today may become a "1 in 30 year" event by 2080. The Environment Agency estimates -1 billion annual investment needed in flood defences. Key adaptation measures: managed retreat from coastlines, upstream natural flood management (tree planting, leaky dams), property-level resilience, improved drainage infrastructure, enhanced early warning systems using AI/ML.`,
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
    content: `The Flood Re scheme, launched in 2016, ensures affordable home insurance for properties at high flood risk. Funded by a levy on insurers (-180M/year). Properties built after 2009 are excluded (to discourage building in flood zones). Council tax band-based caps on flood element of premium: Band A-B max -210, Band C-D max -336, Band E-F max -630, Band G-H max -1260. Only available to domestic properties (not businesses). The scheme is designed to transition to risk-reflective pricing by 2039, with increasing premiums as government invests in defences. Currently covers approximately 350,000 high-risk homes. Before Flood Re, some homeowners in flood zones could not obtain insurance at any price, leading to property values dropping 20-30%. Business flood insurance remains purely commercial, with premiums of -5000-50000+ for high-risk properties.`,
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

// -2b  GLOBAL KNOWLEDGE BASE: UNIVERSAL DISASTER MANAGEMENT

const GLOBAL_KNOWLEDGE_BASE: RAGDocument[] = [
  {
    title: 'Global Flood Risk Assessment Frameworks',
    content: `Flood risk assessment varies worldwide but follows common scientific principles. The UNDRR Sendai Framework (2015-2030) provides the global standard for disaster risk reduction, adopted by 187 countries. Key assessment components: hazard mapping (identifying flood-prone areas using topography, hydrology, and historical data), vulnerability assessment (population density, infrastructure quality, poverty levels), exposure analysis (assets at risk), and capacity evaluation (early warning systems, drainage infrastructure, emergency response capability). GloFAS (Global Flood Awareness System) by Copernicus provides 30-day probabilistic flood forecasts worldwide using ECMWF weather data and LISFLOOD hydrological modelling. The World Meteorological Organization (WMO) coordinates national meteorological services across 193 member states. Regional frameworks include: FEMA risk assessments (US), EU Floods Directive (Europe), Central Water Commission guidelines (India), Bureau of Meteorology frameworks (Australia), and JICA disaster management (Japan).`,
    source: 'UNDRR / WMO / Copernicus',
    category: 'global_flood_policy',
  },
  {
    title: 'Types of Flooding Worldwide',
    content: `Flooding types vary by geography and climate zone. 1) Fluvial/River flooding - affects all continents. Major flood-prone rivers: Ganges-Brahmaputra (Bangladesh/India), Yangtze/Yellow (China), Mississippi (US), Rhine/Danube (Europe), Nile (Africa), Amazon (South America). Monsoon-driven flooding in South/Southeast Asia affects 250+ million annually. 2) Coastal/Storm surge - highest risk in Bay of Bengal (Bangladesh, Myanmar, India), Gulf of Mexico (US), South Pacific islands, and low-lying deltas worldwide. Climate change-driven sea level rise of 0.3-1.1m by 2100 threatens 300+ million people. 3) Flash flooding - common in arid regions (Middle East, North Africa, US Southwest) where sudden storms overwhelm dry wadi/arroyo systems. Increasing in mountainous regions globally. 4) Urban/Pluvial flooding - growing rapidly worldwide as urbanization outpaces drainage infrastructure. Affects megacities across all continents. 5) Glacial lake outburst floods (GLOFs) - Himalayas, Andes, Alps. Climate change increasing frequency as glaciers retreat. 6) Tsunami flooding - Pacific Ring of Fire (Japan, Chile, Indonesia, West Americas), Indian Ocean. Early warning via PTWC and regional centers.`,
    source: 'UNDRR / WMO',
    category: 'global_flood_types',
  },
  {
    title: 'Global Flood Warning and Data Systems',
    content: `Real-time global flood monitoring uses multiple satellite and ground-based systems. GDACS (Global Disaster Alerts and Coordination System) - UN-backed system providing near-real-time alerts for earthquakes, floods, cyclones, and volcanic eruptions worldwide. GloFAS (Global Flood Awareness System) - Copernicus/ECMWF 30-day probabilistic flood forecasts for all major global rivers. USGS Earthquake Hazards - real-time global earthquake monitoring, ShakeMap, and aftershock forecasts. NASA FIRMS (Fire Information for Resource Management System) - near-real-time active fire detection worldwide using MODIS and VIIRS satellite data. Open-Meteo - free weather and flood API providing global forecasts without API key, including river discharge estimates. OpenWeatherMap - global weather data with alerts. National systems include: NWS (US), Met Office (UK), JMA (Japan), BoM (Australia), IMD (India), DWD (Germany), M-t-o-France, ECCC (Canada). All coordinate through WMO Global Producing Centres. The International Charter on Space and Major Disasters provides free satellite imagery to disaster-affected countries.`,
    source: 'GDACS / GloFAS / USGS / NASA',
    category: 'global_warning_systems',
  },
  {
    title: 'Earthquake Preparedness and Response Worldwide',
    content: `Earthquakes affect all tectonic plate boundaries globally. Most seismically active zones: Pacific Ring of Fire (70% of earthquakes - Japan, Philippines, Indonesia, Chile, US West Coast, New Zealand), Alpine-Himalayan Belt (Turkey, Iran, Nepal, Afghanistan, Italy, Greece), East African Rift. Universal safety: Drop, Cover, Hold On (endorsed by all major agencies). Building codes vary enormously: Japan and New Zealand lead with base isolation and seismic design standards (IBC, Eurocode 8). Many developing nations lack enforced codes - same magnitude earthquake kills 10x more people. USGS monitors 20,000+ earthquakes annually via global seismograph network. Tsunami risk from undersea earthquakes >7.0: monitored by Pacific Tsunami Warning Center (PTWC) and Indian Ocean Tsunami Warning System (IOTWS), established after 2004 Boxing Day tsunami (230,000+ deaths, 14 countries). Key indicators: strong shaking near coast, unusual ocean withdrawal, official warnings via sirens, TV, mobile alerts.`,
    source: 'USGS / PTWC / UNDRR',
    category: 'earthquake',
  },
  {
    title: 'Wildfire Risk and Response Globally',
    content: `Wildfires are increasing worldwide due to climate change, affecting every inhabited continent. Fire seasons: Northern Hemisphere (June-October), Southern Hemisphere (December-March), tropical dry seasons vary. Highest-risk regions: Western US/Canada, Australia, Mediterranean (Greece, Turkey, Spain, Portugal), Amazon/Cerrado (Brazil), Siberia (Russia), Sub-Saharan Africa. NASA FIRMS detects 400,000+ active fires annually using MODIS/VIIRS satellite data with 4-hour update cycle. Wildfire preparedness: defensible space (30m clearance around structures), ember-resistant construction, evacuation planning, air quality awareness (PM2.5 monitoring via OpenAQ). Fire weather indices: FFDI (Australia), FWI (Canada, EU), NFDRS (US). Smoke health impacts extend hundreds of kilometres from fire - vulnerable populations (elderly, children, respiratory conditions) should monitor AQI and stay indoors when poor. Recovery considerations vary by ecosystem: Mediterranean scrub regenerates differently from boreal forest.`,
    source: 'NASA FIRMS / UNDRR',
    category: 'wildfire',
  },
  {
    title: 'Tropical Cyclone and Hurricane Safety',
    content: `Tropical cyclones (hurricanes, typhoons) affect tropical and subtropical regions worldwide. Basins: Atlantic/East Pacific (hurricanes - US, Caribbean, Mexico, Central America), Western Pacific (typhoons - Philippines, Japan, China, Vietnam, Taiwan), Indian Ocean (cyclones - India, Bangladesh, Myanmar, East Africa, Australia), South Pacific (cyclones - Australia, Fiji, Vanuatu, Tonga). Classification: Saffir-Simpson (Atlantic/East Pacific, Cat 1-5), JMA (Western Pacific), Australian Bureau of Meteorology, IMD (Indian Ocean). Universal safety: evacuate from storm surge zones, shelter in interior rooms away from windows, stockpile 7-day supplies. Storm surge causes 90% of cyclone deaths. Forecast centres: NHC (US), JTWC (US military/global), JMA (Western Pacific), RSMC New Delhi (Indian Ocean), BoM (Australia). Warning times: 3-5 days typical. Critical actions: secure property, fill vehicles with fuel, charge devices, identify nearest shelter, know evacuation routes.`,
    source: 'WMO / NHC / JMA',
    category: 'cyclone',
  },
  {
    title: 'Climate Change and Global Disaster Risk',
    content: `IPCC AR6 (2021-2023) confirms climate change is intensifying extreme weather events worldwide. Key projections: Global average temperature rise of 1.5-4.5-C by 2100. Sea level rise of 0.28-1.01m by 2100, threatening 300+ million coastal residents. Extreme rainfall events increasing in intensity and frequency across most regions. Heatwaves becoming 2.8x more frequent at 1.5-C warming, 5.6x at 2-C. Tropical cyclone intensity increasing (more Category 4-5 storms), though total number may decrease. Wildfire weather conditions increasing in Mediterranean, western Americas, Australia, and Siberia. Drought risk increasing in already-dry regions (Middle East, North Africa, Southern Africa, Central Asia). Glacial retreat accelerating in Himalayas, Andes, Alps - threatening water supply for 2+ billion people. Permafrost thaw in Arctic creating landslide and infrastructure risks. Adaptation priorities: early warning systems, climate-resilient infrastructure, nature-based solutions, community preparedness, and equitable resource allocation. The Sendai Framework target: substantially reduce disaster mortality and economic losses by 2030.`,
    source: 'IPCC AR6 / UNDRR Sendai Framework',
    category: 'climate_change_global',
  },
  {
    title: 'AEGIS Global Capabilities',
    content: `AEGIS (Adaptive Emergency Governance and Intelligence System) is designed as a globally deployable disaster intelligence platform. Architecture supports any geographic location through its modular region adapter system. The GenericAdapter uses globally available data sources (Open-Meteo weather and flood APIs, OpenWeatherMap, NASA POWER) that require no regional authority integration and work for any latitude/longitude on Earth. The system covers all major hazard types: floods, earthquakes, fires, storms, tsunamis, volcanic eruptions, landslides, heatwaves, drought, power outages, infrastructure damage, and environmental hazards. The LLM chatbot provides guidance in multiple languages, with emergency numbers and crisis resources dynamically configured per region. The AI engine uses universal disaster science - Drop Cover Hold On for earthquakes, fire triangle for wildfires, Saffir-Simpson for cyclones - applicable worldwide regardless of local agency or institutional framework. Real-time data fusion combines weather forecasts, citizen reports, historical matching, and terrain analysis for any location globally.`,
    source: 'AEGIS Documentation',
    category: 'system_global',
  },
]

// -3  BUILD RAG INDEX FROM ALL SOURCES

export async function expandRAGKnowledgeBase(): Promise<{
  totalDocuments: number
  newDocuments: number
  sources: Record<string, number>
}> {
  logger.info('[RAG] Expanding knowledge base...')
  const sources: Record<string, number> = {}
  let newDocs = 0

  // Ensure rag_documents table has required columns
  await pool.query(`
    ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS category VARCHAR(100);
    ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS metadata JSONB;
  `).catch(() => {})

  // Phase 1: Inject expert knowledge base
  logger.info('[RAG] Phase 1: Expert knowledge base...')
  for (const doc of FLOOD_KNOWLEDGE_BASE) {
    const stored = await storeRAGDocument(doc)
    newDocs += stored
    sources[doc.category] = (sources[doc.category] || 0) + stored
  }

  // Phase 1b: Inject global knowledge base (universal disaster science)
  logger.info('[RAG] Phase 1b: Global knowledge base...')
  for (const doc of GLOBAL_KNOWLEDGE_BASE) {
    const stored = await storeRAGDocument(doc)
    newDocs += stored
    sources[doc.category] = (sources[doc.category] || 0) + stored
  }

  // Phase 2: Import from flood_archives
  logger.info('[RAG] Phase 2: Historical flood archives...')
  try {
    const { rows } = await pool.query(`
      SELECT event_name, description, region, severity, event_date, damage_gbp, affected_people
      FROM flood_archives
      WHERE description IS NOT NULL AND LENGTH(description) > 50
      LIMIT 200
    `)
    for (const row of rows) {
      const content = `${row.event_name} (${row.region}, ${row.event_date || 'date unknown'}): ${row.description}. Severity: ${row.severity}. ${row.affected_people ? `Affected: ${row.affected_people} people.` : ''} ${row.damage_gbp ? `Estimated damage: -${(row.damage_gbp / 1e6).toFixed(1)}M.` : ''}`
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
    logger.warn({ err }, '[RAG] Flood archives import failed')
  }

  // Phase 3: Import from wiki_flood_knowledge
  logger.info('[RAG] Phase 3: Wikipedia flood knowledge...')
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
    logger.warn({ err }, '[RAG] Wikipedia import failed')
  }

  // Phase 4: Import from news_articles
  logger.info('[RAG] Phase 4: News articles...')
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
    logger.warn({ err }, '[RAG] News import failed')
  }

  // Phase 5: Import from existing citizen reports (top-quality ones)
  logger.info('[RAG] Phase 5: High-quality citizen reports...')
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
    logger.warn({ err }, '[RAG] Reports import failed')
  }

  // Get total
  let total = 0
  try {
    const r = await pool.query('SELECT COUNT(*) as c FROM rag_documents')
    total = parseInt(r.rows[0].c) || 0
  } catch { /* ignore */ }

  logger.info({ newDocs, total }, '[RAG] Knowledge base expanded')
  return { totalDocuments: total, newDocuments: newDocs, sources }
}

// -4  RAG RETRIEVAL - Vector similarity first, full-text fallback

 /*
 * Retrieve relevant RAG documents.
 * Strategy:
 *   1. If embedding provider is configured ? generate query embedding ?
 *      cosine similarity search via `search_rag_by_vector()` SQL function.
 *   2. If no embedding provider OR no embedded docs ? fall back to
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
    //  Phase 1: Try vector similarity search (requires embedding provider)
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
          logger.info({ count: rows.length, topSimilarity: rows[0].relevance?.toFixed(3) }, '[RAG] Vector search results')
          return rows
        }
      }
    } catch (embErr: any) {
      // Embedding provider not configured or failed - fall through to text search
      logger.warn({ err: embErr }, '[RAG] Vector search unavailable - using full-text search')
    }

    //  Phase 2: Full-text search with ts_rank_cd
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
      logger.info({ count: rows.length }, '[RAG] Full-text search results')
      return rows
    }

    //  Phase 3: ILIKE pattern matching (last resort)
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

    logger.info({ count: fallback.rows.length }, '[RAG] ILIKE fallback results')
    return fallback.rows
  } catch (err: any) {
    logger.error({ err }, '[RAG] Retrieval error')
    return []
  }
}

// -5  QUERY EXPANSION WITH DISASTER SYNONYM DICTIONARY

export const DISASTER_SYNONYMS: Record<string, string[]> = {
  flood: ['flooding', 'inundation', 'water level', 'river overflow', 'flash flood', 'deluge', 'submerge'],
  fire: ['wildfire', 'blaze', 'inferno', 'conflagration', 'bushfire', 'fire outbreak'],
  storm: ['severe storm', 'tempest', 'hurricane', 'cyclone', 'typhoon', 'gale', 'thunderstorm'],
  earthquake: ['seismic event', 'tremor', 'quake', 'aftershock', 'ground shaking'],
  shelter: ['evacuation center', 'refuge', 'safe haven', 'emergency accommodation', 'rest center'],
  evacuation: ['evacuate', 'flee', 'escape route', 'leave area', 'safe passage', 'exodus'],
  drought: ['water shortage', 'dry spell', 'arid conditions', 'water scarcity', 'desertification'],
  heatwave: ['extreme heat', 'heat emergency', 'scorching', 'thermal stress', 'heat dome'],
  landslide: ['mudslide', 'debris flow', 'slope failure', 'earth movement', 'rockfall'],
  power: ['power outage', 'blackout', 'electricity failure', 'grid failure', 'loss of power'],
  rescue: ['search and rescue', 'lifesaving', 'extraction', 'recovery operation'],
  medical: ['health emergency', 'first aid', 'triage', 'ambulance', 'hospital', 'injury'],
  warning: ['alert', 'advisory', 'watch', 'danger notice', 'caution'],
  infrastructure: ['road closure', 'bridge collapse', 'structural damage', 'utility failure'],
}

/**
 * Expand a user query by appending top-3 synonyms for every word that
 * matches a key in DISASTER_SYNONYMS. Duplicate terms are removed.
 */
export function expandQuery(query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const expanded = new Set<string>(words)

  for (const word of words) {
    const synonyms = DISASTER_SYNONYMS[word]
    if (synonyms) {
      for (const syn of synonyms.slice(0, 3)) {
        expanded.add(syn)
      }
    }
  }

  return Array.from(expanded).join(' ')
}

// -6  BM25 SCORING

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'about', 'up', 'it', 'its', 'this', 'that',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
}

/**
 * Compute a BM25 relevance score for a single document against a query.
 *
 * Because we score documents individually (no corpus-wide IDF), the IDF
 * component is approximated as log(2) per query term present in the document.
 */
export function computeBM25Score(
  query: string,
  document: string,
  avgDocLength: number,
  k1 = 1.5,
  b = 0.75,
): number {
  const queryTokens = tokenize(query)
  const docTokens = tokenize(document)
  const docLen = docTokens.length

  if (docLen === 0 || queryTokens.length === 0) return 0

  // Build term-frequency map for document
  const tf: Record<string, number> = {}
  for (const t of docTokens) {
    tf[t] = (tf[t] || 0) + 1
  }

  const idf = Math.log(2) // approximate IDF without corpus stats

  let score = 0
  const seen = new Set<string>()

  for (const term of queryTokens) {
    if (seen.has(term)) continue
    seen.add(term)

    const termFreq = tf[term] || 0
    if (termFreq === 0) continue

    const numerator = termFreq * (k1 + 1)
    const denominator = termFreq + k1 * (1 - b + b * (docLen / avgDocLength))
    score += idf * (numerator / denominator)
  }

  return score
}

// -7  CONTEXTUAL RE-RANKING

const SOURCE_AUTHORITY: Record<string, number> = {
  expert_knowledge: 1.0,
  historical_event: 0.8,
  news_article: 0.6,
  citizen_report: 0.4,
}

/**
 * Re-rank RAG retrieval results using keyword overlap, source authority,
 * title relevance, and length penalty heuristics.
 */
export function rerankResults(
  query: string,
  results: Array<{ title: string; content: string; source: string; relevance: number }>,
): typeof results {
  const queryWords = new Set(tokenize(query))

  const scored = results.map(r => {
    // 1. Keyword overlap (0-0.4)
    const contentTokens = tokenize(r.content)
    const matchCount = contentTokens.filter(t => queryWords.has(t)).length
    const keywordScore = Math.min(0.4, (matchCount / Math.max(queryWords.size, 1)) * 0.4)

    // 2. Source authority (0-0.3)
    const srcKey = r.source.toLowerCase().replace(/[\s-]/g, '_')
    const authorityRaw = SOURCE_AUTHORITY[srcKey] ?? 0.5
    const authorityScore = authorityRaw * 0.3

    // 3. Title relevance bonus (0-0.2)
    const titleTokens = tokenize(r.title)
    const titleMatches = titleTokens.filter(t => queryWords.has(t)).length
    const titleScore = Math.min(0.2, (titleMatches / Math.max(queryWords.size, 1)) * 0.2)

    // 4. Length penalty (0-0.1) - very short or very long content penalised
    const len = r.content.length
    let lengthScore = 0.1
    if (len < 50) lengthScore = 0.02
    else if (len > 5000) lengthScore = 0.04

    const combined = keywordScore + authorityScore + titleScore + lengthScore

    return { ...r, relevance: combined }
  })

  scored.sort((a, b) => b.relevance - a.relevance)
  return scored
}

// -8  MULTI-HAZARD EXPERT KNOWLEDGE BASE

const MULTI_HAZARD_KNOWLEDGE_BASE: RAGDocument[] = [
  {
    title: 'Wildfire Safety and Prevention',
    content: `Wildfires pose an increasing threat to communities worldwide, accelerated by climate change, prolonged droughts, and changes in land use. Fire behaviour is governed by the fire triangle: heat, fuel, and oxygen. Topography plays a critical role - fires advance fastest uphill due to pre-heating of fuel above the flame front, with slope doubling the rate of spread for every 10 degrees of incline. Wind speed and direction are the most dangerous variables; erratic winds can cause spot fires kilometres ahead of the main front. Firefighting strategy distinguishes between direct attack (suppression at the fire edge using water, retardant, and hand tools) and indirect attack (creating firebreaks and backburning ahead of the fire). Defensible space around structures is vital: Zone 1 (0-10m) should be cleared of all combustible vegetation and debris; Zone 2 (10-30m) should have thinned, low-growing, fire-resistant planting; Zone 3 (30-60m) should remove dead material and reduce canopy density. Ember attack is the primary ignition mechanism for structures - fine mesh screens on vents, sealed eaves, and non-combustible roofing are essential. Community Wildfire Protection Plans (CWPPs) coordinate evacuation routes, trigger points for evacuation orders, and shelter-in-place criteria. Air quality during wildfires can reach hazardous levels (AQI > 300) requiring N95/P2 masks and sealed indoor environments. Smoke inhalation is the leading cause of wildfire fatalities, not direct burns.`,
    source: 'expert_knowledge',
    category: 'wildfire',
  },
  {
    title: 'Heatwave Health Risks and Emergency Response',
    content: `Heatwaves are the deadliest natural hazard in many countries, with mortality rising sharply when temperatures exceed locally adapted thresholds. The UK activates Heat-Health Alerts at Level 2 (alert, daytime =30-C / night =15-C) through Level 4 (national emergency). Physiologically, the body manages heat through vasodilation and sweating, but these mechanisms fail in the elderly, very young, those on certain medications (diuretics, beta-blockers, anticholinergics), and during sustained high humidity (wet-bulb temperature =35-C is near-fatal for all). Heat exhaustion presents as heavy sweating, weakness, nausea, and headache; progression to heat stroke (core temperature =40-C, confusion, loss of consciousness) is a medical emergency with 10-50% mortality if untreated. Urban heat island effects raise city temperatures 2-8-C above surrounding rural areas due to absorbed solar radiation in concrete and asphalt, waste heat from buildings and vehicles, and reduced evapotranspiration. Emergency response centres should open cool rooms with air conditioning in public buildings, deploy outreach workers to check on vulnerable individuals, ensure water distribution at public locations, adjust public transport schedules, and issue guidance on recognising heat illness. Infrastructure impacts include rail buckling above 27-C on older track, road surface melting above 40-C, and transformer failures that can cascade into power outages during peak air conditioning demand. Long-term adaptation requires green infrastructure, reflective surfaces, improved building insulation standards, and heat action plans embedded in local emergency planning.`,
    source: 'expert_knowledge',
    category: 'heatwave',
  },
  {
    title: 'Severe Storm Preparedness and Safety',
    content: `Severe storms encompass thunderstorms, tornadoes, derechos, and tropical cyclones, each presenting distinct hazards. Thunderstorm severity is classified by the presence of large hail (=2.5cm), damaging winds (=90km/h), or tornadoes. Supercell thunderstorms, characterised by a persistent rotating updraft (mesocyclone), produce the most violent tornadoes (EF3-EF5). Lightning kills approximately 2,000 people globally per year; the 30/30 rule recommends seeking shelter when the flash-to-bang interval drops below 30 seconds and remaining sheltered for 30 minutes after the last thunder. Wind damage follows an exponential curve - a 200km/h wind exerts four times the force of a 100km/h wind. Preparedness measures include reinforcing roof connections with hurricane straps, installing impact-resistant glazing or storm shutters, trimming overhanging trees, securing outdoor objects, and maintaining emergency supplies for 72 hours minimum. Flood risk during storms is amplified by storm surge in coastal areas (the leading cause of hurricane fatalities), intense rainfall overwhelming drainage, and debris blocking watercourses. Storm tracking relies on Doppler radar (detecting rotation and precipitation intensity), satellite imagery (cloud top temperatures indicate convective strength), weather balloon soundings (atmospheric profile and instability indices), and surface observation networks. Emergency communication during storms should use multiple channels: sirens, wireless emergency alerts (WEA/Cell Broadcast), social media, local radio, and door-to-door warning in high-risk zones. Post-storm hazards include downed power lines, weakened structures, contaminated flood water, and carbon monoxide from generator use indoors.`,
    source: 'expert_knowledge',
    category: 'severe_storm',
  },
  {
    title: 'Landslide Warning Signs and Risk Reduction',
    content: `Landslides - the downslope movement of rock, debris, or earth - are triggered by rainfall saturation, earthquakes, volcanic activity, erosion, or human modifications to slopes. The UK experiences approximately 30-50 significant landslides per year, concentrated in upland Scotland, Wales, and South West England. Key warning signs observable by citizens include: new cracks or bulges appearing in the ground, walls, or pavements; tilting trees, fence posts, or utility poles; sudden changes in water flow - springs appearing in new locations, streams becoming turbid, or surface water flows altering direction; doors and windows sticking in frames (indicating ground movement); unusual sounds such as rumbling or cracking from hillsides. The Factor of Safety (FoS) quantifies slope stability: FoS = resisting forces / driving forces. Values below 1.0 indicate failure. Rainfall antecedent conditions are critical - prolonged wet periods raise the water table and increase pore water pressure, reducing the effective shear strength of soil. Intensity-duration thresholds define when rainfall is likely to trigger movement; for UK conditions, landslides typically activate at >60mm/24h on susceptible slopes. Mitigation engineering includes: retaining walls, soil nailing, drainage (horizontal drains, French drains, deep wells), slope regrading, rock bolting, catch fences and debris barriers, and bioengineering (deep-rooted vegetation). Land use planning should avoid development on slopes >25 degrees, ancient landslide deposits (identified in BGS mapping), and zones of active coastal or river erosion. Community-based monitoring networks using tilt sensors, rain gauges, and regular visual inspection can provide effective early warning at low cost.`,
    source: 'expert_knowledge',
    category: 'landslide',
  },
  {
    title: 'Power Outage Emergency Response and Grid Resilience',
    content: `Power outages disrupt modern life comprehensively, affecting heating/cooling, medical equipment, communications, water supply (pumping stations), wastewater treatment, traffic management, and food safety. Outage causes include severe weather (the leading cause, responsible for 70% of major outages), equipment failure, vegetation contact, cyber attack, and demand overload. The UK grid operates at 50Hz; frequency drops below 49.5Hz trigger automatic load shedding to prevent total system collapse (cascading blackout). Response phases: immediate (0-4 hours) - assess scope, deploy mobile generators to critical infrastructure (hospitals, care homes, water treatment), activate emergency communications; short-term (4-72 hours) - coordinate welfare checks on vulnerable customers (Priority Services Register), open warm/cool spaces, distribute information on food safety (refrigerated food unsafe after 4 hours, frozen after 48 hours); restoration - network operators follow a priority reconnection sequence: generation stations, hospitals, water infrastructure, telecommunications, then residential areas. Household preparedness should include: battery or hand-crank radio, torch with spare batteries, power bank for mobile devices, non-perishable food supplies, bottled water, warm clothing and blankets, first aid kit, and knowledge of how to manually override electric garage doors and gas central heating. Generator safety is critical: portable generators must never operate indoors or in enclosed spaces due to carbon monoxide risk. Distributed energy resources (solar panels with battery storage, community microgrids) are increasingly important for resilience, but grid-tied solar systems without battery backup will not function during outages due to anti-islanding protection.`,
    source: 'expert_knowledge',
    category: 'power_outage',
  },
  {
    title: 'Water Supply Disruption and Emergency Water Distribution',
    content: `Water supply disruptions range from localised pipe bursts to regional contamination events and drought-driven restrictions. The UK water sector serves 56 million people through 340,000km of mains; ageing Victorian infrastructure results in approximately 3 billion litres lost daily through leakage. Contamination events may involve: microbial ingress (Cryptosporidium, E. coli, coliforms) following main breaks or treatment failures; chemical contamination from industrial spills entering source water; and backflow/cross-connection incidents. Boil-water notices require bringing water to a rolling boil for at least one minute (three minutes above 2000m elevation). Do-not-use notices indicate contamination that boiling cannot address (chemical, heavy metals). Emergency water distribution follows the Security and Emergency Measures Directive (SEMD): water companies must provide a minimum of 10 litres per person per day within 24 hours of supply loss, rising to 20 litres within 48 hours. Distribution methods include bowser tankers positioned at community collection points, bottled water distribution through supermarket partnerships, and mobile treatment units deployed to alternative source water. Vulnerable customers (those on medical dialysis, oxygen concentrators, or with mobility issues) require prioritised direct delivery. Water quality monitoring uses continuous online sensors (turbidity, chlorine residual, pH) supplemented by laboratory analysis for specific contaminants. Event detection algorithms (such as the CANARY system) analyse sensor data patterns to detect contamination events in near-real-time. Long-term supply resilience depends on interconnection between supply zones, sufficient treated water storage (target: 24 hours demand), drought management plans, and demand-side measures including metering, leak detection, and water efficiency retrofits.`,
    source: 'expert_knowledge',
    category: 'water_supply',
  },
  {
    title: 'Infrastructure Damage Assessment and Recovery',
    content: `Post-disaster infrastructure damage assessment follows a systematic triage process to prioritise repair and ensure public safety. The three-phase assessment protocol: Phase 1 (Rapid Visual Screening, 0-24 hours) - exterior-only inspection of structures categorised as Inspected/Green (apparently safe), Restricted Use/Yellow (potential hazard, limited entry), or Unsafe/Red (imminent collapse risk). Phase 2 (Detailed Engineering Assessment, 1-14 days) - interior inspection by structural engineers using ATC-20/EMS-98 classifications, load path analysis, and measurement of deformations. Phase 3 (Comprehensive Evaluation, weeks-months) - full structural analysis, materials testing, and repair specification. Transportation infrastructure prioritisation follows: life-safety routes first (hospital access, evacuation corridors), then critical supply chains (fuel, food distribution), followed by economic recovery routes. Bridge inspection after events checks for scour (the leading cause of bridge failure in floods - undermining of foundations by water flow), bearing displacement, deck shifting, abutment cracking, and approach road washout. Underground utilities (gas, water, telecommunications, electricity) require coordinated assessment as damage to one system often affects adjacent infrastructure in shared corridors. The cost-benefit analysis of repair versus replacement uses a threshold of approximately 50% replacement cost - if repairs exceed this, full replacement is generally more economical and delivers modern resilience standards. Community recovery timelines depend heavily on pre-existing mutual aid agreements, pre-positioned materials contracts, and trained damage assessment volunteer networks (such as the UK Reserves of structural engineers maintained by the Institution of Structural Engineers).`,
    source: 'expert_knowledge',
    category: 'infrastructure_damage',
  },
  {
    title: 'Environmental Hazards: Chemical and Industrial',
    content: `Environmental hazards from chemical spills, industrial accidents, and contamination events require specialised response protocols distinct from natural disasters. The UK Control of Major Accident Hazards (COMAH) regulations identify approximately 900 upper-tier and 500 lower-tier sites holding dangerous substances. Emergency planning zones are defined around these sites with pre-determined public protection actions. Chemical incident classification uses the CHEMDATA system: hazard identification (UN number, substance name, physical properties), exposure assessment (wind direction and speed determine plume dispersion - the Gaussian plume model predicts concentration downwind), and health risk evaluation (acute exposure guideline levels: AEGL-1 notable discomfort, AEGL-2 irreversible health effects, AEGL-3 life-threatening). Public protective actions include: shelter-in-place (close windows, doors, vents; turn off HVAC; seal gaps with wet towels; stay upstairs for heavier-than-air gases), evacuation (perpendicular to wind direction, upwind assembly points), and decontamination (remove clothing, wash with copious water, no scrubbing). Air quality monitoring during incidents uses portable gas detectors (photoionisation detectors for VOCs, electrochemical cells for specific gases), Draeger tubes for rapid qualitative assessment, and deployed air monitoring stations for sustained events. Water contamination from environmental incidents requires source control (booming, absorbent deployment, shut-off valves), monitoring downstream of the spill, and notification to water abstractors. The Environmental Damage Regulations 2009 place strict liability on operators for damage to protected species, habitats, water resources, and land. Long-term health surveillance of exposed populations may be required depending on the substances involved, including cancer registries and respiratory function monitoring.`,
    source: 'expert_knowledge',
    category: 'environmental_hazard',
  },
  {
    title: 'Drought Management and Water Conservation',
    content: `Drought develops slowly - a "creeping disaster" that may take months to recognise and years to recover from. The UK Drought Plan framework requires water companies to produce statutory drought plans reviewed every five years, detailing demand-side and supply-side actions at escalating trigger levels. Drought severity is assessed using the Standardised Precipitation Index (SPI), which compares observed rainfall against historical distribution: SPI -1.0 to -1.49 indicates moderate drought, -1.5 to -1.99 severe drought, and below -2.0 extreme drought. Groundwater drought monitoring tracks borehole levels against percentile ranges - the British Geological Survey publishes monthly groundwater situation reports. Water company drought triggers typically follow four levels: Level 1 (enhanced monitoring and voluntary restraint messaging), Level 2 (Temporary Use Bans - hosepipe bans), Level 3 (Drought Permits to increase abstraction or reduce compensation flows), and Level 4 (Drought Orders imposing statutory use restrictions, including non-essential use bans for commercial customers and potential standpipe/rota-cut supplies as a last resort). Agricultural drought impacts crop yields through soil moisture deficit - the UK Meteorological Office calculates potential soil moisture deficit (PSMD) which, when exceeding 50mm for rain-fed crops, significantly reduces yields. Ecological impacts include river flow reduction below environmental flow requirements (Q95 - the flow exceeded 95% of the time), fish kills from low dissolved oxygen, and permanent damage to wetland habitats if peat dries and oxidises. Community drought response should promote water efficiency (target: 110 litres/person/day from current UK average of 145), fix leaking infrastructure, implement greywater recycling where possible, adjust irrigation schedules (early morning to reduce evaporation), and support vulnerable populations who may ration drinking water inappropriately.`,
    source: 'expert_knowledge',
    category: 'drought',
  },
  {
    title: 'Earthquake Response and Seismic Safety',
    content: `Although the UK experiences only minor seismicity (largest recorded: 6.1 ML, Dogger Bank 1931), earthquake preparedness is essential for global disaster response platforms and for UK citizens travelling or living abroad. Earthquake hazard is quantified by Peak Ground Acceleration (PGA) mapped in national seismic hazard assessments. The Modified Mercalli Intensity scale (I-XII) describes observed effects from imperceptible (I) to total destruction (XII). Immediate protective actions follow "Drop, Cover, Hold On": drop to hands and knees, take cover under sturdy furniture, hold on until shaking stops. Doorways are not safer than other locations in modern buildings. After shaking stops: check for injuries, check for gas leaks (smell, hissing sound - shut off at meter if suspected), check water and electrical lines, be prepared for aftershocks (typically 1 magnitude unit smaller than mainshock). Building vulnerability depends on construction type: unreinforced masonry is most dangerous (responsible for 75% of earthquake fatalities worldwide), while steel-frame and reinforced concrete with ductile detailing perform well. Soft-storey collapse (ground-floor parking or retail with weak columns) is a common failure mode in residential buildings. Liquefaction occurs when saturated loose sand loses strength during shaking, causing foundations to sink and buried infrastructure to float - areas near rivers and coastlines on alluvial deposits are most susceptible. Tsunami risk follows submarine earthquakes of magnitude =7.0 with vertical seafloor displacement; arrival time depends on distance (deep-ocean speed ~800km/h). Evacuation to high ground (=30m) or the upper floors of reinforced concrete buildings is the primary protective action, triggered by strong sustained shaking lasting >20 seconds in coastal areas or official tsunami warning.`,
    source: 'expert_knowledge',
    category: 'earthquake',
  },
]

// -9  ENHANCED RAG RETRIEVE WITH QUERY EXPANSION

/**
 * Enhanced retrieval pipeline:
 *   1. Expand the query using DISASTER_SYNONYMS
 *   2. Retrieve documents via the existing ragRetrieve()
 *   3. Re-rank using contextual heuristics
 *   4. Return top `limit` results
 */
export async function ragRetrieveEnhanced(
  query: string,
  limit = 5,
): Promise<Array<{ title: string; content: string; source: string; relevance: number }>> {
  const expanded = expandQuery(query)
  logger.info({ original: query, expanded }, '[RAG-Enhanced] Query expanded')

  // Retrieve more candidates than needed so re-ranking has room to work
  const candidates = await ragRetrieve(expanded, limit * 3)

  if (candidates.length === 0) return []

  const reranked = rerankResults(query, candidates)
  return reranked.slice(0, limit)
}

// -10  DYNAMIC KNOWLEDGE INJECTION

/**
 * Pull the latest predictions, alerts, and threat assessments from the
 * database and store them as ephemeral RAG documents (source = 'realtime_injection').
 * Old injections (>1 hour) are purged before new ones are inserted.
 * Returns the count of newly injected documents.
 */
export async function injectRealtimeKnowledge(): Promise<number> {
  let injected = 0

  try {
    // Purge stale realtime injections (older than 1 hour)
    await pool.query(`
      DELETE FROM rag_documents
      WHERE source = 'realtime_injection'
        AND created_at < NOW() - INTERVAL '1 hour'
    `)

    // 1. Latest flood predictions
    try {
      const { rows } = await pool.query(`
        SELECT region, risk_level, predicted_peak, confidence, description, created_at
        FROM flood_predictions
        WHERE created_at > NOW() - INTERVAL '6 hours'
        ORDER BY created_at DESC
        LIMIT 20
      `)
      for (const row of rows) {
        const content = `Active flood prediction for ${row.region}: Risk level ${row.risk_level}. ` +
          `Predicted peak: ${row.predicted_peak || 'unknown'}. ` +
          `Confidence: ${row.confidence || 'N/A'}%. ` +
          `${row.description || ''} ` +
          `Issued: ${row.created_at}.`
        await storeRAGDocument({
          title: `Realtime: Flood Prediction - ${row.region}`,
          content,
          source: 'realtime_injection',
          category: 'realtime_flood',
        })
        injected++
      }
    } catch { /* flood_predictions table may not exist */ }

    // 2. Active alerts
    try {
      const { rows } = await pool.query(`
        SELECT title, message, severity, region, alert_type, created_at
        FROM alerts
        WHERE active = true
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 20
      `)
      for (const row of rows) {
        const content = `Active alert: ${row.title}. ` +
          `Severity: ${row.severity}. Type: ${row.alert_type || 'general'}. ` +
          `Region: ${row.region || 'all'}. ` +
          `${row.message || ''} ` +
          `Issued: ${row.created_at}.`
        await storeRAGDocument({
          title: `Realtime: Alert - ${row.title}`,
          content,
          source: 'realtime_injection',
          category: 'realtime_alert',
        })
        injected++
      }
    } catch { /* alerts table may not exist */ }

    // 3. Latest threat assessment
    try {
      const { rows } = await pool.query(`
        SELECT region, threat_level, summary, factors, assessed_at
        FROM threat_assessments
        WHERE assessed_at > NOW() - INTERVAL '12 hours'
        ORDER BY assessed_at DESC
        LIMIT 10
      `)
      for (const row of rows) {
        const factors = typeof row.factors === 'object' ? JSON.stringify(row.factors) : (row.factors || '')
        const content = `Threat assessment for ${row.region}: Level ${row.threat_level}. ` +
          `${row.summary || ''} ` +
          `Contributing factors: ${factors}. ` +
          `Assessed: ${row.assessed_at}.`
        await storeRAGDocument({
          title: `Realtime: Threat Assessment - ${row.region}`,
          content,
          source: 'realtime_injection',
          category: 'realtime_threat',
        })
        injected++
      }
    } catch { /* threat_assessments table may not exist */ }

    logger.info({ injected }, '[RAG] Injected realtime knowledge documents')
  } catch (err: any) {
    logger.error({ err }, '[RAG] Realtime knowledge injection error')
  }

  return injected
}
