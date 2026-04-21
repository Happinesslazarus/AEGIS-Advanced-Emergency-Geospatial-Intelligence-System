/**
 * LLM Tool Schemas
 *
 * Static definitions of every tool exposed to the LLM:
 *   AVAILABLE_TOOLS   -- citizen-facing tools (weather, flood risk, shelters, …)
 *   ADMIN_TOOLS       -- operator-only tools (sitrep, resource status, predictions, …)
 *   ADMIN_SYSTEM_ADDENDUM -- extra system-prompt text injected for admin sessions
 */
import type { LLMTool } from '../../types/index.js'
import { llmCtx, regionMeta } from '../chatConstants.js'

export const AVAILABLE_TOOLS: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_active_alerts',
      description: 'Get currently active emergency alerts and flood warnings in the area',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info', 'all'], description: 'Filter by severity' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather conditions and forecast',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Location name (e.g., Aberdeen, Edinburgh)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_shelters',
      description: 'Find nearby emergency shelters with capacity and amenities',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
          radius_km: { type: 'number', description: 'Search radius in km (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_flood_risk',
      description: 'Check flood risk level for a specific location using PostGIS',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_wikipedia',
      description: 'Search Wikipedia for factual information about disasters, emergency procedures, geography, or any topic the citizen asks about',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "flood safety", "Aberdeen Scotland", "earthquake preparedness")' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_flood_alerts',
      description: `Get live flood warning alerts for ${regionMeta.name} -- current flood warnings and watch areas from ${llmCtx.floodAuthority}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather_warnings',
      description: `Get current ${llmCtx.weatherAuthority} weather warnings (wind, rain, snow, fog, thunderstorm) -- use when asked about weather warnings or forecasts`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'geocode_location',
      description: `Convert a place name to coordinates. Use this when the citizen mentions a specific location to find flood risk or shelters nearby.`,
      parameters: {
        type: 'object',
        properties: {
          place: { type: 'string', description: `Place name (e.g., ${llmCtx.exampleLocations.slice(0, 2).map(l => `"${l}"`).join(', ') || '"City centre"'})` },
        },
        required: ['place'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_evacuation_routes',
      description: 'Get evacuation routes from a location. Returns recommended routes, estimated travel times, and current road conditions.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude of origin' },
          lng: { type: 'number', description: 'Longitude of origin' },
          hazard_type: { type: 'string', description: 'Type of hazard to evacuate from (flood, wildfire, etc.)' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_nearby_hospitals',
      description: 'Find nearest hospitals and medical facilities with their current status and capacity.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
          radius_km: { type: 'number', description: 'Search radius in km (default 30)' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_incident_clusters',
      description: 'Get clusters of related incidents in an area to identify hotspots and patterns.',
      parameters: {
        type: 'object',
        properties: {
          incident_type: { type: 'string', description: 'Filter by incident type (flood, fire, storm, etc.) or "all"' },
          hours: { type: 'number', description: 'Look back period in hours (default 24)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_report_status',
      description: 'Check the status of an incident report previously submitted by the citizen. Returns current status, priority, and any operator notes.',
      parameters: {
        type: 'object',
        properties: {
          report_id: { type: 'string', description: 'The report/incident ID (e.g., "INC-12345")' },
        },
        required: ['report_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_infrastructure_status',
      description: 'Check status of local infrastructure -- roads, bridges, power grid, water supply in an area.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string', description: 'Area or road name to check' },
          infrastructure_type: { type: 'string', enum: ['roads', 'bridges', 'power', 'water', 'all'], description: 'Type of infrastructure to check' },
        },
        required: ['area'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_historical_comparison',
      description: 'Compare current conditions with historical events to provide context (e.g., "Is this flood worse than January 2024?").',
      parameters: {
        type: 'object',
        properties: {
          hazard_type: { type: 'string', description: 'Type of hazard to compare (flood, storm, etc.)' },
          location: { type: 'string', description: 'Location for historical comparison' },
        },
        required: ['hazard_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time information about current events, disasters, news, weather conditions, emergency updates, or any topic. Use this when the citizen asks about something happening RIGHT NOW that may not be in the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "current flooding UK March 2026", "earthquake today")' },
          num_results: { type: 'number', description: 'Number of results to return (default 5, max 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: 'Analyze an uploaded image using AI vision. Citizens can upload photos of ANY disaster situation -- flooding, structural damage, wildfire smoke, storm damage, injuries, road conditions, water contamination, landslides, fallen trees, chemical spills, or any safety concern. The AI will describe what it sees and provide relevant safety guidance.',
      parameters: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'URL or path of the uploaded image to analyze' },
          context: { type: 'string', description: 'Optional context from the citizen about what the photo shows (e.g., "my street", "the river near my house")' },
        },
        required: ['image_url'],
      },
    },
  },
]


export const ADMIN_SYSTEM_ADDENDUM = `

## OPERATOR MODE -- Advanced Command & Control Intelligence

You are now operating in **ADMIN/OPERATOR MODE**. The user is an authenticated emergency management operator with elevated privileges. Adjust your behaviour:

