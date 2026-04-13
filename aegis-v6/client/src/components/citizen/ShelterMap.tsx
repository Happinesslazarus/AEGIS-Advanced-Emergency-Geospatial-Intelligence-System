import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Layers, Navigation2, Satellite, Map as MapIcon, Mountain, Footprints, MapPinned } from 'lucide-react'

interface Shelter {
  id: string
  name: string
  type: 'shelter' | 'hospital' | 'fire_station' | 'community_centre' | 'school'
  lat: number
  lng: number
  address: string
  distance?: number
  isOpen: boolean
  occupancy: number
  capacity: number
}

interface Props {
  origin: { lat: number; lng: number }
  shelters: Shelter[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

type TileLayerKey = 'street' | 'satellite' | 'terrain' | 'dark'

const TILE_LAYERS: Record<TileLayerKey, { url: string; attribution: string; label: string }> = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    label: 'Street',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>, Maxar, GeoEye',
    label: 'Satellite',
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    label: 'Terrain',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com">CARTO</a>',
    label: 'Dark',
  },
}

const TYPE_COLORS: Record<string, string> = {
  shelter: '#10b981',
  hospital: '#ef4444',
  fire_station: '#f59e0b',
  community_centre: '#3b82f6',
  school: '#8b5cf6',
}

/* Inline SVG paths from Lucide icons — used in marker DivIcons where React components can't render */
const TYPE_SVGS: Record<string, string> = {
  shelter: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
  hospital: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v12"/><path d="M6 12h12"/></svg>',
  fire_station: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.5-2.52 1.5-3.5L8 9l.5 5.5z"/></svg>',
  community_centre: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  school: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>',
}

const TYPE_LABELS: Record<string, string> = {
  shelter: 'Shelter',
  hospital: 'Hospital',
  fire_station: 'Fire Station',
  community_centre: 'Community',
  school: 'School',
}

function safetyPct(s: Shelter): number {
  if (s.capacity <= 0) return 0
  return Math.round(((s.capacity - s.occupancy) / s.capacity) * 100)
}

const DEFAULT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>'

