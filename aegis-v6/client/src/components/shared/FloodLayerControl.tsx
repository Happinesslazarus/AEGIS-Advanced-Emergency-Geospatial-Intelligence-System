/**
 * FloodLayerControl.tsx — Toggle panel for WMS flood zone layers,
 * flood prediction extents, and evacuation routes.
 *
 * Floating panel that sits on top of the map, allowing users to
 * control which flood data layers are visible.
 */

import { useState, useEffect } from 'react'
import {
  Layers, ChevronDown, ChevronUp, Eye, EyeOff,
  Droplets, Navigation, AlertTriangle, Zap, Map
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface FloodLayer {
  id: string
  name: string
  type: 'wms' | 'prediction' | 'evacuation' | 'extent'
  enabled: boolean
  icon: any
  colour: string
  description?: string
}

interface Props {
  onLayerChange?: (layerId: string, enabled: boolean) => void
  className?: string
}

const DEFAULT_LAYERS: FloodLayer[] = [
  { id: 'wms_fluvial_high', name: 'Fluvial Flood (High)', type: 'wms', enabled: true, icon: Droplets, colour: 'text-blue-400', description: '1 in 10 year return period' },
  { id: 'wms_fluvial_medium', name: 'Fluvial Flood (Medium)', type: 'wms', enabled: false, icon: Droplets, colour: 'text-cyan-400', description: '1 in 200 year return period' },
  { id: 'wms_surface', name: 'Surface Water', type: 'wms', enabled: false, icon: Droplets, colour: 'text-teal-400', description: 'Surface water flooding' },
  { id: 'wms_coastal', name: 'Coastal Flood', type: 'wms', enabled: false, icon: Droplets, colour: 'text-indigo-400', description: 'Coastal / tidal flooding' },
  { id: 'prediction_1h', name: 'Prediction: 1 Hour', type: 'prediction', enabled: false, icon: Zap, colour: 'text-yellow-400', description: 'Predicted flood extent in 1 hour' },
  { id: 'prediction_4h', name: 'Prediction: 4 Hours', type: 'prediction', enabled: false, icon: Zap, colour: 'text-orange-400', description: 'Predicted flood extent in 4 hours' },
  { id: 'prediction_6h', name: 'Prediction: 6 Hours', type: 'prediction', enabled: false, icon: Zap, colour: 'text-red-400', description: 'Predicted flood extent in 6 hours' },
  { id: 'evacuation', name: 'Evacuation Routes', type: 'evacuation', enabled: false, icon: Navigation, colour: 'text-green-400', description: 'Pre-calculated evacuation corridors' },
]

export default function FloodLayerControl({ onLayerChange, className = '' }: Props): JSX.Element {
  const lang = useLanguage()
  const [layers, setLayers] = useState<FloodLayer[]>(DEFAULT_LAYERS)
  const [expanded, setExpanded] = useState(false)
  const [activeCount, setActiveCount] = useState(1)

  useEffect(() => {
    setActiveCount(layers.filter(l => l.enabled).length)
  }, [layers])

  const toggleLayer = (id: string) => {
    setLayers(prev => prev.map(l => {
      if (l.id === id) {
        const newState = !l.enabled
        onLayerChange?.(id, newState)
        return { ...l, enabled: newState }
      }
      return l
    }))
  }

  const enableAll = () => {
    setLayers(prev => prev.map(l => {
      if (!l.enabled) onLayerChange?.(l.id, true)
      return { ...l, enabled: true }
    }))
  }

  const disableAll = () => {
    setLayers(prev => prev.map(l => {
      if (l.enabled) onLayerChange?.(l.id, false)
      return { ...l, enabled: false }
    }))
  }

  const groupedLayers = {
    'Flood Zones (WMS)': layers.filter(l => l.type === 'wms'),
    'Predictions': layers.filter(l => l.type === 'prediction'),
    'Evacuation': layers.filter(l => l.type === 'evacuation'),
  }

  return (
    <div className={`bg-white dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700/60 rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ${className}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-600">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('floodLayer.floodLayers', lang)}</h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{activeCount} {t('floodLayer.active', lang)}</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" /> : <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-700/40">
          {/* Quick actions */}
          <div className="px-4 py-2 flex gap-2 border-b border-gray-100 dark:border-gray-700/30">
            <button onClick={enableAll} className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition">{t('floodLayer.showAll', lang)}</button>
            <button onClick={disableAll} className="text-[10px] text-gray-600 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700/50 transition">{t('floodLayer.hideAll', lang)}</button>
          </div>

          {/* Grouped layers */}
          <div className="max-h-[350px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
            {Object.entries(groupedLayers).map(([group, items]) => (
              <div key={group}>
                <div className="px-4 py-1.5 bg-gray-100 dark:bg-gray-800/40">
                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wider">{group}</span>
                </div>
                {items.map(layer => (
                  <button
                    key={layer.id}
                    onClick={() => toggleLayer(layer.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800/40 transition-colors text-left ${layer.enabled ? '' : 'opacity-50'}`}
                  >
                    {/* Toggle eye */}
                    <div className="flex-shrink-0">
                      {layer.enabled ? (
                        <Eye className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
                      )}
                    </div>
                    
                    {/* Icon */}
                    <layer.icon className={`w-3.5 h-3.5 flex-shrink-0 ${layer.colour}`} />
                    
                    {/* Label */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-800 dark:text-white truncate">{layer.name}</p>
                      {layer.description && (
                        <p className="text-[9px] text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 truncate">{layer.description}</p>
                      )}
                    </div>

                    {/* Status badge */}
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${layer.enabled ? 'bg-green-400' : 'bg-gray-600'}`} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}




