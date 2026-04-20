/**
 * File: globalFloodData.ts
  *
  * What this file does:
  * Hard-coded global flood hotspot data: major at-risk cities,
  * significant rivers, and historical flood zones. Powers the worldwide
  * map overlay in LiveMap.tsx and Map3DView.tsx when the user zooms out.
  *
  * How it connects:
  * - Used by client/src/components/LiveMap.tsx for global flood overlay
  * - Used by client/src/components/Map3DView.tsx for 3D globe risk zones
  * - Static data -- not fetched from the server
 */

//GLOBAL FLOOD & HAZARD DATA -- Worldwide flood hotspots, rivers, risk zones
//Used by both 2D LiveMap and 3D Map3DView for global visualization

export interface GlobalFloodZone {
  id: string
  name: string
  coords: [number, number] // [lat, lng]
  risk: 'critical' | 'high' | 'medium' | 'low'
  type: 'river' | 'coastal' | 'urban' | 'monsoon' | 'glacier' | 'dam' | 'delta' | 'typhoon'
  population: number
  country: string
  region: string
  description: string
  rivers?: string[]
  lastMajorEvent?: string
}

export interface GlobalRiver {
  id: string
  name: string
  coords: [number, number] // midpoint [lat, lng]
  path: [number, number][] // polyline coords [lat, lng]
  country: string
  lengthKm: number
  floodRisk: 'critical' | 'high' | 'medium' | 'low'
  basinPopulationMillions: number
  description: string
}

export interface GlobalMonitoringStation {
  id: string
  name: string
  coords: [number, number] // [lat, lng]
  country: string
  type: 'river_gauge' | 'tide_gauge' | 'weather' | 'seismic' | 'satellite_relay'
  status: 'active' | 'warning' | 'alert' | 'offline'
  waterLevel?: number
  maxLevel?: number
  trend?: 'rising' | 'falling' | 'stable'
}

