/**
 * Generic sortable data table.
 *
 * Eliminates the repeated table/thead/tbody/SortBtn pattern that appears in
 * every admin component. Each column declares its header, a render function
 * for cell content, and optional sort/alignment config. The component owns
 * sort state internally; pass sortField/sortDir/onSort to control externally.
 *
 * Usage:
 *   <DataTable
 *     columns={[
 *       { key: 'name', header: 'User', render: (row) => row.name, sortable: true },
 *       { key: 'actions', header: '', render: (row) => <ActionMenu row={row} />, align: 'right' },
 *     ]}
 *     rows={users}
 *     rowKey={(u) => u.id}
 *     loading={loading}
 *   />
 */

import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

export interface DataTableColumn<T> {
  key: string
  header: React.ReactNode
  render: (row: T, index: number) => React.ReactNode
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  className?: string
  headerClassName?: string
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  emptyMessage?: string
  /** Controlled sort -- if provided, component does NOT manage sort state */
  sortField?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (field: string, dir: 'asc' | 'desc') => void
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  /** Render extra content below a row when its key matches expandedKey */
  expandedKey?: string | null
  renderExpanded?: (row: T) => React.ReactNode
  className?: string
  skeletonRows?: number
}

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyMessage = 'No data',
  sortField: externalSortField,
  sortDir: externalSortDir,
  onSort,
  onRowClick,
  rowClassName,
  expandedKey,
  renderExpanded,
  className = '',
  skeletonRows = 5,
}: DataTableProps<T>): JSX.Element {
  const [internalField, setInternalField] = useState('')
  const [internalDir, setInternalDir] = useState<'asc' | 'desc'>('asc')

  const controlled = externalSortField !== undefined
  const sortField = controlled ? (externalSortField ?? '') : internalField
  const sortDir   = controlled ? (externalSortDir  ?? 'asc') : internalDir

  function handleSort(key: string) {
    const nextDir = sortField === key && sortDir === 'desc' ? 'asc' : 'desc'
    if (controlled) {
      onSort?.(key, nextDir)
    } else {
      if (internalField === key) setInternalDir(d => d === 'asc' ? 'desc' : 'asc')
      else { setInternalField(key); setInternalDir('desc') }
    }
  }

  const thBase = 'px-3 py-3 text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider'

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">
            {columns.map((col) => {
              const align = ALIGN_CLASS[col.align ?? 'left']
              return (
                <th
                  key={col.key}
                  className={`${thBase} ${align} ${col.headerClassName ?? ''}`}
                >
                  {col.sortable ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                      {col.header}
                      {sortField === col.key
                        ? sortDir === 'desc'
                          ? <ArrowDown className="w-3 h-3" />
                          : <ArrowUp   className="w-3 h-3" />
                        : <ArrowUpDown className="w-3 h-3 opacity-30" />
                      }
                    </button>
                  ) : col.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-3">
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row)
              const extraClass = rowClassName?.(row) ?? ''
              return (
                <>
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={`group text-xs hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${extraClass}`}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-3 ${ALIGN_CLASS[col.align ?? 'left']} ${col.className ?? ''}`}
                      >
                        {col.render(row, index)}
                      </td>
                    ))}
                  </tr>
                  {expandedKey === key && renderExpanded && (
                    <tr key={`${key}-expanded`}>
                      <td colSpan={columns.length} className="bg-gray-50/50 dark:bg-gray-800/20 px-5 py-4">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
