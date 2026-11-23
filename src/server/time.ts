import { monthName, weekdayName } from '#/i18n/format'
import { runtimeConfig } from '#/config/runtime'

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: runtimeConfig().timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>

export function todayISO(now = new Date()): string {
  const p = parts(now)
  return `${p.year}-${p.month}-${p.day}`
}

export function todayLong(now = new Date()): string {
  const iso = todayISO(now)
  return `${Number(iso.slice(8))} ${monthName(Number(iso.slice(5, 7)))} ${iso.slice(0, 4)}, ${weekdayName(iso)}`
}

export function stampLabel(ts: string | null | undefined): string | undefined {
  if (!ts) return undefined
  const p = parts(new Date(ts))
  return `${Number(p.day)} ${monthName(Number(p.month), 'short')} ${p.year}, ${p.hour}:${p.minute}`
}

export const stampDay = (ts: string) => todayISO(new Date(ts))

export function nowLabel(now = new Date()): string {
  const p = parts(now)
  return `${Number(p.day)} ${monthName(Number(p.month))} ${p.year}, ${p.hour}:${p.minute}`
}