//GLOBAL FLOOD ZONES -- 80+ major flood-prone regions worldwide
export const GLOBAL_FLOOD_ZONES: GlobalFloodZone[] = [
  // SOUTH & SOUTHEAST ASIA
  { id: 'bd-1', name: 'Bangladesh Ganges-Brahmaputra Delta', coords: [23.685, 90.356], risk: 'critical', type: 'delta', population: 170000000, country: 'Bangladesh', region: 'South Asia', description: 'World\'s largest river delta -- annual monsoon floods affect 30M+ people', rivers: ['Ganges', 'Brahmaputra', 'Meghna'], lastMajorEvent: '2024 Aug monsoon' },
  { id: 'in-1', name: 'Mumbai Coastal Flooding', coords: [19.076, 72.878], risk: 'critical', type: 'urban', population: 21000000, country: 'India', region: 'South Asia', description: 'Extreme urban flooding during monsoon. Sea level rise + subsidence', rivers: ['Mithi River'], lastMajorEvent: '2023 Jul floods' },
  { id: 'in-2', name: 'Kerala Backwaters', coords: [9.931, 76.267], risk: 'high', type: 'monsoon', population: 35000000, country: 'India', region: 'South Asia', description: 'Catastrophic flooding from Western Ghats rainfall', rivers: ['Periyar', 'Pamba'], lastMajorEvent: '2024 monsoon' },
  { id: 'in-3', name: 'Assam Brahmaputra Floodplain', coords: [26.144, 91.736], risk: 'critical', type: 'river', population: 35000000, country: 'India', region: 'South Asia', description: 'Annual devastating floods from Brahmaputra overflow', rivers: ['Brahmaputra', 'Barak'], lastMajorEvent: '2024 Jun' },
  { id: 'in-4', name: 'Bihar Ganga Plains', coords: [25.612, 85.144], risk: 'critical', type: 'river', population: 125000000, country: 'India', region: 'South Asia', description: 'Kosi "River of Sorrow" floods + Ganga overflow', rivers: ['Ganga', 'Kosi', 'Gandak'], lastMajorEvent: '2024 Aug' },
  { id: 'in-5', name: 'Chennai Urban Floods', coords: [13.083, 80.270], risk: 'high', type: 'urban', population: 11000000, country: 'India', region: 'South Asia', description: 'Cyclone-driven urban flooding in low-lying metropolis', rivers: ['Adyar', 'Cooum'], lastMajorEvent: '2023 Dec cyclone' },
  { id: 'pk-1', name: 'Pakistan Indus River Basin', coords: [27.713, 68.857], risk: 'critical', type: 'river', population: 230000000, country: 'Pakistan', region: 'South Asia', description: '2022 superflood submerged 1/3 of country. Recurring risk', rivers: ['Indus', 'Chenab', 'Jhelum'], lastMajorEvent: '2024 monsoon' },
  { id: 'np-1', name: 'Nepal Terai Floods', coords: [27.700, 85.324], risk: 'high', type: 'monsoon', population: 30000000, country: 'Nepal', region: 'South Asia', description: 'Himalayan glacial melt + monsoon create flash floods', rivers: ['Koshi', 'Gandaki'], lastMajorEvent: '2024 Jul' },
  { id: 'th-1', name: 'Bangkok & Chao Phraya Delta', coords: [13.756, 100.502], risk: 'high', type: 'delta', population: 11000000, country: 'Thailand', region: 'Southeast Asia', description: 'Low-lying megacity at river delta, sinking 2cm/year', rivers: ['Chao Phraya'], lastMajorEvent: '2024 monsoon' },
  { id: 'vn-1', name: 'Mekong Delta, Vietnam', coords: [10.045, 105.747], risk: 'critical', type: 'delta', population: 18000000, country: 'Vietnam', region: 'Southeast Asia', description: 'Rice bowl of Vietnam, severe sea level rise vulnerability', rivers: ['Mekong', 'Bassac'], lastMajorEvent: '2024 Oct' },
  { id: 'ph-1', name: 'Metro Manila Typhoon Corridor', coords: [14.599, 120.984], risk: 'critical', type: 'typhoon', population: 14000000, country: 'Philippines', region: 'Southeast Asia', description: 'Hit by 20+ typhoons/year, extreme urban flood risk', rivers: ['Pasig', 'Marikina'], lastMajorEvent: '2024 Super Typhoon' },
  { id: 'mm-1', name: 'Myanmar Irrawaddy Delta', coords: [16.866, 96.196], risk: 'high', type: 'delta', population: 8000000, country: 'Myanmar', region: 'Southeast Asia', description: 'Cyclone Nargis devastation zone, ongoing risk', rivers: ['Irrawaddy'], lastMajorEvent: '2024 Cyclone' },
  { id: 'id-1', name: 'Jakarta Subsidence Zone', coords: [-6.208, 106.846], risk: 'critical', type: 'urban', population: 11000000, country: 'Indonesia', region: 'Southeast Asia', description: 'Sinking megacity -- 40% below sea level, annual flooding', rivers: ['Ciliwung'], lastMajorEvent: '2025 Jan' },
  { id: 'cn-1', name: 'Yangtze River Basin', coords: [30.573, 114.279], risk: 'critical', type: 'river', population: 400000000, country: 'China', region: 'East Asia', description: '3 Gorges region -- massive flooding capacity, 400M at risk', rivers: ['Yangtze', 'Han River'], lastMajorEvent: '2024 Jul' },
  { id: 'cn-2', name: 'Pearl River Delta', coords: [22.543, 114.058], risk: 'high', type: 'delta', population: 70000000, country: 'China', region: 'East Asia', description: 'Guangdong megacity cluster, typhoon + river flood convergence', rivers: ['Pearl River', 'Dongjiang'], lastMajorEvent: '2024 typhoon' },
  { id: 'cn-3', name: 'Yellow River Basin', coords: [34.757, 113.665], risk: 'high', type: 'river', population: 110000000, country: 'China', region: 'East Asia', description: '"China\'s Sorrow" -- elevated riverbed, catastrophic breach risk', rivers: ['Yellow River', 'Wei River'], lastMajorEvent: '2024 Aug' },
  { id: 'cn-4', name: 'Henan Province Central', coords: [34.768, 113.753], risk: 'high', type: 'monsoon', population: 99000000, country: 'China', region: 'East Asia', description: '2021 Zhengzhou subway disaster -- extreme rainfall events increasing', lastMajorEvent: '2024 Jul extreme rain' },
  { id: 'jp-1', name: 'Tokyo Bay Typhoon Zone', coords: [35.681, 139.767], risk: 'high', type: 'typhoon', population: 14000000, country: 'Japan', region: 'East Asia', description: 'Underground city vulnerable to storm surge + river flooding', rivers: ['Arakawa', 'Sumida'], lastMajorEvent: '2024 Typhoon' },
  { id: 'jp-2', name: 'Kumamoto-Kyushu Floods', coords: [32.803, 130.708], risk: 'high', type: 'river', population: 1800000, country: 'Japan', region: 'East Asia', description: 'Record rainfall causing devastating mudslides and river floods', rivers: ['Kuma River'], lastMajorEvent: '2024 Jul' },

  // EUROPE
  { id: 'de-1', name: 'Rhine-Ruhr Valley', coords: [50.937, 6.960], risk: 'high', type: 'river', population: 58000000, country: 'Germany', region: 'Western Europe', description: 'Major European floodplain -- 2021 Ahr Valley disaster killed 189', rivers: ['Rhine', 'Ruhr', 'Ahr'], lastMajorEvent: '2024 flash floods' },
  { id: 'de-2', name: 'Elbe-Dresden Corridor', coords: [51.051, 13.738], risk: 'high', type: 'river', population: 4000000, country: 'Germany', region: 'Central Europe', description: 'Recurring Elbe floods -- 2002 "Flood of the Century"', rivers: ['Elbe', 'Mulde'], lastMajorEvent: '2024 spring floods' },
  { id: 'nl-1', name: 'Netherlands Rhine-Maas Delta', coords: [51.925, 4.479], risk: 'critical', type: 'delta', population: 17500000, country: 'Netherlands', region: 'Western Europe', description: '26% below sea level, Delta Works engineering marvel under climate stress', rivers: ['Rhine', 'Maas', 'Schelde'], lastMajorEvent: '2024 storm surge' },
  { id: 'it-1', name: 'Po Valley, Northern Italy', coords: [44.801, 11.330], risk: 'high', type: 'river', population: 16000000, country: 'Italy', region: 'Southern Europe', description: 'Italy\'s breadbasket -- Mediterranean rainfall bomb events', rivers: ['Po', 'Adige'], lastMajorEvent: '2024 Emilia-Romagna floods' },
  { id: 'it-2', name: 'Venice Lagoon', coords: [45.438, 12.335], risk: 'high', type: 'coastal', population: 260000, country: 'Italy', region: 'Southern Europe', description: 'MOSE barrier tested annually, Acqua Alta increasing frequency', lastMajorEvent: '2024 Nov Acqua Alta' },
  { id: 'fr-1', name: 'Paris Seine Corridor', coords: [48.857, 2.352], risk: 'medium', type: 'river', population: 12000000, country: 'France', region: 'Western Europe', description: '1910-level flood would cause €30B+ damage to central Paris', rivers: ['Seine', 'Marne'], lastMajorEvent: '2024 spring rains' },
  { id: 'es-1', name: 'Valencia Mediterranean Coast', coords: [39.470, -0.376], risk: 'high', type: 'coastal', population: 2500000, country: 'Spain', region: 'Southern Europe', description: 'DANA cold-drop events causing flash floods, Oct 2024 was catastrophic', lastMajorEvent: '2024 Oct DANA' },
  { id: 'be-1', name: 'Meuse Valley, Belgium', coords: [50.633, 5.567], risk: 'high', type: 'river', population: 3000000, country: 'Belgium', region: 'Western Europe', description: 'Devastating July 2021 floods -- Liège region underwater', rivers: ['Meuse', 'Ourthe'], lastMajorEvent: '2024 winter floods' },
  { id: 'hu-1', name: 'Danube-Tisza Basin, Hungary', coords: [47.498, 19.040], risk: 'high', type: 'river', population: 10000000, country: 'Hungary', region: 'Central Europe', description: 'Budapest on Danube floodplain -- recurring spring floods', rivers: ['Danube', 'Tisza'], lastMajorEvent: '2024 Sep Danube surge' },
  { id: 'ro-1', name: 'Danube Delta, Romania', coords: [45.150, 29.600], risk: 'medium', type: 'delta', population: 500000, country: 'Romania', region: 'Eastern Europe', description: 'UNESCO biosphere reserve, Danube discharge floods', rivers: ['Danube'], lastMajorEvent: '2024 spring' },
  { id: 'uk-1', name: 'Thames Estuary & Barrier', coords: [51.497, 0.069], risk: 'high', type: 'coastal', population: 9000000, country: 'UK', region: 'Northern Europe', description: 'Thames Barrier activated 200+ times -- sea level rise threat', rivers: ['Thames'], lastMajorEvent: '2024 winter storms' },
  { id: 'uk-2', name: 'Yorkshire Ouse Valley', coords: [53.958, -1.080], risk: 'high', type: 'river', population: 2000000, country: 'UK', region: 'Northern Europe', description: 'York and surrounding areas -- recurring winter floods', rivers: ['Ouse', 'Foss', 'Aire'], lastMajorEvent: '2024 Dec storms' },
  { id: 'uk-3', name: 'Somerset Levels', coords: [51.100, -2.900], risk: 'high', type: 'river', population: 500000, country: 'UK', region: 'Northern Europe', description: 'Low-lying wetlands -- 2014 prolonged flooding, ongoing risk', rivers: ['Parrett', 'Tone'], lastMajorEvent: '2024 winter' },
  { id: 'gr-1', name: 'Thessaly Plains, Greece', coords: [39.636, 22.417], risk: 'high', type: 'river', population: 750000, country: 'Greece', region: 'Southern Europe', description: '2023 Storm Daniel -- Mediterranean medicane flooding', rivers: ['Pinios'], lastMajorEvent: '2024 medicane' },
  { id: 'pl-1', name: 'Oder-Wroclaw Basin', coords: [51.107, 17.039], risk: 'high', type: 'river', population: 3000000, country: 'Poland', region: 'Central Europe', description: '1997 "Millennium Flood" -- Central European convergence zone', rivers: ['Oder', 'Odra'], lastMajorEvent: '2024 Sep floods' },

  // AFRICA
  { id: 'ng-1', name: 'Niger Delta Flooding', coords: [5.318, 6.462], risk: 'critical', type: 'delta', population: 31000000, country: 'Nigeria', region: 'West Africa', description: '2022 worst flooding in decades -- 600+ dead, 1.4M displaced', rivers: ['Niger', 'Benue'], lastMajorEvent: '2024 Oct' },
  { id: 'ng-2', name: 'Lagos Coastal Urban Floods', coords: [6.524, 3.379], risk: 'critical', type: 'urban', population: 21000000, country: 'Nigeria', region: 'West Africa', description: 'Fastest growing megacity -- coastal + drainage flooding', lastMajorEvent: '2024 rainy season' },
  { id: 'sd-1', name: 'Sudan Blue Nile Floods', coords: [15.501, 32.560], risk: 'critical', type: 'river', population: 45000000, country: 'Sudan', region: 'East Africa', description: 'Khartoum at Blue & White Nile confluence -- annual devastating floods', rivers: ['Blue Nile', 'White Nile'], lastMajorEvent: '2024 Aug' },
  { id: 'mz-1', name: 'Mozambique Zambezi Delta', coords: [-18.022, 35.312], risk: 'high', type: 'delta', population: 32000000, country: 'Mozambique', region: 'East Africa', description: 'Cyclone corridor -- Idai/Kenneth devastation zone', rivers: ['Zambezi', 'Limpopo'], lastMajorEvent: '2024 Cyclone Filipo' },
  { id: 'ke-1', name: 'Kenya Rift Valley Floods', coords: [-0.023, 36.960], risk: 'high', type: 'river', population: 10000000, country: 'Kenya', region: 'East Africa', description: 'Rising lake levels + El Niño driven flooding', rivers: ['Tana River'], lastMajorEvent: '2024 Mar-May rains' },
  { id: 'et-1', name: 'Ethiopia Awash River Valley', coords: [8.980, 38.740], risk: 'medium', type: 'river', population: 15000000, country: 'Ethiopia', region: 'East Africa', description: 'Rift Valley flooding + highland river overflow', rivers: ['Awash'], lastMajorEvent: '2024 Belg rains' },
  { id: 'cd-1', name: 'Congo River Basin', coords: [-4.322, 15.312], risk: 'high', type: 'river', population: 95000000, country: 'DRC', region: 'Central Africa', description: 'World\'s 2nd largest river basin -- Kinshasa-Brazzaville floods', rivers: ['Congo', 'Kasai'], lastMajorEvent: '2024 rainy season' },
  { id: 'za-1', name: 'Durban KwaZulu-Natal', coords: [-29.858, 31.022], risk: 'high', type: 'urban', population: 3700000, country: 'South Africa', region: 'Southern Africa', description: '2022 catastrophic floods killed 400+ -- climate change intensifying', lastMajorEvent: '2024 subtropical storm' },
  { id: 'ly-1', name: 'Derna, Libya Flash Floods', coords: [32.767, 22.638], risk: 'critical', type: 'dam', population: 100000, country: 'Libya', region: 'North Africa', description: '2023 Mediterranean hurricane -- dam failure killed 11,000+', rivers: ['Wadi Derna'], lastMajorEvent: '2023 Storm Daniel' },

  // AMERICAS
  { id: 'us-1', name: 'Houston-Gulf Coast', coords: [29.760, -95.370], risk: 'critical', type: 'urban', population: 7000000, country: 'USA', region: 'North America', description: 'Hurricane Harvey zone -- $125B damage, subsidence + urbanization', rivers: ['Buffalo Bayou', 'San Jacinto'], lastMajorEvent: '2024 Hurricane Beryl' },
  { id: 'us-2', name: 'New Orleans Mississippi Delta', coords: [29.951, -90.072], risk: 'critical', type: 'delta', population: 1300000, country: 'USA', region: 'North America', description: 'Below sea level, levee-dependent -- Katrina legacy zone', rivers: ['Mississippi', 'Atchafalaya'], lastMajorEvent: '2024 hurricane season' },
  { id: 'us-3', name: 'Miami Sea Level Rise Zone', coords: [25.762, -80.192], risk: 'critical', type: 'coastal', population: 6200000, country: 'USA', region: 'North America', description: 'Porous limestone foundation -- king tides + hurricanes', lastMajorEvent: '2024 king tides' },
  { id: 'us-4', name: 'New York City Coastal', coords: [40.713, -74.006], risk: 'high', type: 'coastal', population: 8300000, country: 'USA', region: 'North America', description: 'Hurricane Sandy showed vulnerability -- $19B damage', rivers: ['Hudson', 'East River'], lastMajorEvent: '2024 Nor\'easter' },
  { id: 'us-5', name: 'Mississippi River Valley', coords: [38.627, -90.199], risk: 'high', type: 'river', population: 12000000, country: 'USA', region: 'North America', description: 'St. Louis to Memphis -- 1993 "Great Flood" zone', rivers: ['Mississippi', 'Missouri', 'Ohio'], lastMajorEvent: '2024 spring floods' },
  { id: 'us-6', name: 'Sacramento-San Joaquin Delta', coords: [38.045, -121.730], risk: 'high', type: 'delta', population: 2000000, country: 'USA', region: 'North America', description: 'California atmospheric river flooding -- Oroville Dam area', rivers: ['Sacramento', 'San Joaquin'], lastMajorEvent: '2025 Jan atmospheric river' },
  { id: 'us-7', name: 'Vermont-Northeast Flash Floods', coords: [44.260, -72.575], risk: 'medium', type: 'river', population: 650000, country: 'USA', region: 'North America', description: '2023 Vermont catastrophic flash flooding -- climate intensification', rivers: ['Winooski', 'Lamoille'], lastMajorEvent: '2024 Jul' },
  { id: 'ca-1', name: 'British Columbia Atmospheric Rivers', coords: [49.283, -123.121], risk: 'high', type: 'river', population: 2600000, country: 'Canada', region: 'North America', description: '2021 atmospheric river destroyed highways, displaced thousands', rivers: ['Fraser', 'Coldwater'], lastMajorEvent: '2024 Nov atmospheric river' },
  { id: 'br-1', name: 'Rio Grande do Sul, Brazil', coords: [-30.034, -51.230], risk: 'critical', type: 'river', population: 11000000, country: 'Brazil', region: 'South America', description: '2024 catastrophic floods -- 170+ dead, worst in RS history', rivers: ['Guaíba', 'Jacuí', 'Taquari'], lastMajorEvent: '2024 May megaflood' },
  { id: 'br-2', name: 'São Paulo Tietê Basin', coords: [-23.550, -46.634], risk: 'high', type: 'urban', population: 22000000, country: 'Brazil', region: 'South America', description: 'Mega-city flooding -- channelized rivers overwhelmed', rivers: ['Tietê', 'Pinheiros'], lastMajorEvent: '2025 Jan rains' },
  { id: 'br-3', name: 'Amazon Basin', coords: [-3.119, -60.022], risk: 'high', type: 'river', population: 30000000, country: 'Brazil', region: 'South America', description: 'World\'s largest river -- alternating floods and droughts', rivers: ['Amazon', 'Negro', 'Madeira'], lastMajorEvent: '2024 May record high' },
  { id: 'co-1', name: 'Bogotá & Magdalena Basin', coords: [4.711, -74.072], risk: 'medium', type: 'river', population: 8000000, country: 'Colombia', region: 'South America', description: 'La Niña driven floods -- Magdalena River overflow', rivers: ['Magdalena', 'Bogotá River'], lastMajorEvent: '2024 La Niña' },
  { id: 'pe-1', name: 'Lima-Peru El Niño Zone', coords: [-12.046, -77.043], risk: 'high', type: 'coastal', population: 10000000, country: 'Peru', region: 'South America', description: 'El Niño coastal floods + Andean mudslides', rivers: ['Rímac'], lastMajorEvent: '2024 El Niño' },
  { id: 'ar-1', name: 'Buenos Aires-Paraná Delta', coords: [-34.604, -58.382], risk: 'high', type: 'delta', population: 15000000, country: 'Argentina', region: 'South America', description: 'Sudestada storms + Paraná floods', rivers: ['Paraná', 'Río de la Plata'], lastMajorEvent: '2024 Sudestada' },

  // OCEANIA
  { id: 'au-1', name: 'Brisbane-Lismore Flood Zone', coords: [-27.469, 153.024], risk: 'high', type: 'river', population: 2500000, country: 'Australia', region: 'Oceania', description: '2022 catastrophic floods -- Lismore destroyed, repeated La Niña', rivers: ['Brisbane River', 'Wilsons River'], lastMajorEvent: '2024 La Niña' },
  { id: 'au-2', name: 'Sydney Hawkesbury-Nepean', coords: [-33.749, 150.690], risk: 'high', type: 'river', population: 5300000, country: 'Australia', region: 'Oceania', description: 'Warragamba Dam spilling risk -- western Sydney floodplain', rivers: ['Hawkesbury', 'Nepean'], lastMajorEvent: '2024 east coast low' },
  { id: 'au-3', name: 'Fitzroy-Rockhampton QLD', coords: [-23.380, 150.510], risk: 'medium', type: 'river', population: 200000, country: 'Australia', region: 'Oceania', description: 'Tropical cyclone-driven flooding of Fitzroy River', rivers: ['Fitzroy'], lastMajorEvent: '2024 TC' },
  { id: 'nz-1', name: 'Auckland & Cyclone Gabrielle Zone', coords: [-36.849, 174.764], risk: 'high', type: 'urban', population: 1700000, country: 'New Zealand', region: 'Oceania', description: '2023 Cyclone Gabrielle devastation -- Hawke\'s Bay + Auckland', lastMajorEvent: '2024 ex-tropical cyclone' },
  { id: 'fj-1', name: 'Fiji Cyclone Belt', coords: [-18.142, 178.442], risk: 'high', type: 'typhoon', population: 900000, country: 'Fiji', region: 'Pacific Islands', description: 'Category 5 cyclones + sea level rise threatening existence', lastMajorEvent: '2024 TC' },

  // MIDDLE EAST & CENTRAL ASIA
  { id: 'af-1', name: 'Afghanistan Flash Floods', coords: [34.520, 69.172], risk: 'critical', type: 'monsoon', population: 40000000, country: 'Afghanistan', region: 'Central Asia', description: 'Deforestation + climate change = lethal flash floods in valleys', rivers: ['Kabul River', 'Hari River'], lastMajorEvent: '2024 May -- 300+ dead' },
  { id: 'ir-1', name: 'Iran Sistan-Baluchestan Floods', coords: [29.497, 60.862], risk: 'high', type: 'monsoon', population: 3000000, country: 'Iran', region: 'Middle East', description: 'Arid region flash floods -- rain on parched land', lastMajorEvent: '2024 winter' },
  { id: 'ae-1', name: 'Dubai-UAE Desert Flash Floods', coords: [25.205, 55.270], risk: 'medium', type: 'urban', population: 3500000, country: 'UAE', region: 'Middle East', description: '2024 unprecedented rainfall -- year\'s rain in 24hrs', lastMajorEvent: '2024 Apr record rain' },
  { id: 'tr-1', name: 'Istanbul Bosphorus Floods', coords: [41.009, 28.978], risk: 'medium', type: 'urban', population: 16000000, country: 'Turkey', region: 'Middle East', description: 'Mediterranean climate intensification + rapid urbanization', lastMajorEvent: '2024 Sep' },
]

