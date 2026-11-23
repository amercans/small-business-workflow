import type { ReactNode } from 'react'

export type SummaryTone = 'leave' | 'expense' | 'advance' | 'purchase' | 'travel'

const toneBg: Record<SummaryTone, string> = {
  leave: 'bg-card-leave',
  expense: 'bg-card-expense',
  advance: 'bg-card-advance',
  purchase: 'bg-card-purchase',
  travel: 'bg-card-travel',
}

export function SummaryCard({
  tone,
  kicker,
  headline,
  big,
  unit,
  rows,
  children,
}: {
  tone: SummaryTone
  kicker: string
  headline: ReactNode
  big: ReactNode
  unit?: string
  rows?: { label: string; value: ReactNode }[]
  children?: ReactNode
}) {
  return (
    <div className={`sum-card ${toneBg[tone]} p-4 lg:p-5 lg:pb-4.5`} aria-live="polite">
      <div className="relative z-1 text-small opacity-80">{kicker}</div>
      <div className="relative z-1 flex flex-wrap items-end justify-between gap-x-4 lg:block">
        <div className="mt-1 min-h-7 text-sum-range font-semibold lg:mt-2">{headline}</div>
        <div className="num flex items-baseline gap-2 text-sum-days-sm font-semibold lg:mt-3.5 lg:text-sum-days">
          <span>{big}</span>
          {unit && <small className="text-ui font-medium opacity-80">{unit}</small>}
        </div>
      </div>
      {rows?.map((r) => (
        <div key={r.label} className="relative z-1 mt-3 flex items-center justify-between gap-3 text-small opacity-90 first-of-type:lg:mt-4.5">
          <span>{r.label}</span>
          <b className="text-right font-semibold">{r.value}</b>
        </div>
      ))}
      {children}
    </div>
  )
}
