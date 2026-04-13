/** MapPlaceholder — visual stand-in for Leaflet maps in this prototype */
export default function MapPlaceholder({ height = '400px', label = 'Live Operations Map' }: { height?: string; label?: string }) {
  return (
    <div className="map-placeholder rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden" style={{ height }}>
      {/* Grid dots */}
      <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(100,160,255,0.12) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      {/* Fake markers */}
      <div className="absolute top-[30%] left-[25%] w-3 h-3 rounded-full bg-red-500 shadow-lg shadow-red-500/50 animate-pulse" />
      <div className="absolute top-[45%] left-[55%] w-3 h-3 rounded-full bg-amber-500 shadow-lg shadow-amber-500/50 animate-pulse" style={{ animationDelay: '0.5s' }} />
      <div className="absolute top-[60%] left-[40%] w-3 h-3 rounded-full bg-green-500 shadow-lg shadow-green-500/40" />
      <div className="absolute top-[25%] left-[70%] w-3 h-3 rounded-full bg-blue-500 shadow-lg shadow-blue-500/40" />
      {/* Pulsing ring on critical */}
      <div className="absolute top-[30%] left-[25%] w-8 h-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-400/50 animate-pulse-ring" />
      {/* Label */}
      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] font-bold text-white tracking-wide">{label}</span>
      </div>
      {/* Zoom controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-1">
        <div className="w-8 h-8 bg-white/90 dark:bg-gray-800/90 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-300 text-sm font-bold shadow">+</div>
        <div className="w-8 h-8 bg-white/90 dark:bg-gray-800/90 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-300 text-sm font-bold shadow">−</div>
      </div>
      {/* Tile switch */}
      <div className="absolute top-4 left-4 flex gap-1">
        {['Map', 'Satellite', 'Terrain'].map((t, i) => (
          <button key={t} className={`px-2 py-1 rounded text-[9px] font-bold ${i === 0 ? 'bg-aegis-600 text-white' : 'bg-black/40 text-white/70 hover:bg-black/60'}`}>{t}</button>
        ))}
      </div>
    </div>
  )
}
