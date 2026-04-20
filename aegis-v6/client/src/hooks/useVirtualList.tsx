/**
 * useVirtualList custom React hook (virtual list logic).
 *
 * - Used by React components that need this functionality */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'

export interface VirtualItem {
  index: number
  start: number
  size: number
  key: string | number
}

export interface UseVirtualListOptions {
  /** Total number of items */
  count: number
  /** Estimated item height (used for initial calculation) */
  estimateSize: number | ((index: number) => number)
  /** Number of items to render outside visible area */
  overscan?: number
  /** Unique key generator for items */
  getItemKey?: (index: number) => string | number
  /** Horizontal scrolling instead of vertical */
  horizontal?: boolean
}

export interface UseVirtualListResult {
  /** Array of virtual items to render */
  virtualItems: VirtualItem[]
  /** Total size of all items (for scroll container) */
  totalSize: number
  /** Ref to attach to scroll container */
  containerRef: React.RefObject<HTMLDivElement>
  /** Scroll to a specific index */
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end' }) => void
  /** Measure a specific item after render */
  measureItem: (index: number, size: number) => void
}

export function useVirtualList({
  count,
  estimateSize,
  overscan = 3,
  getItemKey = (i) => i,
  horizontal = false,
}: UseVirtualListOptions): UseVirtualListResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [containerSize, setContainerSize] = useState(0)
  
  // Store measured sizes for dynamic heights.
  // When items have different heights (e.g. variable-length alert cards), we
  // record the actual rendered height the first time each item is visible so
  // future scroll calculations use the real value instead of the estimate.
  const measuredSizes = useRef<Map<number, number>>(new Map())
  
  // Get size for an item (measured or estimated).
  // Falls back to the caller-supplied estimateSize function/constant when an
  // item hasn't been rendered yet (not yet in the visible window).
  const getSize = useCallback((index: number): number => {
    const measured = measuredSizes.current.get(index)
    if (measured !== undefined) return measured
    return typeof estimateSize === 'function' ? estimateSize(index) : estimateSize
  }, [estimateSize])
  
  // Pre-calculate cumulative offset for each item (its top position in pixels)
  // and the total scroll height needed to fit all items.
  // itemOffsets[i] = sum of heights of items 0 to i-1.
  const { itemOffsets, totalSize } = useMemo(() => {
    const offsets: number[] = []
    let total = 0
    
    for (let i = 0; i < count; i++) {
      offsets.push(total)
      total += getSize(i)
    }
    
    return { itemOffsets: offsets, totalSize: total }
  }, [count, getSize])
  
  // findRange: efficiently find which items overlap the visible viewport.
  // Uses binary search (O(log n) instead of O(n)) so large lists (1 000+ items)
  // stay fast — important during momentum scrolling on mobile.
  const findRange = useCallback((offset: number, size: number): [number, number] => {
    if (count === 0) return [0, 0]
    
    // Binary search: find the first item whose bottom edge is at or below the
    // viewport's top edge (offset = scroll position = first visible pixel).
    let start = 0
    let end = count - 1
    
    while (start < end) {
      const mid = Math.floor((start + end) / 2)
      if (itemOffsets[mid]! + getSize(mid) < offset) {
        start = mid + 1
      } else {
        end = mid
      }
    }
    
    // overscan: render a few extra items above and below the visible window.
    // This eliminates blank flashes when the user scrolls faster than React
    // can re-render (e.g. keyboard Page Down or fast touch flick).
    const startIndex = Math.max(0, start - overscan)
    
    // Walk forward from the start item until we pass the viewport's bottom edge.
    let endIndex = start
    let currentOffset = itemOffsets[start] ?? 0
    
    while (endIndex < count && currentOffset < offset + size) {
      currentOffset += getSize(endIndex)
      endIndex++
    }
    
    return [startIndex, Math.min(count, endIndex + overscan)]
  }, [count, itemOffsets, getSize, overscan])
  
  // Calculate virtual items
  const virtualItems = useMemo((): VirtualItem[] => {
    const [startIndex, endIndex] = findRange(scrollOffset, containerSize)
    const items: VirtualItem[] = []
    
    for (let i = startIndex; i < endIndex; i++) {
      items.push({
        index: i,
        start: itemOffsets[i] ?? 0,
        size: getSize(i),
        key: getItemKey(i),
      })
    }
    
    return items
  }, [scrollOffset, containerSize, findRange, itemOffsets, getSize, getItemKey])
  
  // Handle scroll events
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const handleScroll = () => {
      const offset = horizontal ? container.scrollLeft : container.scrollTop
      setScrollOffset(offset)
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [horizontal])
  
  // Handle container resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const size = horizontal 
          ? entry.contentRect.width 
          : entry.contentRect.height
        setContainerSize(size)
      }
    })
    
    observer.observe(container)
    return () => observer.disconnect()
  }, [horizontal])
  
  // Scroll to specific index
  const scrollToIndex = useCallback((
    index: number, 
    options: { align?: 'start' | 'center' | 'end' } = {}
  ) => {
    const container = containerRef.current
    if (!container || index < 0 || index >= count) return
    
    const itemOffset = itemOffsets[index] ?? 0
    const itemSize = getSize(index)
    const { align = 'start' } = options
    
    let scrollTo = itemOffset
    
    if (align === 'center') {
      scrollTo = itemOffset - containerSize / 2 + itemSize / 2
    } else if (align === 'end') {
      scrollTo = itemOffset - containerSize + itemSize
    }
    
    scrollTo = Math.max(0, Math.min(scrollTo, totalSize - containerSize))
    
    if (horizontal) {
      container.scrollLeft = scrollTo
    } else {
      container.scrollTop = scrollTo
    }
  }, [count, itemOffsets, getSize, containerSize, totalSize, horizontal])
  
  // Update measured size for an item
  const measureItem = useCallback((index: number, size: number) => {
    measuredSizes.current.set(index, size)
  }, [])
  
  return {
    virtualItems,
    totalSize,
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    scrollToIndex,
    measureItem,
  }
}

/**
 * VirtualList component wrapper for easy usage
 */
export interface VirtualListProps<T> {
  items: T[]
  estimateSize: number | ((index: number) => number)
  overscan?: number
  className?: string
  renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode
  getItemKey?: (item: T, index: number) => string | number
}

export function VirtualList<T>({
  items,
  estimateSize,
  overscan,
  className = '',
  renderItem,
  getItemKey = (_, i) => i,
}: VirtualListProps<T>): JSX.Element {
  const { virtualItems, totalSize, containerRef } = useVirtualList({
    count: items.length,
    estimateSize,
    overscan,
    getItemKey: (i) => getItemKey(items[i]!, i),
  })
  
  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      role="list"
    >
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map(({ index, start, size, key }) => (
          <div
            key={key}
            role="listitem"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: size,
              transform: `translateY(${start}px)`,
            }}
          >
            {renderItem(items[index]!, index, { height: size })}
          </div>
        ))}
      </div>
    </div>
  )
}
