import type { HistoricalEvent, SeasonalTrend } from '../types'

export const HISTORICAL_EVENTS: HistoricalEvent[] = [
  { id: 'H001', date: '2023-02-15', type: 'Flood', location: 'River Don, Aberdeen', coordinates: [57.165, -2.095], severity: 'High', description: 'Major River Don flooding. 200+ homes affected. Water reached 1.8m in worst areas.', affectedPeople: 850, damage: '£4.2M' },
  { id: 'H002', date: '2022-11-20', type: 'Flood', location: 'Riverside Drive, Aberdeen', coordinates: [57.138, -2.105], severity: 'High', description: 'River Dee burst banks after prolonged rainfall. Garthdee area flooded.', affectedPeople: 420, damage: '£2.1M' },
  { id: 'H003', date: '2023-10-08', type: 'Storm', location: 'Aberdeen Coast', coordinates: [57.154, -2.073], severity: 'Medium', description: 'Storm Babet coastal flooding. Beach Esplanade overtopped. Power outages across city.', affectedPeople: 1200, damage: '£1.8M' },
  { id: 'H004', date: '2024-01-05', type: 'Flood', location: 'Bridge of Don', coordinates: [57.178, -2.088], severity: 'Medium', description: 'Flash flooding on A90. Multiple vehicles stranded. Road closed for 8 hours.', affectedPeople: 150, damage: '£350K' },
  { id: 'H005', date: '2022-08-17', type: 'Flood', location: 'City Centre, Aberdeen', coordinates: [57.148, -2.094], severity: 'Medium', description: 'Surface water flooding after thunderstorm. Drains overwhelmed in Union Street area.', affectedPeople: 300, damage: '£800K' },
  { id: 'H006', date: '2023-12-27', type: 'Storm', location: 'Aberdeenshire', coordinates: [57.15, -2.10], severity: 'High', description: 'Storm Gerrit. Widespread power outages, fallen trees. River Don levels critical.', affectedPeople: 3500, damage: '£5.5M' },
  { id: 'H007', date: '2024-09-12', type: 'Flood', location: 'Old Aberdeen', coordinates: [57.165, -2.100], severity: 'Low', description: 'Minor flooding on King Street after heavy rain. Resolved within 4 hours.', affectedPeople: 45, damage: '£50K' },
  { id: 'H008', date: '2025-01-18', type: 'Flood', location: 'Dee Valley', coordinates: [57.130, -2.110], severity: 'Medium', description: 'River Dee rose above warning level. Riverside properties sandbagged. Near miss.', affectedPeople: 200, damage: '£120K' },
]

export const SEASONAL_TRENDS: SeasonalTrend[] = [
  { month: 'Jan', floodCount: 3, avgSeverity: 2.1, rainfallMm: 78 },
  { month: 'Feb', floodCount: 4, avgSeverity: 2.4, rainfallMm: 62 },
  { month: 'Mar', floodCount: 2, avgSeverity: 1.8, rainfallMm: 55 },
  { month: 'Apr', floodCount: 1, avgSeverity: 1.2, rainfallMm: 48 },
  { month: 'May', floodCount: 1, avgSeverity: 1.0, rainfallMm: 52 },
  { month: 'Jun', floodCount: 0, avgSeverity: 0, rainfallMm: 58 },
  { month: 'Jul', floodCount: 1, avgSeverity: 1.5, rainfallMm: 65 },
  { month: 'Aug', floodCount: 2, avgSeverity: 1.8, rainfallMm: 72 },
  { month: 'Sep', floodCount: 2, avgSeverity: 1.6, rainfallMm: 68 },
  { month: 'Oct', floodCount: 4, avgSeverity: 2.2, rainfallMm: 85 },
  { month: 'Nov', floodCount: 5, avgSeverity: 2.5, rainfallMm: 82 },
  { month: 'Dec', floodCount: 4, avgSeverity: 2.3, rainfallMm: 80 },
]

export const HEATMAP_POINTS: { lat: number; lng: number; intensity: number }[] = [
  { lat: 57.165, lng: -2.095, intensity: 0.95 }, // River Don floodplain - highest
  { lat: 57.148, lng: -2.094, intensity: 0.80 }, // City centre low ground
  { lat: 57.138, lng: -2.105, intensity: 0.85 }, // Dee Valley
  { lat: 57.178, lng: -2.088, intensity: 0.70 }, // Bridge of Don
  { lat: 57.154, lng: -2.073, intensity: 0.60 }, // Coastal
  { lat: 57.130, lng: -2.110, intensity: 0.75 }, // Lower Dee
  { lat: 57.160, lng: -2.100, intensity: 0.55 }, // Old Aberdeen
  { lat: 57.145, lng: -2.115, intensity: 0.40 }, // Westburn
  { lat: 57.170, lng: -2.090, intensity: 0.65 }, // Upper Don
  { lat: 57.135, lng: -2.095, intensity: 0.50 }, // Torry
]