//MAJOR WORLD RIVERS -- Visualization polylines for map rendering
export const GLOBAL_RIVERS: GlobalRiver[] = [
  { id: 'r-nile', name: 'Nile', coords: [26.82, 30.80], path: [[31.20, 30.05], [30.05, 31.23], [26.82, 30.80], [24.09, 32.90], [15.60, 32.53], [9.02, 33.40], [4.85, 31.60], [0.32, 32.58]], country: 'Egypt/Sudan/Uganda', lengthKm: 6650, floodRisk: 'high', basinPopulationMillions: 257, description: 'World\'s longest river -- Aswan Dam controls flooding' },
  { id: 'r-amazon', name: 'Amazon', coords: [-3.12, -60.02], path: [[-1.45, -48.50], [-2.50, -54.70], [-3.12, -60.02], [-3.45, -65.00], [-4.30, -70.00], [-5.18, -73.50], [-10.00, -75.00]], country: 'Brazil/Peru', lengthKm: 6400, floodRisk: 'high', basinPopulationMillions: 30, description: 'World\'s largest discharge river -- seasonal floods inundate millions of km²' },
  { id: 'r-yangtze', name: 'Yangtze', coords: [30.57, 114.28], path: [[31.24, 121.47], [30.57, 114.28], [29.56, 106.55], [30.67, 104.07], [26.58, 101.71], [33.00, 97.00]], country: 'China', lengthKm: 6300, floodRisk: 'critical', basinPopulationMillions: 400, description: 'Three Gorges Dam -- Asia\'s longest river, devastating flood history' },
  { id: 'r-mississippi', name: 'Mississippi-Missouri', coords: [38.63, -90.20], path: [[29.15, -89.25], [30.00, -90.07], [35.15, -90.05], [38.63, -90.20], [41.50, -90.58], [44.95, -93.10], [47.00, -95.00]], country: 'USA', lengthKm: 6275, floodRisk: 'high', basinPopulationMillions: 80, description: 'North America\'s great river -- 1993 & 2011 megafloods' },
  { id: 'r-ganges', name: 'Ganges-Brahmaputra', coords: [23.68, 90.36], path: [[22.50, 88.35], [23.68, 90.36], [25.28, 87.00], [25.61, 85.14], [27.50, 83.00], [30.00, 78.50], [30.92, 78.78]], country: 'India/Bangladesh', lengthKm: 2525, floodRisk: 'critical', basinPopulationMillions: 650, description: 'Sacred river -- annual monsoon floods displace millions' },
  { id: 'r-congo', name: 'Congo', coords: [-4.32, 15.31], path: [[-4.30, 15.28], [-2.00, 18.00], [0.50, 21.00], [-1.00, 24.00], [-4.00, 26.00], [-8.00, 28.00], [-11.00, 27.00]], country: 'DRC/RC', lengthKm: 4700, floodRisk: 'high', basinPopulationMillions: 95, description: 'World\'s deepest river -- Congo Basin flooding affects Central Africa' },
  { id: 'r-mekong', name: 'Mekong', coords: [13.50, 104.50], path: [[10.05, 105.75], [11.55, 104.92], [13.36, 103.86], [15.12, 105.80], [17.97, 102.63], [21.00, 100.08], [28.00, 97.50]], country: 'Vietnam/Cambodia/Laos/Thailand', lengthKm: 4350, floodRisk: 'high', basinPopulationMillions: 65, description: 'Southeast Asia lifeline -- dams upstream reducing natural flood pulse' },
  { id: 'r-danube', name: 'Danube', coords: [47.50, 19.04], path: [[45.15, 29.60], [44.42, 26.10], [44.80, 20.46], [47.50, 19.04], [48.14, 16.95], [48.21, 16.37], [48.57, 13.45], [48.74, 8.97]], country: 'Multi-nation Europe', lengthKm: 2850, floodRisk: 'high', basinPopulationMillions: 83, description: 'Europe\'s 2nd longest -- 10 countries, recurring flood disasters' },
  { id: 'r-rhine', name: 'Rhine', coords: [50.94, 6.96], path: [[51.89, 4.50], [51.45, 6.77], [50.94, 6.96], [50.00, 8.27], [49.00, 8.40], [47.56, 7.59], [46.95, 6.86]], country: 'Germany/Netherlands/Switzerland', lengthKm: 1230, floodRisk: 'high', basinPopulationMillions: 58, description: 'Most important European waterway -- 1995 near-catastrophic flood' },
  { id: 'r-indus', name: 'Indus', coords: [27.71, 68.86], path: [[24.85, 67.32], [27.71, 68.86], [30.20, 71.47], [32.08, 72.68], [34.02, 72.33], [35.92, 74.31], [34.46, 77.60]], country: 'Pakistan/India', lengthKm: 3180, floodRisk: 'critical', basinPopulationMillions: 230, description: '2022 Pakistan superfloods displaced 33M people' },
  { id: 'r-niger', name: 'Niger', coords: [13.52, 2.11], path: [[4.38, 6.00], [6.46, 3.39], [9.06, 7.49], [13.52, 2.11], [16.27, -0.01], [14.69, -3.50], [11.35, -8.00], [9.95, -10.80]], country: 'Nigeria/Niger/Mali', lengthKm: 4180, floodRisk: 'high', basinPopulationMillions: 100, description: 'West Africa\'s great river -- Inner Niger Delta seasonal floods' },
  { id: 'r-zambezi', name: 'Zambezi', coords: [-15.41, 28.29], path: [[-18.02, 35.31], [-15.80, 35.00], [-15.41, 28.29], [-17.92, 25.85], [-12.00, 25.00], [-13.50, 23.50]], country: 'Zambia/Mozambique', lengthKm: 2574, floodRisk: 'high', basinPopulationMillions: 40, description: 'Victoria Falls river -- Mozambique delta cyclone flooding' },
  { id: 'r-murray', name: 'Murray-Darling', coords: [-34.18, 142.16], path: [[-35.12, 138.81], [-34.18, 142.16], [-35.93, 145.04], [-36.37, 148.01], [-36.07, 149.13]], country: 'Australia', lengthKm: 3672, floodRisk: 'medium', basinPopulationMillions: 3, description: 'Australia\'s food bowl river -- 2022 record floods after years of drought' },
  { id: 'r-parana', name: 'Paraná-Río de la Plata', coords: [-34.60, -58.38], path: [[-34.60, -58.38], [-33.75, -59.65], [-31.63, -60.70], [-27.10, -58.83], [-25.28, -57.63], [-24.05, -54.59], [-20.00, -51.00]], country: 'Argentina/Brazil/Paraguay', lengthKm: 4880, floodRisk: 'high', basinPopulationMillions: 75, description: 'South America\'s second river system -- Itaipu Dam mega-watershed' },
]

