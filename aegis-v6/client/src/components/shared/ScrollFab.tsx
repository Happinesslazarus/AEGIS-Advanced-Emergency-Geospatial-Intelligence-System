import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

export default function ScrollFab() {
  const [scrollY, setScrollY] = useState(0)
  const [docHeight, setDocHeight] = useState(0)

  useEffect(() => {
    const update = () => {
      setScrollY(window.scrollY)
      setDocHeight(document.documentElement.scrollHeight - window.innerHeight)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  const visible = scrollY > 200
  const atBottom = docHeight > 0 && scrollY >= docHeight - 80

  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })
  const toBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })

  if (!visible && scrollY < 200) return null

  return (
    <div
      className={`fixed bottom-28 left-4 z-50 flex flex-col gap-2 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      aria-label="Scroll navigation"
    >
      <button
        onClick={toTop}
        aria-label="Scroll to top"
        className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-aegis-50 dark:hover:bg-aegis-950/40 hover:text-aegis-600 dark:hover:text-aegis-400 hover:border-aegis-300 dark:hover:border-aegis-700 transition-all duration-200 hover:scale-110 active:scale-95"
      >
        <ChevronUp className="w-5 h-5" />
      </button>
      {!atBottom && docHeight > 300 && (
        <button
          onClick={toBottom}
          aria-label="Scroll to bottom"
          className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-aegis-50 dark:hover:bg-aegis-950/40 hover:text-aegis-600 dark:hover:text-aegis-400 hover:border-aegis-300 dark:hover:border-aegis-700 transition-all duration-200 hover:scale-110 active:scale-95"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}
