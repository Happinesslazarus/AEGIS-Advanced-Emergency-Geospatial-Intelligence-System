import type { Alert, WeatherData, FloodPrediction, ResourceAllocation } from '../types'

export const SAMPLE_ALERTS: Alert[] = [
  { id: 'ALT-001', severity: 'high', title: 'Severe Flooding — Aberdeen City Centre',
    message: 'Avoid travel in the city centre. Water levels rising rapidly. Seek higher ground if in affected area.',
    area: 'Aberdeen City Centre', source: 'AEGIS Operator', timestamp: '2026-02-11T10:00:00Z',
    displayTime: '5 mins ago', active: true, channels: ['web', 'telegram', 'sms'], disasterType: 'flood' },
  { id: 'ALT-002', severity: 'high', title: 'Road Closure — A90 Bridge of Don',
    message: 'A90 northbound closed due to flooding. Diversion via A947. Expect significant delays.',
    area: 'Bridge of Don', source: 'Traffic Scotland', timestamp: '2026-02-11T09:50:00Z',
    displayTime: '15 mins ago', active: true, channels: ['web', 'telegram'], disasterType: 'flood' },
  { id: 'ALT-003', severity: 'medium', title: 'Amber Weather Warning — Heavy Rainfall',
    message: 'Met Office amber warning for heavy rain across Aberdeenshire. 40-60mm expected over next 6 hours.',
    area: 'Aberdeenshire', source: 'Met Office', timestamp: '2026-02-11T08:00:00Z',
    displayTime: '2 hours ago', active: true, channels: ['web', 'telegram', 'email'], disasterType: 'storm' },
  { id: 'ALT-004', severity: 'medium', title: 'River Don Flood Warning',
    message: 'Flood warning for River Don from Inverurie to Bridge of Don. Levels expected to peak in 2-3 hours.',
    area: 'River Don corridor', source: 'SEPA', timestamp: '2026-02-11T07:30:00Z',
    displayTime: '2.5 hours ago', active: true, channels: ['web', 'telegram'], disasterType: 'flood' },
  { id: 'ALT-005', severity: 'low', title: 'Power Outages — Westburn Area',
    message: 'SSEN reports power outages affecting ~500 properties in Westburn and Rosemount. Engineers en route.',
    area: 'Westburn, Rosemount', source: 'SSEN', timestamp: '2026-02-11T09:25:00Z',
    displayTime: '40 mins ago', active: true, channels: ['web'], disasterType: 'infrastructure' },
]

export const SAMPLE_WEATHER: WeatherData = {
  location: 'Aberdeen', temperature: 7, condition: 'Heavy Rain', rainfall: '25mm/hr',
  wind: '45 mph', humidity: '94%', visibility: 'Poor (2km)',
  warnings: [
    { type: 'Amber', message: 'Heavy rainfall — surface water flooding likely' },
    { type: 'Yellow', message: 'Strong winds — gusts up to 60mph' },
  ],
  forecast: [
    { time: '+2h', rain: '30mm/hr', wind: '50 mph' },
    { time: '+4h', rain: '20mm/hr', wind: '40 mph' },
    { time: '+6h', rain: '10mm/hr', wind: '30 mph' },
  ],
}

export const SAMPLE_PREDICTIONS: FloodPrediction[] = [
  { area: 'River Don Floodplain', probability: 0.87, timeToFlood: '45 mins',
    matchedPattern: 'Feb 2023 Flood Event (87% match)', nextAreas: ['King Street', 'Market Square', 'Don Street'],
    severity: 'High', confidence: 89, dataSources: ['River gauge', 'Rainfall radar', 'Historical pattern', 'Citizen reports (4)'] },
  { area: 'Dee Valley — Riverside Drive', probability: 0.62, timeToFlood: '2 hours',
    matchedPattern: 'Nov 2022 Flood Event (62% match)', nextAreas: ['Bridge of Dee', 'Garthdee Road', 'Duthie Park'],
    severity: 'Medium', confidence: 74, dataSources: ['River gauge', 'Rainfall forecast', 'Historical pattern'] },
  { area: 'Coastal — Beach Area', probability: 0.45, timeToFlood: '4 hours',
    matchedPattern: 'Storm surge pattern (45% match)', nextAreas: ['Beach Esplanade', 'Fittie', 'Footdee'],
    severity: 'Medium', confidence: 61, dataSources: ['Tide data', 'Wind speed', 'Wave height'] },
]

export const SAMPLE_RESOURCES: ResourceAllocation[] = [
  { zone: 'Zone A — City Centre', priority: 'Critical', reports: 15, recommendation: '3 ambulances, 2 fire engines, 1 rescue boat', estimated: '23 people needing help', deployed: true },
  { zone: 'Zone B — Old Aberdeen / Bridge of Don', priority: 'High', reports: 8, recommendation: '2 ambulances, 1 fire engine', estimated: '12 people needing help', deployed: true },
  { zone: 'Zone C — Riverside / Dee Valley', priority: 'Medium', reports: 4, recommendation: '1 ambulance, sandbag deployment', estimated: '4 people needing help', deployed: false },
  { zone: 'Zone D — Coastal / Beach', priority: 'Low', reports: 2, recommendation: 'Monitoring only — barrier check', estimated: '0 immediate', deployed: false },
]
