/**
 * Skeletons.tsx — Reusable skeleton placeholder components
 * shown while data is loading. Eliminates layout shift and gives
 * users visual feedback that content is being fetched.
 */

/** Generic rectangular skeleton with pulse animation */
export function SkeletonBox({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg ${className}`} />
}

/** Card-shaped skeleton matching the report/alert card layout */
export function SkeletonCard(): JSX.Element {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <SkeletonBox className="w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <SkeletonBox className="h-4 w-3/4" />
          <SkeletonBox className="h-3 w-1/2" />
        </div>
        <SkeletonBox className="h-6 w-16 rounded-full" />
      </div>
      <SkeletonBox className="h-3 w-full" />
      <SkeletonBox className="h-3 w-5/6" />
      <div className="flex gap-2 pt-1">
        <SkeletonBox className="h-8 w-20 rounded-lg" />
        <SkeletonBox className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  )
}

/** Row skeleton for table/list views */
export function SkeletonRow(): JSX.Element {
  return (
    <div className="flex items-center gap-3 p-3">
      <SkeletonBox className="w-8 h-8 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <SkeletonBox className="h-3.5 w-2/3" />
        <SkeletonBox className="h-3 w-1/3" />
      </div>
      <SkeletonBox className="h-5 w-12 rounded" />
    </div>
  )
}

/** Map placeholder while tiles load */
export function SkeletonMap({ height = '400px' }: { height?: string }): JSX.Element {
  return (
    <div className="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl relative overflow-hidden" style={{ height }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 border-3 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">Loading map...</p>
        </div>
      </div>
      {/* Fake grid lines to indicate map area */}
      <div className="absolute inset-0 grid grid-cols-4 grid-rows-4">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="border border-gray-200/30 dark:border-gray-700/30" />
        ))}
      </div>
    </div>
  )
}

/** Stats card skeleton for dashboard metrics */
export function SkeletonStat(): JSX.Element {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <SkeletonBox className="h-3 w-20" />
      <SkeletonBox className="h-8 w-16" />
      <SkeletonBox className="h-3 w-24" />
    </div>
  )
}

/** Chat message skeleton */
export function SkeletonChatMessage({ isUser = false }: { isUser?: boolean }): JSX.Element {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-pulse`}>
      <div className={`max-w-[75%] p-3 rounded-2xl space-y-1.5 ${isUser ? 'bg-blue-100 dark:bg-blue-900/30 rounded-br-md' : 'bg-gray-100 dark:bg-gray-800 rounded-bl-md'}`}>
        <SkeletonBox className="h-3 w-48" />
        <SkeletonBox className="h-3 w-36" />
        {!isUser && <SkeletonBox className="h-3 w-24" />}
      </div>
    </div>
  )
}

/** Multiple card skeletons for list loading */
export function SkeletonCardList({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}




