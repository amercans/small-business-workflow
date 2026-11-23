import { intlLocale, t } from '#/i18n'
import { useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  right?: boolean
  primary?: boolean
  className?: string
  hideOnMobile?: boolean
  sortValue?: (row: T) => string | number | null
}

export function DataList<T>({
  rows,
  columns,
  template,
  rowKey,
  renderLink,
  empty,
  label,
  highlightKey,
}: {
  rows: T[]
  columns: Column<T>[]
  template: string
  rowKey: (row: T) => string
  renderLink?: (row: T, className: string, children: ReactNode) => ReactNode
  empty?: ReactNode
  label: string
  highlightKey?: string
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  if (rows.length === 0) {
    return <div className="kar rounded-3xl p-6 text-label text-muted">{empty ?? t('ui.dataList.empty')}</div>
  }
  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile)
  const sortCol = sort && columns.find((c) => c.key === sort.key)
  const shown = sortCol?.sortValue
    ? [...rows].sort((a, b) => {
        const x = sortCol.sortValue!(a)
        const y = sortCol.sortValue!(b)
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), intlLocale())) * sort!.dir
      })
    : rows
  const toggle = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
  const sortable = columns.some((c) => c.sortValue)

  return (
    <div role="list" aria-label={label} className="kar rounded-3xl p-2">
      <div
        aria-hidden={sortable ? undefined : true}
        className="hidden gap-4 px-4 pt-2.5 pb-2 text-micro font-medium text-faint lg:grid"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((c) => (
          <span key={c.key} className={`${c.right ? 'text-right' : ''} ${c.className ?? ''}`}>
            {c.sortValue ? (
              <button
                type="button"
                onClick={() => toggle(c.key)}
                aria-label={`${c.header}: ${sort?.key === c.key ? (sort.dir === 1 ? t('ui.dataList.sortedAsc') : t('ui.dataList.sortedDesc')) : t('ui.dataList.sort')}`}
                className={`inline-flex items-center gap-1 hover:text-ink ${sort?.key === c.key ? 'text-ink' : ''}`}
              >
                {c.header}
                <SortMark dir={sort?.key === c.key ? sort.dir : 0} />
              </button>
            ) : (
              c.header
            )}
          </span>
        ))}
      </div>
      <div className="flex flex-col">
        {shown.map((row) => {
          const inner = (
            <>
              <div className="hidden items-center gap-4 lg:grid" style={{ gridTemplateColumns: template }}>
                {columns.map((c) => (
                  <div key={c.key} className={`min-w-0 ${c.right ? 'text-right' : ''} ${c.className ?? ''}`}>
                    {c.cell(row)}
                  </div>
                ))}
              </div>
              <div className="lg:hidden">
                <div className="min-w-0">{primary.cell(row)}</div>
                <dl className="m-0 mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-link">
                  {rest.map((c) => (
                    <div key={c.key} className="contents">
                      <dt className="text-faint">{c.header}</dt>
                      <dd className="m-0 min-w-0 text-right">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          )
          const cls = 'block rounded-[0.875rem] px-4 py-3.25 text-ink no-underline transition-colors duration-200'
          return (
            <div
              role="listitem"
              key={rowKey(row)}
              data-id={rowKey(row)}
              className={`data-row rounded-[0.875rem] ${highlightKey === rowKey(row) ? 'bg-[color-mix(in_srgb,var(--color-blue)_9%,transparent)]' : ''}`}
            >
              {renderLink ? renderLink(row, `${cls} hover:bg-kar-wash`, inner) : <div className={cls}>{inner}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SortMark({ dir }: { dir: 1 | -1 | 0 }) {
  return (
    <svg width="8" height="11" viewBox="0 0 8 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M1 4 4 1l3 3" opacity={dir === -1 ? 0.25 : dir === 1 ? 1 : 0.55} />
      <path d="M1 7l3 3 3-3" opacity={dir === 1 ? 0.25 : dir === -1 ? 1 : 0.55} />
    </svg>
  )
}
