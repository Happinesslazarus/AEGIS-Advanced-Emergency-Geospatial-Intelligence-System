/**
 * useDebounce custom React hook (debounce logic).
 *
 * - Used by React components that need this functionality */

import { useState, useEffect } from 'react'

/**
 * Hook that debounces a value by the specified delay.
 * 
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 * @returns The debounced value
 * 
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState('')
 * const debouncedSearch = useDebounce(searchTerm, 300)
 * 
 * // Use debouncedSearch for filtering/API calls
 * useEffect(() => {
 *   fetchResults(debouncedSearch)
 * }, [debouncedSearch])
 * ```
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    //Set up timeout to update debounced value after delay
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    //Cleanup: clear timeout if value changes or component unmounts
    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}

/**
 * Hook that debounces a callback function.
 * 
 * @param callback - The function to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 * @returns A debounced version of the callback
 * 
 * @example
 * ```tsx
 * const handleSearch = useDebouncedCallback((term: string) => {
 *   fetchResults(term)
 * }, 300)
 * 
 * return <input onChange={e => handleSearch(e.target.value)} />
 * ```
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => void>(
  callback: T,
  delay = 300
): (...args: Parameters<T>) => void {
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    //Cleanup on unmount
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [timer])

  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    setTimer(setTimeout(() => callback(...args), delay))
  }
}

export default useDebounce
