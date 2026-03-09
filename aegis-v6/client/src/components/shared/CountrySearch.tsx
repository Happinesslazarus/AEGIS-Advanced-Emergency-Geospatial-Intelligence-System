/**
 * CountrySearch.tsx — Searchable dropdown for selecting a country
 * and its international dialling code during phone number input.
 */

import { useState, useRef, useEffect } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'
import type { CountryCode } from '../../data/countryCodes'

interface Props {
  countries: CountryCode[]
  selected: CountryCode
  onChange: (country: CountryCode) => void
  className?: string
}

export default function CountrySearch({ countries, selected, onChange, className = '' }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? countries.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.dial.includes(query) ||
        c.code.toLowerCase().includes(query.toLowerCase())
      )
    : countries

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
    }
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-aegis-400 transition-colors min-w-[150px] w-full"
      >
        <span className="text-base leading-none">{selected.flag}</span>
        <span className="font-medium text-blue-600 dark:text-blue-400">{selected.dial}</span>
        <span className="text-gray-500 truncate text-xs flex-1 text-left">{selected.name}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type country name or +code..."
              className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {/* Country list */}
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No countries found</p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => { onChange(c); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors text-left ${c.code === selected.code ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}
                >
                  <span className="text-base leading-none w-6 flex-shrink-0">{c.flag}</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400 w-12 flex-shrink-0 text-xs">{c.dial}</span>
                  <span className="truncate text-gray-700 dark:text-gray-300 text-xs">{c.name}</span>
                  {c.code === selected.code && (
                    <span className="ml-auto text-blue-500 text-[10px] font-bold flex-shrink-0">✓</span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="text-[9px] text-gray-400 text-center py-1 border-t border-gray-100 dark:border-gray-800">
            {filtered.length} of {countries.length} countries
          </div>
        </div>
      )}
    </div>
  )
}
