/**
 * Module: GroupedCountryPicker.tsx
 *
 * Grouped country picker shared component (reusable UI element used across pages).
 *
 * How it connects:
 * - Used across both admin and citizen interfaces */

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { CONTINENT_GROUPS, ALL_COUNTRIES, REGION_MAP, type CountryEntry } from '../../data/allCountries'

interface GroupedCountryPickerProps {
  value: string
  onChange: (country: string) => void
  placeholder?: string
  className?: string
  darkMode?: boolean
  disabled?: boolean
  id?: string
  label?: string
}

export default function GroupedCountryPicker({
  value,
  onChange,
  placeholder = 'Select a country...',
  className = '',
  darkMode = false,
  disabled = false,
  id,
  label,
}: GroupedCountryPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on click outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Get selected entry
  const selected = useMemo(() => {
    if (!value) return null
    return ALL_COUNTRIES.find(c => c.name === value) || null
  }, [value])

  // Filter countries by search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return CONTINENT_GROUPS
    const q = search.toLowerCase()
    return CONTINENT_GROUPS.map(g => ({
      ...g,
      countries: g.countries.filter(c => c.name.toLowerCase().includes(q)),
    })).filter(g => g.countries.length > 0)
  }, [search])

  const bg = darkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'
  const dropBg = darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-blue-50'
  const headerBg = darkMode ? 'bg-gray-900 text-gray-400' : 'bg-gray-100 text-gray-600'

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label htmlFor={id} className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50) }}
        className={`w-full px-3 py-2 rounded-lg border text-left flex items-center justify-between ${bg} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? `${selected.flag} ${selected.name}` : placeholder}
        </span>
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`absolute z-50 w-full mt-1 rounded-lg border shadow-lg max-h-72 overflow-hidden flex flex-col ${dropBg}`}>
          <div className="p-2 border-b border-gray-200">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search countries..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`w-full px-3 py-1.5 rounded border text-sm ${bg} focus:outline-none focus:ring-2 focus:ring-aegis-400`}
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredGroups.length === 0 ? (
              <div className="p-3 text-center text-sm text-gray-400">No countries found</div>
            ) : (
              filteredGroups.map(group => (
                <div key={group.name}>
                  <div className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider sticky top-0 ${headerBg}`}>
                    {group.emoji} {group.name} ({group.countries.length})
                  </div>
                  {group.countries.map(c => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => { onChange(c.name); setOpen(false); setSearch('') }}
                      className={`w-full px-4 py-1.5 text-left text-sm flex items-center gap-2 ${hoverBg} ${value === c.name ? (darkMode ? 'bg-blue-900/40' : 'bg-blue-100') : ''}`}
                    >
                      <span className="text-base">{c.flag}</span>
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Region picker companion
interface RegionPickerProps {
  country: string
  value: string
  onChange: (region: string) => void
  darkMode?: boolean
  className?: string
}

export function RegionPicker({ country, value, onChange, darkMode = false, className = '' }: RegionPickerProps) {
  const regions = REGION_MAP[country]
  const bg = darkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'

  if (!regions || regions.length === 0) {
    // Free-text input for countries without predefined regions
    return (
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Enter your region or city..."
        className={`w-full px-3 py-2 rounded-lg border ${bg} ${className}`}
      />
    )
  }

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full px-3 py-2 rounded-lg border ${bg} ${className}`}
    >
      <option value="">Select a region...</option>
      {regions.map(r => (
        <option key={r.value} value={r.label}>{r.label}</option>
      ))}
    </select>
  )
}
