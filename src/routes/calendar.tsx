import { runtimeConfig } from '#/config/runtime'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Avatar } from '#/components/Avatar'
import { Icon } from '#/components/Icon'
import { loadTeamCalendar, type TeamLeave } from '#/data/calendar'
import { holidayByDate, holidayDates } from '#/data/holidays'
import { t } from '#/i18n'
import { formatDate, monthName, weekdayName } from '#/i18n/format'

const MONTH = /^20\d\d-(0[1-9]|1[0-2])$/
const dow = () => Array.from({ length: 7 }, (_, i) => weekdayName(`2026-01-${String(5 + i).padStart(2, '0')}`, 'short'))

export const Route = createFileRoute('/calendar')({
  validateSearch: (s: Record<string, unknown>): { month?: string } => (typeof s.month === 'string' && MONTH.test(s.month) ? { month: s.month } : {}),
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: ({ deps, context }) => loadTeamCalendar({ data: { month: deps.month ?? (context as { session: { todayISO: string } }).session.todayISO.slice(0, 7) } }),
  component: TeamCalendar,
})

const iso = (d: Date) => d.toISOString().slice(0, 10)
const shift = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return iso(d).slice(0, 7)
}
function monthGrid(month: string): string[] {
  const first = new Date(`${month}-01T00:00:00Z`)
  const start = new Date(first)
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7))
  const last = new Date(first)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  const days: string[] = []
  for (const d = new Date(start); d <= last || days.length % 7; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d))
  return days
}
const weekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())
const partLabel = (l: TeamLeave) => (l.part === 'half' ? t('calendar.halfDay') : l.part === 'hours' ? t('calendar.fewHours') : null)
const firstName = (n: string) => n.split(' ')[0]

function TeamCalendar() {
  const { month, min, max, leaves } = Route.useLoaderData()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: runtimeConfig().timeZone })
  const days = monthGrid(month)
  const [y, m] = month.split('-').map(Number)
  const title = `${monthName(m)} ${y}`
  const DOW = dow()
  const onDay = (day: string) => (weekend(day) || holidayDates.has(day) ? [] : leaves.filter((l) => l.start <= day && l.end >= day))
  const listed = days.filter((d) => d.startsWith(month) && onDay(d).length > 0)

  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('nav.calendar')}</h1>
      <p className="mt-2.5 text-label text-muted">{t('calendar.lead')}</p>

      <div className="kar mt-5 rounded-3xl p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.015em]">{title}</h2>
          <div className="flex gap-1.5">
            {month > min ? (
              <Link to="/calendar" search={{ month: shift(month, -1) }} aria-label={t('calendar.prev')} className="cal-nav">
                <Icon name="chev" size={16} className="rotate-180" />
              </Link>
            ) : (
              <span className="cal-nav opacity-40" aria-hidden="true">
                <Icon name="chev" size={16} className="rotate-180" />
              </span>
            )}
            {month < max ? (
              <Link to="/calendar" search={{ month: shift(month, 1) }} aria-label={t('calendar.next')} className="cal-nav">
                <Icon name="chev" size={16} />
              </Link>
            ) : (
              <span className="cal-nav opacity-40" aria-hidden="true">
                <Icon name="chev" size={16} />
              </span>
            )}
          </div>
        </div>

        <div className="hidden grid-cols-7 gap-1.5 sm:grid" role="grid" aria-label={title}>
          {DOW.map((d) => (
            <div key={d} className="px-2 pb-1 text-small text-faint" role="columnheader">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const out = !day.startsWith(month)
            const hol = holidayByDate.get(day)
            const people = onDay(day)
            return (
              <div key={day} role="gridcell" aria-label={people.length ? t('calendar.dayWithPeople', { day: formatDate(day, { day: 'numeric', month: 'long' }), people: people.map((p) => p.name).join(', ') }) : formatDate(day, { day: 'numeric', month: 'long' })} className={`team-day ${weekend(day) ? 'is-weekend' : ''} ${out ? 'is-out' : ''}`}>
                <span className={`team-day-n num ${day === today ? 'is-today' : ''}`}>{Number(day.slice(8))}</span>
                {hol && !out && <span className="truncate text-micro text-faint">{hol.name}</span>}
                {people.map((l) => (
                  <span key={l.userId + l.start} className="team-chip" title={l.name}>
                    <Avatar name={l.name} hue={l.hue} className="size-5 text-[0.5625rem]" />
                    <span className="truncate">{firstName(l.name)}</span>
                    {partLabel(l) && <small>{partLabel(l)}</small>}
                  </span>
                ))}
              </div>
            )
          })}
        </div>

        <ul className="m-0 flex list-none flex-col p-0 sm:hidden">
          {listed.length === 0 && <li className="py-2 text-link text-muted">{t('calendar.nobody')}</li>}
          {listed.map((day) => (
            <li key={day} className="flex gap-4 border-t border-kar-line-2 py-3 first:border-t-0">
              <span className={`w-11 shrink-0 text-center ${day === today ? 'text-blue-ink' : ''}`}>
                <b className="num block text-[1.25rem] leading-tight font-semibold">{Number(day.slice(8))}</b>
                <span className="text-micro text-faint">{DOW[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]}</span>
              </span>
              <span className="flex min-w-0 flex-wrap gap-1.5 pt-0.5">
                {onDay(day).map((l) => (
                  <span key={l.userId + l.start} className="team-chip">
                    <Avatar name={l.name} hue={l.hue} className="size-5 text-[0.5625rem]" />
                    <span className="truncate">{l.name}</span>
                    {partLabel(l) && <small>{partLabel(l)}</small>}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