/**
* *OPERATOR-SPECIFIC CAPABILITIES:
- Provide tactical incident analysis and pattern recognition across all active incidents
- Generate situation reports (SITREPs) summarising current operational status
- Recommend resource deployment decisions based on current data
- Analyse incident trends and predict resource needs with time-horizon projections
- Provide inter-agency coordination advice using ICS/NIMS frameworks
- Summarise citizen sentiment and community impact with actionable insights
- Perform comparative analysis: current situation vs historical events
- Generate decision matrices for complex multi-incident scenarios
- Identify cascading failure risks (e.g., flood ? power outage ? medical equipment failure)
- Provide shift handover briefings with critical context

/**
* *RESPONSE CALIBRATION FOR OPERATORS:
- Use professional emergency management terminology (ICS/NIMS where applicable)
- Be more technical and data-driven -- operators can handle raw statistics
- Include decision support: "Based on X incidents in Y hours, consider Z"
- Reference specific report IDs, alert IDs, and coordinate data when available
- When multiple incidents are active, provide prioritisation recommendations using METHANE format
- Proactively suggest resource reallocation when patterns indicate shifting risk
- Include confidence levels on predictions: "High confidence (>80%): surge expected in 6h"
- When presenting options, use structured decision matrices with pros/cons/risk scores
- Provide early warning indicators: "Watch for: X, Y, Z -- these preceded the 2024 incident"

/**
* *OPERATIONAL INTELLIGENCE FRAMEWORK:
For every operational question, provide:
1. **Current State** -- What is happening right now (data-driven, with specific numbers)
2. **Trend Analysis** -- Is the situation improving (?), stable (?), or worsening (?)? Rate of change?
3. **Prediction** -- What will happen in 2h, 6h, 12h based on current trajectory
4. **Recommendation** -- Specific actionable recommendation with rationale and alternatives
5. **Risk Assessment** -- What could go wrong if no action is taken. Cascading risks.
6. **Resource Calculus** -- What resources are needed vs available. Gap analysis.
7. **Precedent** -- Has this situation occurred before? What worked/failed?

/**
* *MULTI-INCIDENT CORRELATION:
When multiple incidents are active:
- Identify causal chains and interconnected risks
- Prioritise by life safety > property protection > environmental
- Suggest unified command structure when incidents overlap
- Flag resource conflicts between simultaneous operations

/**
* *SITREP GENERATION FORMAT (when using generate_sitrep tool):
METHANE format for major incidents:
- M: Major incident declared (yes/no)
- E: Exact location (grid reference, postcode, landmark)
- T: Type of incident (flood/fire/storm/multi-hazard)
- H: Hazards present and potential
- A: Access routes (open/blocked/restricted)
- N: Number of casualties (confirmed, estimated, unaccounted)
- E: Emergency services on scene (police/fire/ambulance/coastguard)

/**
* *OPERATOR TOOLS:
You have access to additional tools for incident management:
- get_incident_summary: Overview of all active incidents by type and severity
- get_resource_status: Current deployment of personnel, vehicles, and supplies
- get_citizen_sentiment: Aggregate sentiment from recent citizen reports and messages
- generate_sitrep: Create a formatted situation report for the current operational period
- get_ai_predictions: View AI hazard predictions and confidence levels
- get_performance_metrics: System performance and platform health metrics
- get_operator_activity: Recent operator actions and decisions for context

/**
* *PROACTIVE OPERATOR SUPPORT:
Don't just answer -- anticipate what the operator needs next:
- After a SITREP request ? offer resource reallocation analysis
- After viewing incidents ? suggest correlation patterns
- After resource check ? flag upcoming capacity issues
- After sentiment analysis ? recommend communication strategy
- At shift change times ? offer comprehensive handover briefing
`

export const ADMIN_TOOLS: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_incident_summary',
      description: 'Get a summary of all active incidents grouped by type, severity, and status for operational overview',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Look-back period in hours (default 24)' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'all'], description: 'Filter by severity' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_resource_status',
      description: 'Get current resource deployment status -- personnel, vehicles, shelters, and supply levels',
      parameters: {
        type: 'object',
        properties: {
          resource_type: { type: 'string', enum: ['personnel', 'vehicles', 'shelters', 'supplies', 'all'], description: 'Type of resource to check' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_citizen_sentiment',
      description: 'Aggregate citizen sentiment from recent reports, messages, and community chat to gauge community mood and concerns',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Look-back period in hours (default 12)' },
          area: { type: 'string', description: 'Specific area to analyse sentiment for' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_sitrep',
      description: 'Generate a formatted Situation Report (SITREP) covering active incidents, resources, weather, and recommendations',
      parameters: {
        type: 'object',
        properties: {
          period_hours: { type: 'number', description: 'Reporting period in hours (default 12)' },
          format: { type: 'string', enum: ['brief', 'full', 'methane'], description: 'Brief (1 paragraph), full (structured sections), or METHANE format' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ai_predictions',
      description: 'View AI hazard predictions with confidence levels, trends, and time horizons for proactive decision-making',
      parameters: {
        type: 'object',
        properties: {
          hazard_type: { type: 'string', enum: ['flood', 'storm', 'fire', 'heatwave', 'all'], description: 'Filter by hazard type' },
          hours_ahead: { type: 'number', description: 'Prediction horizon in hours (default 24)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_performance_metrics',
      description: 'System performance and health metrics -- response times, active users, model performance, error rates',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['system', 'ai_models', 'user_activity', 'all'], description: 'Metrics category' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_operator_activity',
      description: 'Recent operator actions, decisions, and chat sessions for shift handover context and coordination',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Look-back period in hours (default 8)' },
        },
        required: [],
      },
    },
  },
]
