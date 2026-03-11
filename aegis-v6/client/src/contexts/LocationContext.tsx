import { createContext, useContext, useState, ReactNode } from 'react'
import type { LocationConfig, LocationOption } from '../types'

interface LocationContextType {
  location: LocationConfig
  activeLocation: string
  setActiveLocation: (key: string) => void
  availableLocations: LocationOption[]
  userPosition: [number, number] | null
  detectUserLocation: () => void
}

export const LOCATIONS: Record<string, LocationConfig> = {
  // ── GLOBAL ──
  world: {
    name: '🌍 Global Overview', center: [20, 0], zoom: 2,
    bounds: [[-85, -180], [85, 180]], rivers: ['Nile', 'Amazon', 'Yangtze', 'Mississippi', 'Ganges', 'Congo', 'Mekong', 'Danube'],
    floodZones: [
      { name: 'South Asia Monsoon Belt', coords: [23, 80], risk: 'high' },
      { name: 'Central Europe Flood Corridor', coords: [50, 12], risk: 'high' },
      { name: 'US Gulf Coast', coords: [29, -90], risk: 'high' },
      { name: 'West Africa Niger Delta', coords: [5.3, 6.5], risk: 'high' },
    ],
    emergencyContacts: { emergency: '112', nhs: '', nonEmergency: '' },
  },
  // ── CONTINENTAL ──
  asia: {
    name: '🌏 Asia', center: [28, 90], zoom: 3,
    bounds: [[-10, 40], [55, 150]], rivers: ['Ganges', 'Brahmaputra', 'Yangtze', 'Mekong', 'Indus', 'Yellow River'],
    floodZones: [
      { name: 'Bangladesh Delta', coords: [23.7, 90.4], risk: 'high' },
      { name: 'Yangtze Basin', coords: [30.6, 114.3], risk: 'high' },
      { name: 'Mekong Delta', coords: [10, 105.7], risk: 'high' },
      { name: 'Pakistan Indus', coords: [27.7, 68.9], risk: 'high' },
    ],
    emergencyContacts: { emergency: '112', nhs: '', nonEmergency: '' },
  },
  europe: {
    name: '🌍 Europe', center: [50, 10], zoom: 4,
    bounds: [[35, -12], [72, 45]], rivers: ['Rhine', 'Danube', 'Thames', 'Seine', 'Elbe', 'Po', 'Oder'],
    floodZones: [
      { name: 'Rhine Delta', coords: [51.9, 4.5], risk: 'high' },
      { name: 'Danube Basin', coords: [47.5, 19], risk: 'high' },
      { name: 'Po Valley', coords: [45, 11], risk: 'medium' },
      { name: 'Valencia Coast', coords: [39.5, -0.4], risk: 'high' },
    ],
    emergencyContacts: { emergency: '112', nhs: '', nonEmergency: '' },
  },
  africa: {
    name: '🌍 Africa', center: [5, 20], zoom: 3,
    bounds: [[-35, -20], [37, 52]], rivers: ['Nile', 'Niger', 'Congo', 'Zambezi', 'Limpopo'],
    floodZones: [
      { name: 'Niger Delta', coords: [5.3, 6.5], risk: 'high' },
      { name: 'Nile Valley Sudan', coords: [15.5, 32.6], risk: 'high' },
      { name: 'Mozambique Coast', coords: [-18, 35.3], risk: 'high' },
      { name: 'Congo Basin', coords: [-4.3, 15.3], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '112', nhs: '', nonEmergency: '' },
  },
  northamerica: {
    name: '🌎 North America', center: [40, -100], zoom: 3,
    bounds: [[10, -170], [72, -50]], rivers: ['Mississippi', 'Missouri', 'Colorado', 'Sacramento', 'Hudson'],
    floodZones: [
      { name: 'Gulf Coast', coords: [29.8, -95.4], risk: 'high' },
      { name: 'Mississippi Valley', coords: [38.6, -90.2], risk: 'high' },
      { name: 'Miami Coastal', coords: [25.8, -80.2], risk: 'high' },
      { name: 'California Atmospheric Rivers', coords: [38, -121.7], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '911', nhs: '', nonEmergency: '311' },
  },
  southamerica: {
    name: '🌎 South America', center: [-15, -55], zoom: 3,
    bounds: [[-56, -82], [13, -34]], rivers: ['Amazon', 'Paraná', 'Orinoco', 'São Francisco'],
    floodZones: [
      { name: 'Amazon Basin', coords: [-3.1, -60], risk: 'high' },
      { name: 'Rio Grande do Sul', coords: [-30, -51.2], risk: 'high' },
      { name: 'Buenos Aires Coast', coords: [-34.6, -58.4], risk: 'medium' },
      { name: 'São Paulo Metro', coords: [-23.6, -46.6], risk: 'high' },
    ],
    emergencyContacts: { emergency: '911', nhs: '', nonEmergency: '' },
  },
  oceania: {
    name: '🌏 Oceania', center: [-25, 145], zoom: 4,
    bounds: [[-47, 110], [-10, 180]], rivers: ['Murray-Darling', 'Brisbane', 'Fitzroy'],
    floodZones: [
      { name: 'Brisbane-Lismore', coords: [-27.5, 153], risk: 'high' },
      { name: 'Sydney Hawkesbury', coords: [-33.7, 150.7], risk: 'high' },
      { name: 'Auckland NZ', coords: [-36.8, 174.8], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '000', nhs: '', nonEmergency: '' },
  },
  // ── MAJOR CITIES ── Asia
  mumbai: {
    name: '🇮🇳 Mumbai', center: [19.076, 72.878], zoom: 12,
    bounds: [[18.89, 72.77], [19.27, 72.99]], rivers: ['Mithi River'],
    floodZones: [
      { name: 'Dharavi Low Ground', coords: [19.044, 72.855], risk: 'high' },
      { name: 'Sion-Kurla Corridor', coords: [19.065, 72.862], risk: 'high' },
      { name: 'Mumbai Airport Zone', coords: [19.089, 72.866], risk: 'high' },
      { name: 'Marine Drive Coast', coords: [18.943, 72.823], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '112', nhs: '108', nonEmergency: '100' },
  },
  dhaka: {
    name: '🇧🇩 Dhaka', center: [23.810, 90.413], zoom: 12,
    bounds: [[23.67, 90.30], [23.92, 90.53]], rivers: ['Buriganga', 'Turag'],
    floodZones: [
      { name: 'Old Dhaka Waterfront', coords: [23.709, 90.406], risk: 'high' },
      { name: 'Kamrangirchar', coords: [23.727, 90.375], risk: 'high' },
      { name: 'Demra Industrial', coords: [23.750, 90.487], risk: 'high' },
      { name: 'Uttara North', coords: [23.875, 90.399], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '999', nhs: '', nonEmergency: '' },
  },
  shanghai: {
    name: '🇨🇳 Shanghai', center: [31.230, 121.474], zoom: 11,
    bounds: [[30.98, 121.10], [31.52, 121.98]], rivers: ['Huangpu', 'Yangtze Estuary'],
    floodZones: [
      { name: 'Pudong Low Zone', coords: [31.235, 121.535], risk: 'high' },
      { name: 'Bund Waterfront', coords: [31.240, 121.491], risk: 'high' },
      { name: 'Chongming Island', coords: [31.530, 121.600], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '110', nhs: '120', nonEmergency: '' },
  },
  tokyo: {
    name: '🇯🇵 Tokyo', center: [35.681, 139.767], zoom: 11,
    bounds: [[35.52, 139.55], [35.85, 140.00]], rivers: ['Arakawa', 'Sumida', 'Edogawa'],
    floodZones: [
      { name: 'Koto Ward Zero-Metre Zone', coords: [35.673, 139.817], risk: 'high' },
      { name: 'Edogawa Floodplain', coords: [35.710, 139.880], risk: 'high' },
      { name: 'Shibuya Underground', coords: [35.658, 139.702], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '110', nhs: '119', nonEmergency: '' },
  },
  jakarta: {
    name: '🇮🇩 Jakarta', center: [-6.208, 106.846], zoom: 12,
    bounds: [[-6.38, 106.68], [-6.09, 107.00]], rivers: ['Ciliwung', 'Cisadane'],
    floodZones: [
      { name: 'North Jakarta Subsidence', coords: [-6.125, 106.825], risk: 'high' },
      { name: 'Kemang-Ciliwung', coords: [-6.261, 106.814], risk: 'high' },
      { name: 'Pluit Reservoir Area', coords: [-6.127, 106.793], risk: 'high' },
      { name: 'Muara Angke Coast', coords: [-6.103, 106.771], risk: 'high' },
    ],
    emergencyContacts: { emergency: '112', nhs: '119', nonEmergency: '' },
  },
  manila: {
    name: '🇵🇭 Manila', center: [14.599, 120.984], zoom: 12,
    bounds: [[14.45, 120.90], [14.73, 121.10]], rivers: ['Pasig', 'Marikina'],
    floodZones: [
      { name: 'Marikina Valley', coords: [14.651, 121.109], risk: 'high' },
      { name: 'Tondo-Manila Bay', coords: [14.612, 120.960], risk: 'high' },
      { name: 'Pasig River Corridor', coords: [14.585, 121.011], risk: 'high' },
    ],
    emergencyContacts: { emergency: '911', nhs: '', nonEmergency: '' },
  },
  bangkok: {
    name: '🇹🇭 Bangkok', center: [13.756, 100.502], zoom: 11,
    bounds: [[13.55, 100.30], [13.96, 100.72]], rivers: ['Chao Phraya'],
    floodZones: [
      { name: 'Don Muang-Rangsit', coords: [13.920, 100.590], risk: 'high' },
      { name: 'Thonburi Canals', coords: [13.720, 100.476], risk: 'high' },
      { name: 'Bang Khun Thian Coast', coords: [13.598, 100.432], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '191', nhs: '1669', nonEmergency: '' },
  },
  // ── MAJOR CITIES ── Europe
  amsterdam: {
    name: '🇳🇱 Amsterdam', center: [52.370, 4.895], zoom: 12,
    bounds: [[52.29, 4.73], [52.43, 5.05]], rivers: ['Amstel', 'IJ'],
    floodZones: [
      { name: 'IJburg Polder', coords: [52.355, 5.010], risk: 'high' },
      { name: 'Central Canal Ring', coords: [52.367, 4.884], risk: 'medium' },
      { name: 'Noord Waterfront', coords: [52.391, 4.905], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '112', nhs: '', nonEmergency: '' },
  },
  venice: {
    name: '🇮🇹 Venice', center: [45.438, 12.335], zoom: 13,
    bounds: [[45.38, 12.26], [45.48, 12.42]], rivers: [],
    floodZones: [
      { name: 'Piazza San Marco', coords: [45.434, 12.339], risk: 'high' },
      { name: 'Dorsoduro Low Ground', coords: [45.430, 12.322], risk: 'high' },
      { name: 'Chioggia South Lagoon', coords: [45.218, 12.279], risk: 'high' },
    ],
    emergencyContacts: { emergency: '112', nhs: '118', nonEmergency: '' },
  },
  cologne: {
    name: '🇩🇪 Cologne-Rhine', center: [50.937, 6.960], zoom: 12,
    bounds: [[50.86, 6.82], [51.01, 7.10]], rivers: ['Rhine'],
    floodZones: [
      { name: 'Altstadt Rhine Bank', coords: [50.940, 6.965], risk: 'high' },
      { name: 'Deutz Waterfront', coords: [50.935, 6.977], risk: 'high' },
      { name: 'Porz-Zündorf', coords: [50.871, 7.041], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '112', nhs: '116117', nonEmergency: '' },
  },
  paris: {
    name: '🇫🇷 Paris', center: [48.857, 2.352], zoom: 12,
    bounds: [[48.80, 2.22], [48.92, 2.47]], rivers: ['Seine', 'Marne'],
    floodZones: [
      { name: 'Île de la Cité', coords: [48.855, 2.347], risk: 'high' },
      { name: 'Bercy-Austerlitz', coords: [48.838, 2.377], risk: 'high' },
      { name: 'Javel-Grenelle', coords: [48.845, 2.277], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '112', nhs: '15', nonEmergency: '' },
  },
  budapest: {
    name: '🇭🇺 Budapest', center: [47.498, 19.040], zoom: 12,
    bounds: [[47.40, 18.92], [47.60, 19.18]], rivers: ['Danube'],
    floodZones: [
      { name: 'Óbuda Island', coords: [47.554, 19.043], risk: 'high' },
      { name: 'Pest Embankment', coords: [47.497, 19.052], risk: 'high' },
      { name: 'Csepel Island', coords: [47.422, 19.070], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '112', nhs: '104', nonEmergency: '' },
  },
  // ── MAJOR CITIES ── Americas
  houston: {
    name: '🇺🇸 Houston', center: [29.760, -95.370], zoom: 11,
    bounds: [[29.55, -95.65], [29.97, -95.07]], rivers: ['Buffalo Bayou', 'San Jacinto', 'Brays Bayou'],
    floodZones: [
      { name: 'Addicks-Barker Reservoirs', coords: [29.778, -95.622], risk: 'high' },
      { name: 'Meyerland-Brays Bayou', coords: [29.687, -95.450], risk: 'high' },
      { name: 'Greenspoint-Greens Bayou', coords: [29.953, -95.394], risk: 'high' },
      { name: 'Clear Lake-NASA', coords: [29.570, -95.120], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '911', nhs: '', nonEmergency: '311' },
  },
  neworleans: {
    name: '🇺🇸 New Orleans', center: [29.951, -90.072], zoom: 12,
    bounds: [[29.87, -90.18], [30.04, -89.95]], rivers: ['Mississippi', 'Lake Pontchartrain'],
    floodZones: [
      { name: 'Lower 9th Ward', coords: [29.960, -89.987], risk: 'high' },
      { name: 'Lakeview', coords: [30.004, -90.092], risk: 'high' },
      { name: 'New Orleans East', coords: [30.025, -89.947], risk: 'high' },
      { name: 'French Quarter', coords: [29.958, -90.065], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '911', nhs: '', nonEmergency: '311' },
  },
  miami: {
    name: '🇺🇸 Miami', center: [25.762, -80.192], zoom: 11,
    bounds: [[25.60, -80.38], [25.93, -80.05]], rivers: ['Miami River'],
    floodZones: [
      { name: 'Miami Beach', coords: [25.790, -80.131], risk: 'high' },
      { name: 'Brickell-Downtown', coords: [25.764, -80.185], risk: 'high' },
      { name: 'Little Haiti', coords: [25.830, -80.193], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '911', nhs: '', nonEmergency: '311' },
  },
  portoalegre: {
    name: '🇧🇷 Porto Alegre', center: [-30.034, -51.230], zoom: 12,
    bounds: [[-30.18, -51.38], [-29.92, -51.05]], rivers: ['Guaíba', 'Jacuí', 'Gravataí'],
    floodZones: [
      { name: 'Centro Histórico', coords: [-30.032, -51.230], risk: 'high' },
      { name: 'Ilha da Pintada', coords: [-30.005, -51.245], risk: 'high' },
      { name: 'Canoas-Mathias Velho', coords: [-29.927, -51.180], risk: 'high' },
      { name: 'Sarandi Lowlands', coords: [-29.943, -51.152], risk: 'high' },
    ],
    emergencyContacts: { emergency: '190', nhs: '192', nonEmergency: '' },
  },
  // ── MAJOR CITIES ── Africa
  lagos: {
    name: '🇳🇬 Lagos', center: [6.524, 3.379], zoom: 11,
    bounds: [[6.39, 3.20], [6.66, 3.55]], rivers: ['Lagos Lagoon'],
    floodZones: [
      { name: 'Victoria Island', coords: [6.428, 3.423], risk: 'high' },
      { name: 'Eko Atlantic Landfill', coords: [6.412, 3.410], risk: 'high' },
      { name: 'Makoko Waterfront', coords: [6.497, 3.389], risk: 'high' },
      { name: 'Ikorodu Creek', coords: [6.613, 3.508], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '112', nhs: '', nonEmergency: '' },
  },
  khartoum: {
    name: '🇸🇩 Khartoum', center: [15.501, 32.560], zoom: 12,
    bounds: [[15.40, 32.42], [15.65, 32.70]], rivers: ['Blue Nile', 'White Nile'],
    floodZones: [
      { name: 'Tuti Island Confluence', coords: [15.621, 32.521], risk: 'high' },
      { name: 'Omdurman Bank', coords: [15.639, 32.476], risk: 'high' },
      { name: 'Khartoum North', coords: [15.653, 32.548], risk: 'high' },
    ],
    emergencyContacts: { emergency: '999', nhs: '', nonEmergency: '' },
  },
  // ── MAJOR CITIES ── Oceania
  brisbane: {
    name: '🇦🇺 Brisbane', center: [-27.469, 153.024], zoom: 12,
    bounds: [[-27.62, 152.87], [-27.33, 153.17]], rivers: ['Brisbane River'],
    floodZones: [
      { name: 'Milton-Auchenflower', coords: [-27.473, 152.990], risk: 'high' },
      { name: 'Rocklea-Oxley', coords: [-27.543, 152.975], risk: 'high' },
      { name: 'St Lucia Bend', coords: [-27.498, 153.003], risk: 'high' },
      { name: 'Breakfast Creek', coords: [-27.445, 153.048], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '000', nhs: '', nonEmergency: '' },
  },
  // ── UK & SCOTLAND ──
  uk: {
    name: '🇬🇧 United Kingdom', center: [54.5, -2.5], zoom: 6,
    bounds: [[49.5, -8.5], [59, 2]], rivers: ['Thames', 'Severn', 'Trent', 'Clyde', 'Dee', 'Don'],
    floodZones: [
      { name: 'Thames Estuary', coords: [51.5, 0.5], risk: 'high' },
      { name: 'Somerset Levels', coords: [51.1, -2.9], risk: 'high' },
      { name: 'Yorkshire Ouse', coords: [53.9, -1.1], risk: 'high' },
      { name: 'Central Scotland', coords: [55.95, -3.6], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '999', nhs: '111', nonEmergency: '101' },
  },
  scotland: {
    name: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland', center: [56.49, -4.20], zoom: 7,
    bounds: [[54.6, -7.5], [58.7, -0.7]], rivers: ['River Tay', 'River Clyde', 'River Dee', 'River Don', 'River Spey', 'River Forth'],
    floodZones: [
      { name: 'Central Belt', coords: [55.95, -3.6], risk: 'high' },
      { name: 'Aberdeenshire', coords: [57.15, -2.1], risk: 'high' },
      { name: 'Tayside', coords: [56.46, -3.0], risk: 'medium' },
      { name: 'Highlands', coords: [57.5, -4.5], risk: 'low' },
    ],
    emergencyContacts: { emergency: '999', nhs: '111', nonEmergency: '101' },
  },
  aberdeen: {
    name: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Aberdeen', center: [57.1497, -2.0943], zoom: 13,
    bounds: [[57.10, -2.20], [57.20, -1.95]], rivers: ['River Dee', 'River Don'],
    floodZones: [
      { name: 'River Don Floodplain', coords: [57.165, -2.095], risk: 'high' },
      { name: 'Dee Valley', coords: [57.130, -2.110], risk: 'medium' },
      { name: 'City Centre Low Ground', coords: [57.148, -2.095], risk: 'high' },
      { name: 'Bridge of Don', coords: [57.178, -2.088], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '999', nhs: '111', nonEmergency: '101' },
  },
  edinburgh: {
    name: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Edinburgh', center: [55.9533, -3.1883], zoom: 13,
    bounds: [[55.90, -3.30], [56.00, -3.05]], rivers: ['Water of Leith', 'River Almond'],
    floodZones: [
      { name: 'Water of Leith Corridor', coords: [55.948, -3.215], risk: 'high' },
      { name: 'Murrayfield', coords: [55.946, -3.240], risk: 'medium' },
      { name: 'Leith Docks', coords: [55.976, -3.170], risk: 'high' },
      { name: 'Cramond', coords: [55.977, -3.296], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '999', nhs: '111', nonEmergency: '101' },
  },
  glasgow: {
    name: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Glasgow', center: [55.8642, -4.2518], zoom: 13,
    bounds: [[55.82, -4.38], [55.91, -4.12]], rivers: ['River Clyde', 'River Kelvin', 'White Cart Water'],
    floodZones: [
      { name: 'Clyde Waterfront', coords: [55.858, -4.270], risk: 'high' },
      { name: 'Partick / River Kelvin', coords: [55.871, -4.305], risk: 'medium' },
      { name: 'Cathcart / White Cart', coords: [55.822, -4.270], risk: 'high' },
      { name: 'Glasgow Green', coords: [55.848, -4.225], risk: 'medium' },
      { name: 'Yoker', coords: [55.882, -4.380], risk: 'low' },
    ],
    emergencyContacts: { emergency: '999', nhs: '111', nonEmergency: '101' },
  },
  dundee: {
    name: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Dundee', center: [56.4620, -2.9707], zoom: 13,
    bounds: [[56.43, -3.08], [56.50, -2.85]], rivers: ['River Tay', 'Dighty Water'],
    floodZones: [
      { name: 'Tay Estuary', coords: [56.455, -2.960], risk: 'high' },
      { name: 'Broughty Ferry', coords: [56.467, -2.870], risk: 'medium' },
      { name: 'Dighty Water Corridor', coords: [56.478, -2.920], risk: 'medium' },
    ],
    emergencyContacts: { emergency: '999', nhs: '111', nonEmergency: '101' },
  },
  generic: {
    name: '📍 Custom Location', center: [54.0, -2.0], zoom: 6,
    bounds: [[49.0, -8.0], [59.0, 2.0]], rivers: [], floodZones: [],
    emergencyContacts: { emergency: '999', nhs: '111', nonEmergency: '101' },
  },
}

const LocationContext = createContext<LocationContextType | null>(null)

export function LocationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [activeLocation, setActiveLocation] = useState<string>('scotland')
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null)

  const detectUserLocation = (): void => {
    if (!('geolocation' in navigator)) return

    let best: GeolocationPosition | null = null
    let watchId: number | null = null

    const finish = (): void => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (best) {
        setUserPosition([best.coords.latitude, best.coords.longitude])
      }
    }

    const timer = setTimeout(() => {
      finish()
    }, 12000)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        best = pos
        if (pos.coords.accuracy <= 30) {
          clearTimeout(timer)
          finish()
        }
      },
      (err) => console.warn('Geolocation unavailable:', err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) {
          best = pos
        }
        if (best.coords.accuracy <= 20) {
          clearTimeout(timer)
          finish()
        }
      },
      () => {
        // Ignore watch errors while timer is active.
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }

  return (
    <LocationContext.Provider value={{
      location: LOCATIONS[activeLocation], activeLocation, setActiveLocation,
      availableLocations: Object.entries(LOCATIONS).map(([key, val]) => ({ key, name: val.name })),
      userPosition, detectUserLocation,
    }}>
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation(): LocationContextType {
  const ctx = useContext(LocationContext)
  if (!ctx) throw new Error('useLocation must be within LocationProvider')
  return ctx
}
