import type { KeyboardEvent, MouseEvent } from 'react'
import { holidayByDate, holidayDates } from '#/data/holidays'
import {
  monthsLong,
  weekdaysLong,
  formatDay,
  approvedRangeOf,
  isApprovedDay,
  isWeekend,
  monthCells,
  weekdayMon0,
  type LeaveCtx,
  type YearMonth,
} from '#/lib/leave'
import { t, tn } from '#/i18n'
import { weekdayName } from '#/i18n/format'

const dow = () => Array.from({ length: 7 }, (_, i) => weekdayName(`2026-01-${String(5 + i).padStart(2, '0')}`, 'short'))

interface Props {
  ym: YearMonth
  todayISO: string
  minISO?: string
  ctx: LeaveCtx
  start: string | null
  end: string | null
  focusIso: string
  onPick: (iso: string, el: HTMLElement) => void
  onDayKey: (e: KeyboardEvent<HTMLElement>, iso: string) => void
  onFocusDay: (iso: string) => void
  className?: string
}

function holidayCaption(ym: YearMonth): string {
  const prefix = `${ym.y}-${String(ym.m).padStart(2, '0')}-`
  const days = [...holidayDates].filter((d) => d.startsWith(prefix)).sort()
  if (days.length === 0) return ''
  if (days.length > 2) return tn('calendar.holidayDays', days.length)
  return t('calendar.holidayList', { days: days.map(formatDay).join(', ') })
}

function describe(iso: string, flags: { past: boolean; used: boolean; pending: boolean; part?: string; today: boolean }): string {
  const [y, m, d] = iso.split('-').map(Number)
  let label = `${d} ${monthsLong()[m - 1]} ${y}, ${weekdaysLong()[weekdayMon0(iso)]}`
  const h = holidayByDate.get(iso)
  if (h) label += h.half ? `, ${t('calendar.halfHoliday', { name: h.name })}` : `, ${t('calendar.publicHoliday', { name: h.name })}`
  if (flags.used) label += `, ${flags.pending ? t('calendar.yourPendingLeave') : t('calendar.yourApprovedLeave')}`
  if (flags.part) label += `, ${t('calendar.partLeave', { part: flags.part })}`
  if (flags.past) label += `, ${t('calendar.past')}`
  if (flags.today) label += `, ${t('calendar.today')}`
  return label
}

export function LeaveCalendar({ ym, todayISO, minISO = todayISO, ctx, start, end, focusIso, onPick, onDayKey, onFocusDay, className }: Props) {
  const cells = monthCells(ym)
  const a = start
  const b = start ? (end ?? start) : null
  const caption = holidayCaption(ym)
  const title = `${monthsLong()[ym.m - 1]} ${ym.y}`

  return (
    <div className={className}>
      <h4 className="mb-2 flex justify-between text-row font-semibold">
        {title}
        <span className="text-micro font-normal text-faint">{caption}</span>
      </h4>
      <div role="grid" aria-label={title} className="grid grid-cols-7 gap-0.5 lg:grid-cols-[repeat(7,2.5rem)]">
        <div role="row" className="contents">
          {dow().map((x) => (
            <span key={x} role="columnheader" className="pt-1 pb-1.5 text-center text-tab font-medium text-faint">
              {x}
            </span>
          ))}
        </div>
        {cells.map((iso, i) => {
          if (!iso) return <span key={`pad-${i}`} role="gridcell" aria-hidden="true" />
          const past = iso < minISO
          const used = isApprovedDay(iso, ctx)
          const pending = used && !!approvedRangeOf(iso, ctx)?.pending
          const part = ctx.partial?.get(iso)
          const today = iso === todayISO
          const inRange = a !== null && b !== null && iso > a && iso < b
          const disabled = past || used
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              data-iso={iso}
              tabIndex={iso === focusIso ? 0 : -1}
              aria-disabled={disabled || undefined}
              aria-selected={inRange || iso === a || iso === b}
              aria-label={describe(iso, { past, used, pending, part, today })}
              data-we={isWeekend(iso) || undefined}
              data-hol={holidayDates.has(iso) || undefined}
              data-half={holidayByDate.get(iso)?.half || undefined}
              data-past={past || undefined}
              data-used={used || undefined}
              data-part={part ? true : undefined}
              data-today={today || undefined}
              data-in={inRange || undefined}
              data-s={iso === a || undefined}
              data-e={iso === b || undefined}
              className="cal-day"
              onFocus={() => onFocusDay(iso)}
              onKeyDown={(e) => onDayKey(e, iso)}
              onClick={(e: MouseEvent<HTMLElement>) => {
                if (!disabled) onPick(iso, e.currentTarget)
              }}
            >
              {Number(iso.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
