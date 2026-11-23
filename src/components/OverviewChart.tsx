import { useEffect, useRef, useState } from 'react'
import type { MonthData } from '#/data/finance'
import { net, monthShort } from '#/lib/finance'
import { t as tr } from '#/i18n'
import { formatNumber } from '#/i18n/format'
import { formatMillions, formatSignedRounded, formatMoneyRounded } from '#/lib/money'

const W = 1120, L = 52, R = 16, TOP = 26, H1 = 250, XL = 30
const PLOT_W = W - L - R
const SLOT = PLOT_W / 12
const BW = 22, G = 4
const MAX_V = 2_000_000
const y1 = (v: number) => TOP + H1 - (v / MAX_V) * H1
const TICKS = [0, 500_000, 1_000_000, 1_500_000, 2_000_000] as const
const tickLabel = (v: number) => (v === 0 ? '0' : `${formatNumber(v / 1_000_000, { maximumFractionDigits: 1 })}M`)

const colPath = (x: number, y: number, h: number) => `M${x} ${y + h} V${y + 4} a4 4 0 0 1 4 -4 h${BW - 8} a4 4 0 0 1 4 4 V${y + h} Z`

export function OverviewChart({ data, selected, onSelect }: { data: MonthData[]; selected: number; onSelect: (i: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (wrap.current) wrap.current.scrollLeft = wrap.current.scrollWidth
  }, [])
  const [tip, setTip] = useState<{ i: number; left: number; top: number } | null>(null)

  function show(i: number, el: Element) {
    const r = el.getBoundingClientRect()
    const p = wrap.current!.getBoundingClientRect()
    setTip({ i, left: r.left - p.left + r.width / 2, top: r.top - p.top - 6 })
  }

  const t = tip ? data[tip.i] : null
  return (
    <div ref={wrap} className="relative overflow-x-auto">
      <svg className="chart block min-w-[58rem] w-full" viewBox={`0 0 ${W} ${TOP + H1 + XL}`} role="img" aria-label={tr('overview.chart.label')}>
        {TICKS.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y1(v)} y2={y1(v)} className="stroke-chart-grid" strokeWidth="1" />
            <text x={L - 10} y={y1(v) + 4} textAnchor="end" className="tick">{tickLabel(v)}</text>
          </g>
        ))}
        {data.map((m, i) => {
          const cx = L + SLOT * i + SLOT / 2
          const sel = i === selected
          const x1 = cx - BW - G / 2
          const x2 = cx + G / 2
          const n = net(m)
          const op = sel ? undefined : 0.8
          return (
            <g
              key={m.key}
              className="col"
              tabIndex={0}
              role="button"
              aria-pressed={sel}
              aria-label={tr('overview.chart.bar', { month: `${monthShort(m.month)} ${m.year}`, income: formatMoneyRounded(m.income), expense: formatMoneyRounded(m.expense), net: formatSignedRounded(n) })}
              onMouseEnter={(e) => show(i, e.currentTarget.querySelector('.hit')!)}
              onMouseLeave={() => setTip(null)}
              onFocus={(e) => show(i, e.currentTarget.querySelector('.hit')!)}
              onBlur={() => setTip(null)}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(i)
                }
              }}
            >
              <path d={colPath(x1, y1(m.income), H1 + TOP - y1(m.income))} className="fill-chart-income" opacity={op} />
              <path d={colPath(x2, y1(m.expense), H1 + TOP - y1(m.expense))} className="fill-chart-expense" opacity={op} />
              <text x={cx} y={TOP + H1 + 22} textAnchor="middle" className={`xl ${sel ? 'cur' : ''}`}>
                {monthShort(m.month)}
                {m.month === 1 ? ` '${String(m.year).slice(2)}` : ''}
              </text>
              {sel && (
                <>
                  {m.income > 0 && <text x={cx - 3} y={y1(m.income) - 8} textAnchor="end" className="dl">{formatMillions(m.income)}</text>}
                  {m.expense > 0 && <text x={cx + 3} y={y1(m.expense) - 8} textAnchor="start" className="dl">{formatMillions(m.expense)}</text>}
                </>
              )}
              <rect className="hit" x={L + SLOT * i} y={TOP} width={SLOT} height={H1} fill="transparent" />
            </g>
          )
        })}
      </svg>
      {t && tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-3 -translate-x-1/2 -translate-y-full rounded-day bg-ink px-3 py-2 text-micro leading-normal whitespace-nowrap text-on-dark shadow-sheet"
          style={{ left: tip.left, top: tip.top }}
        >
          <b className="font-semibold">
            {monthShort(t.month)} {t.year}
          </b>
          <br />
          <i className="mr-1.5 inline-block size-2 rounded-xs bg-chart-income" />
          {tr('overview.chart.income')} {formatMoneyRounded(t.income)}
          <br />
          <i className="mr-1.5 inline-block size-2 rounded-xs bg-chart-expense" />
          {tr('overview.chart.expense')} {formatMoneyRounded(t.expense)}
          <br />
          {tr('overview.chart.net')} <b className="font-semibold">{formatSignedRounded(net(t))}</b>
        </div>
      )}
    </div>
  )
}
