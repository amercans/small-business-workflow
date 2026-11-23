import { t } from '#/i18n'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from './Icon'
import { LeaveCalendar } from './LeaveCalendar'
import {
  addDays,
  addMonths,
  compareMonth,
  monthKey,
  weekdayMon0,
  type LeaveCtx,
  type YearMonth,
} from '#/lib/leave'
import { spr } from '#/lib/motion'

const MONTHS_AHEAD = 12

interface Props {
  label: string
  mode: 'range' | 'single'
  start: string | null
  end: string | null
  onChange: (start: string | null, end: string | null) => void
  todayISO: string
  minISO?: string
  ctx: LeaveCtx
  isDesktop: boolean
  approvedLabel?: string
  error?: string
  id: string
  extraLegend?: ReactNode
}

export function DateRangePicker({ label, mode, start, end, onChange, todayISO, minISO = todayISO, ctx, isDesktop, approvedLabel, error, id, extraLegend }: Props) {
  const todayMonth = monthKey(todayISO)
  const [view, setView] = useState<YearMonth>(todayMonth)
  const [focusIso, setFocusIso] = useState(todayISO)
  const pendingFocus = useRef<string | null>(null)

  const lastNavMonth = addMonths(todayMonth, MONTHS_AHEAD)
  const visibleCount = isDesktop ? 2 : 1
  const minMonth = monthKey(minISO)
  const canPrev = compareMonth(view, minMonth) > 0
  const canNext = compareMonth(addMonths(view, visibleCount - 1), lastNavMonth) < 0
  const maxISO = `${lastNavMonth.y}-${String(lastNavMonth.m).padStart(2, '0')}-28`

  const isVisible = (iso: string, v: YearMonth) => {
    const k = monthKey(iso)
    return compareMonth(k, v) >= 0 && compareMonth(k, addMonths(v, visibleCount - 1)) <= 0
  }

  function shiftView(n: number) {
    const next = addMonths(view, n)
    setView(next)
    if (!isVisible(focusIso, next)) {
      setFocusIso(compareMonth(next, todayMonth) === 0 ? todayISO : `${next.y}-${String(next.m).padStart(2, '0')}-01`)
    }
  }

  function pick(iso: string, el: HTMLElement) {
    if (mode === 'single') onChange(iso, iso)
    else if (!start || end) onChange(iso, null)
    else if (iso < start) onChange(iso, null)
    else onChange(start, iso)
    spr(el, [{ transform: 'scale(.86)' }, { transform: 'none' }], 420, 'spring')
  }

  function moveFocus(target: string) {
    let next = target
    if (next < minISO) next = minISO
    if (next > maxISO) next = maxISO
    const k = monthKey(next)
    if (compareMonth(k, view) < 0) setView(k)
    else if (compareMonth(k, addMonths(view, visibleCount - 1)) > 0) setView(addMonths(k, -(visibleCount - 1)))
    setFocusIso(next)
    pendingFocus.current = next
  }

  useEffect(() => {
    if (!pendingFocus.current) return
    document.querySelector<HTMLElement>(`[data-iso="${pendingFocus.current}"]`)?.focus()
    pendingFocus.current = null
  })

  function onDayKey(e: KeyboardEvent<HTMLElement>, iso: string) {
    const monthStep = (n: number) => {
      const k = addMonths(monthKey(iso), n)
      return `${k.y}-${String(k.m).padStart(2, '0')}-${String(Math.min(Number(iso.slice(8)), 28)).padStart(2, '0')}`
    }
    const map: Record<string, string> = {
      ArrowLeft: addDays(iso, -1),
      ArrowRight: addDays(iso, 1),
      ArrowUp: addDays(iso, -7),
      ArrowDown: addDays(iso, 7),
      Home: addDays(iso, -weekdayMon0(iso)),
      End: addDays(iso, 6 - weekdayMon0(iso)),
      PageUp: monthStep(-1),
      PageDown: monthStep(1),
    }
    const target = map[e.key]
    if (!target) return
    e.preventDefault()
    moveFocus(target)
  }

  const cal = (ym: YearMonth, className?: string) => (
    <LeaveCalendar
      className={className}
      ym={ym}
      todayISO={todayISO}
      minISO={minISO}
      ctx={ctx}
      start={start}
      end={end}
      focusIso={focusIso}
      onPick={pick}
      onDayKey={onDayKey}
      onFocusDay={setFocusIso}
    />
  )

  return (
    <div id={id} role="group" aria-label={label} tabIndex={-1} aria-invalid={error ? true : undefined} className="outline-none">
      <div className="mt-5.5 mb-2.5 flex items-center justify-between gap-3 text-micro font-semibold text-muted">
        <span>{label}</span>
        <span className="-my-1.5 flex shrink-0 gap-1.5">
          <button type="button" aria-label={t('dates.prevMonth')} disabled={!canPrev} onClick={() => shiftView(-1)} className="grid size-7 place-items-center rounded-full bg-wash disabled:opacity-40">
            <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
          </button>
          <button type="button" aria-label={t('dates.nextMonth')} disabled={!canNext} onClick={() => shiftView(1)} className="grid size-7 place-items-center rounded-full bg-wash disabled:opacity-40">
            <Icon name="chev" size={14} strokeWidth={2} />
          </button>
        </span>
      </div>
      <div className="grid gap-7 lg:grid-cols-2">
        {cal(view)}
        {cal(addMonths(view, 1), 'hidden lg:block')}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1 text-micro text-faint">
        {ctx.approved.length > 0 && approvedLabel && <span>{t('dates.legendApproved', { leave: approvedLabel })}</span>}
        {ctx.partial && ctx.partial.size > 0 && <span>{t('dates.legendPartial')}</span>}
        {extraLegend}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-micro text-status-rejected">
          {error}
        </p>
      )}
    </div>
  )
}