function createIcon(type: string, isSelected: boolean, isOpen: boolean): L.DivIcon {
  const color = TYPE_COLORS[type] || '#6b7280'
  const svgIcon = TYPE_SVGS[type] || DEFAULT_SVG
  const size = isSelected ? 44 : 34
  const iconSize = Math.round(size * 0.5)
  const pulse = isSelected
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};opacity:0.5;animation:ping 1.2s cubic-bezier(0,0,0.2,1) infinite;"></div>`
    : ''
  const closedOverlay = !isOpen
    ? `<div style="position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid white;display:flex;align-items:center;justify-content:center;"><svg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3'><path d='M18 6 6 18'/><path d='m6 6 12 12'/></svg></div>`
    : `<div style="position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#10b981;border:2px solid white;"></div>`
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        ${pulse}
        <div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px;background:${color};border:3px solid white;box-shadow:0 4px 14px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;transition:all 0.2s;${isSelected ? 'transform:scale(1.1);' : ''}">
          <div style="width:${iconSize}px;height:${iconSize}px;">${svgIcon}</div>
        </div>
        ${closedOverlay}
      </div>`,
  })
}

const userIcon = L.divIcon({
  className: '',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  html: `
    <div style="position:relative;width:26px;height:26px;">
      <div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid #3b82f6;opacity:0.4;animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#1d4ed8);border:3px solid white;box-shadow:0 2px 10px rgba(59,130,246,0.5);display:flex;align-items:center;justify-content:center;">
        <div style="width:8px;height:8px;border-radius:50%;background:white;"></div>
      </div>
    </div>`,
})

function FitBounds({ origin, shelters }: { origin: { lat: number; lng: number }; shelters: Shelter[] }) {
  const map = useMap()
  useMemo(() => {
    const bounds = L.latLngBounds([[origin.lat, origin.lng]])
    shelters.slice(0, 20).forEach(s => bounds.extend([s.lat, s.lng]))
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 })
    }
  }, [map, origin, shelters])
  return null
}

function TileLayerSwitcher({ active, onChange }: { active: TileLayerKey; onChange: (k: TileLayerKey) => void }) {
  const [open, setOpen] = useState(false)
  const icons: Record<TileLayerKey, JSX.Element> = {
    street: <MapIcon className="w-3.5 h-3.5" />,
    satellite: <Satellite className="w-3.5 h-3.5" />,
    terrain: <Mountain className="w-3.5 h-3.5" />,
    dark: <Layers className="w-3.5 h-3.5" />,
  }
  return (
    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'white', borderRadius: 8, padding: '6px 10px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer' }}
        title="Switch map layer"
      >
        <Layers className="w-3.5 h-3.5" /> {TILE_LAYERS[active].label}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 36, right: 0, background: 'white', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.18)', overflow: 'hidden', minWidth: 120, border: '1px solid #e5e7eb' }}>
          {(Object.keys(TILE_LAYERS) as TileLayerKey[]).map(k => (
            <button
              key={k}
              onClick={() => { onChange(k); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: k === active ? 700 : 400, background: k === active ? '#f0fdf4' : 'transparent', color: k === active ? '#059669' : '#374151', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              {icons[k]} {TILE_LAYERS[k].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ShelterMap({ origin, shelters, selectedId, onSelect }: Props) {
  const [activeLayer, setActiveLayer] = useState<TileLayerKey>('street')
  const layer = TILE_LAYERS[activeLayer]

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {/* Ping animation keyframe injected once */}
      <style>{`@keyframes ping{75%,100%{transform:scale(2);opacity:0}}`}</style>

      <MapContainer
        center={[origin.lat, origin.lng]}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer attribution={layer.attribution} url={layer.url} />
        <FitBounds origin={origin} shelters={shelters} />

        {/* User location beacon */}
        <Marker position={[origin.lat, origin.lng]} icon={userIcon}>
          <Popup>
            <div style={{ minWidth: 140, fontSize: 13 }}>
              <strong>Your Location</strong>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}</div>
            </div>
          </Popup>
        </Marker>
        <Circle
          center={[origin.lat, origin.lng]}
          radius={150}
          pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.12, weight: 2, dashArray: '4 4' }}
        />

        {/* Shelter markers */}
        {shelters.map(s => {
          const pct = safetyPct(s)
          const distText = s.distance != null ? `${s.distance.toFixed(1)} km away` : ''
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={createIcon(s.type, s.id === selectedId, s.isOpen)}
              eventHandlers={{ click: () => onSelect(s.id === selectedId ? null : s.id) }}
            >
              <Popup>
                <div style={{ minWidth: 200, fontSize: 12, lineHeight: 1.5 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: TYPE_COLORS[s.type] || '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 6 }}>
                      <div style={{ width: 18, height: 18 }} dangerouslySetInnerHTML={{ __html: TYPE_SVGS[s.type] || DEFAULT_SVG }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 1 }}>{s.name}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: TYPE_COLORS[s.type] + '22', color: TYPE_COLORS[s.type], fontWeight: 600 }}>{TYPE_LABELS[s.type] || s.type}</span>
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: s.isOpen ? '#dcfce7' : '#fee2e2', color: s.isOpen ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{s.isOpen ? '● Open' : '✕ Closed'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Address */}
                  {s.address && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, paddingLeft: 2 }}>{s.address}</div>
                  )}

                  {/* Stats row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                    {distText && (
                      <div style={{ background: '#f0fdf4', borderRadius: 6, padding: '4px 8px', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#059669' }}>{s.distance!.toFixed(1)}</div>
                        <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>km away</div>
                      </div>
                    )}
                    {s.capacity > 0 && (
                      <div style={{ background: '#eff6ff', borderRadius: 6, padding: '4px 8px', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6' }}>{pct}%</div>
                        <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>available</div>
                      </div>
                    )}
                  </div>

                  {/* Capacity bar */}
                  {s.capacity > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280', marginBottom: 3 }}>
                        <span>Capacity</span>
                        <span>{s.occupancy}/{s.capacity}</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, s.capacity > 0 ? (s.occupancy / s.capacity) * 100 : 0)}%`, background: pct > 50 ? '#10b981' : pct > 20 ? '#f59e0b' : '#ef4444', borderRadius: 99, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  )}

                  {/* Action links */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: '#059669', color: 'white', borderRadius: 7, padding: '5px 8px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}
                    >
                      <Navigation2 size={11} /> Drive
                    </a>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: '#3b82f6', color: 'white', borderRadius: 7, padding: '5px 8px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}
                    >
                      <Footprints size={11} /> Walk
                    </a>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', color: '#374151', borderRadius: 7, padding: '5px 8px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}
                      title="View on OSM"
                    >
                      <MapPinned size={11} />
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>

      {/* Tile layer switcher — rendered outside MapContainer for proper z-index */}
      <TileLayerSwitcher active={activeLayer} onChange={setActiveLayer} />
    </div>
  )
}