//GLOBAL MONITORING STATIONS -- Simulated worldwide gauge network
export const GLOBAL_STATIONS: GlobalMonitoringStation[] = [
  //Asia
  { id: 'gs-1', name: 'Farakka Barrage', coords: [24.81, 87.92], country: 'India', type: 'river_gauge', status: 'warning', waterLevel: 8.2, maxLevel: 10.0, trend: 'rising' },
  { id: 'gs-2', name: 'Wuhan Yangtze Gauge', coords: [30.58, 114.28], country: 'China', type: 'river_gauge', status: 'active', waterLevel: 26.5, maxLevel: 29.7, trend: 'stable' },
  { id: 'gs-3', name: 'Dhaka Buriganga', coords: [23.72, 90.41], country: 'Bangladesh', type: 'river_gauge', status: 'alert', waterLevel: 6.8, maxLevel: 7.1, trend: 'rising' },
  { id: 'gs-4', name: 'Phnom Penh Mekong', coords: [11.57, 104.92], country: 'Cambodia', type: 'river_gauge', status: 'active', waterLevel: 9.1, maxLevel: 12.0, trend: 'stable' },
  { id: 'gs-5', name: 'Sukkur Indus Barrage', coords: [27.71, 68.86], country: 'Pakistan', type: 'river_gauge', status: 'warning', waterLevel: 7.5, maxLevel: 8.5, trend: 'rising' },
  { id: 'gs-6', name: 'Tokyo Bay Tide', coords: [35.63, 139.77], country: 'Japan', type: 'tide_gauge', status: 'active', waterLevel: 1.2, maxLevel: 3.5, trend: 'stable' },
  { id: 'gs-7', name: 'Manila Bay Monitor', coords: [14.58, 120.97], country: 'Philippines', type: 'tide_gauge', status: 'warning', waterLevel: 1.8, maxLevel: 2.5, trend: 'rising' },
  { id: 'gs-8', name: 'Krung Thep Chao Phraya', coords: [13.72, 100.52], country: 'Thailand', type: 'river_gauge', status: 'active', waterLevel: 1.9, maxLevel: 2.5, trend: 'stable' },
  //Europe
  { id: 'gs-9', name: 'Cologne Rhine Gauge', coords: [50.94, 6.96], country: 'Germany', type: 'river_gauge', status: 'active', waterLevel: 4.2, maxLevel: 10.7, trend: 'stable' },
  { id: 'gs-10', name: 'Budapest Danube', coords: [47.50, 19.04], country: 'Hungary', type: 'river_gauge', status: 'active', waterLevel: 3.5, maxLevel: 8.9, trend: 'stable' },
  { id: 'gs-11', name: 'Rotterdam Maeslantkering', coords: [51.96, 4.17], country: 'Netherlands', type: 'tide_gauge', status: 'active', waterLevel: 0.3, maxLevel: 3.0, trend: 'stable' },
  { id: 'gs-12', name: 'Thames Barrier', coords: [51.50, 0.04], country: 'UK', type: 'tide_gauge', status: 'active', waterLevel: 2.1, maxLevel: 6.9, trend: 'stable' },
  { id: 'gs-13', name: 'Venice MOSE', coords: [45.33, 12.31], country: 'Italy', type: 'tide_gauge', status: 'active', waterLevel: 0.9, maxLevel: 1.4, trend: 'stable' },
  { id: 'gs-14', name: 'Paris Austerlitz Seine', coords: [48.84, 2.37], country: 'France', type: 'river_gauge', status: 'active', waterLevel: 2.1, maxLevel: 8.6, trend: 'stable' },
  //Americas
  { id: 'gs-15', name: 'New Orleans Mississippi', coords: [29.95, -90.07], country: 'USA', type: 'river_gauge', status: 'active', waterLevel: 4.8, maxLevel: 6.1, trend: 'stable' },
  { id: 'gs-16', name: 'St. Louis Mississippi', coords: [38.63, -90.18], country: 'USA', type: 'river_gauge', status: 'active', waterLevel: 7.6, maxLevel: 15.1, trend: 'falling' },
  { id: 'gs-17', name: 'Houston Buffalo Bayou', coords: [29.76, -95.37], country: 'USA', type: 'river_gauge', status: 'active', waterLevel: 1.1, maxLevel: 4.0, trend: 'stable' },
  { id: 'gs-18', name: 'Miami Beach Tide', coords: [25.79, -80.13], country: 'USA', type: 'tide_gauge', status: 'active', waterLevel: 0.5, maxLevel: 2.0, trend: 'rising' },
  { id: 'gs-19', name: 'Porto Alegre Guaíba', coords: [-30.03, -51.23], country: 'Brazil', type: 'river_gauge', status: 'warning', waterLevel: 3.2, maxLevel: 3.6, trend: 'rising' },
  { id: 'gs-20', name: 'Manaus Negro', coords: [-3.12, -60.02], country: 'Brazil', type: 'river_gauge', status: 'active', waterLevel: 25.0, maxLevel: 29.97, trend: 'stable' },
  //Africa
  { id: 'gs-21', name: 'Aswan High Dam', coords: [24.03, 32.88], country: 'Egypt', type: 'river_gauge', status: 'active', waterLevel: 176.0, maxLevel: 182.0, trend: 'stable' },
  { id: 'gs-22', name: 'Khartoum Nile Confluence', coords: [15.60, 32.53], country: 'Sudan', type: 'river_gauge', status: 'warning', waterLevel: 16.2, maxLevel: 17.5, trend: 'rising' },
  { id: 'gs-23', name: 'Lokoja Niger-Benue', coords: [7.80, 6.74], country: 'Nigeria', type: 'river_gauge', status: 'alert', waterLevel: 9.8, maxLevel: 10.5, trend: 'rising' },
  //Oceania
  { id: 'gs-24', name: 'Brisbane River Gauge', coords: [-27.47, 153.02], country: 'Australia', type: 'river_gauge', status: 'active', waterLevel: 1.2, maxLevel: 4.5, trend: 'stable' },
  { id: 'gs-25', name: 'Sydney Harbour Tide', coords: [-33.86, 151.21], country: 'Australia', type: 'tide_gauge', status: 'active', waterLevel: 0.8, maxLevel: 2.1, trend: 'stable' },
]

//HELPER -- Risk color mapping
export const RISK_COLORS = {
  critical: '#ff0040',
  high: '#ff4400',
  medium: '#ffaa00',
  low: '#00cc66',
} as const

export const STATION_COLORS = {
  active: '#00cc66',
  warning: '#ffaa00',
  alert: '#ff0040',
  offline: '#666666',
} as const

export const TYPE_ICONS: Record<GlobalFloodZone['type'], string> = {
  river: 'Waves',
  coastal: 'Anchor',
  urban: 'Building',
  monsoon: 'CloudRain',
  glacier: 'Mountain',
  dam: 'Construction',
  delta: 'Triangle',
  typhoon: 'Wind',
}
