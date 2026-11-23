import { t, tn } from '#/i18n'
import { formatNumber, monthName, weekdayName } from '#/i18n/format'

export interface DateRange {
  from: string
  to: string
  pending?: boolean
}

export interface LeaveCtx {
  holidays: ReadonlySet<string>
  approved: readonly DateRange[]
  halfDays?: ReadonlySet<string>
  partial?: ReadonlyMap<string, string>
}

const MS_DAY = 86_400_000

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function isValidISO(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && toISO(parseISO(iso)) === iso
}

export function addDays(iso: string, n: number): string {
  return toISO(new Date(parseISO(iso).getTime() + n * MS_DAY))
}

export function weekdayMon0(iso: string): number {
  return (parseISO(iso).getUTCDay() + 6) % 7
}

export const isWeekend = (iso: string) => weekdayMon0(iso) >= 5
export const isApprovedDay = (iso: string, ctx: LeaveCtx) =>
  ctx.approved.some((r) => iso >= r.from && iso <= r.to)

export const approvedRangeOf = (iso: string, ctx: LeaveCtx) => ctx.approved.find((r) => iso >= r.from && iso <= r.to)

export function partialMap(days: readonly { date: string; from: string; to: string; pending: boolean }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const d of days) {
    const label = d.pending ? t('leave.partialPending', { from: d.from, to: d.to }) : `${d.from}–${d.to}`
    m.set(d.date, m.has(d.date) ? `${m.get(d.date)}; ${label}` : label)
  }
  return m
}

export function isWorkday(iso: string, ctx: LeaveCtx): boolean {
  return !isWeekend(iso) && !ctx.holidays.has(iso) && !isApprovedDay(iso, ctx)
}

export function orderRange(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

export function countWorkdays(a: string, b: string, ctx: LeaveCtx): number {
  const [from, to] = orderRange(a, b)
  const last = parseISO(to).getTime()
  let n = 0
  for (let t = parseISO(from).getTime(); t <= last; t += MS_DAY) {
    const iso = toISO(new Date(t))
    if (isWorkday(iso, ctx)) n += ctx.halfDays?.has(iso) ? 0.5 : 1
  }
  return n
}

export interface YearMonth {
  y: number
  m: number
}

export const monthKey = (iso: string): YearMonth => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) })

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const i = ym.y * 12 + (ym.m - 1) + n
  return { y: Math.floor(i / 12), m: (i % 12) + 1 }
}

export const compareMonth = (a: YearMonth, b: YearMonth) => a.y * 12 + a.m - (b.y * 12 + b.m)

export function daysInMonth(ym: YearMonth): number {
  return new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate()
}

export const firstOfMonth = (ym: YearMonth) => `${ym.y}-${String(ym.m).padStart(2, '0')}-01`

export function monthCells(ym: YearMonth): (string | null)[] {
  const lead = weekdayMon0(firstOfMonth(ym))
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= daysInMonth(ym); d++) cells.push(`${ym.y}-${String(ym.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  return cells
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export const monthsShort = (): string[] => MONTHS.map((m) => monthName(m, 'short'))
export const monthsLong = (): string[] => MONTHS.map((m) => monthName(m, 'long'))
export const weekdaysLong = (): string[] => Array.from({ length: 7 }, (_, i) => weekdayName(`2026-01-${String(5 + i).padStart(2, '0')}`, 'long'))
export const weekdaysShort = (): string[] => Array.from({ length: 7 }, (_, i) => weekdayName(`2026-01-${String(5 + i).padStart(2, '0')}`, 'short'))

export const formatDay = (iso: string) => `${Number(iso.slice(8))} ${monthName(Number(iso.slice(5, 7)), 'short')}`

export function formatRange(a: string, b: string, sep = '–'): string {
  const [from, to] = orderRange(a, b)
  return from === to ? formatDay(from) : `${formatDay(from)}${sep}${formatDay(to)}`
}

export const LEAVE_OVERDRAFT_DAYS = 14

export const SICK_BACKDATE_DAYS = 30

export const earliestLeaveDate = (kind: string, today: string): string => (kind === 'sick' ? addDays(today, -SICK_BACKDATE_DAYS) : today)

export const UNLIMITED_LEAVE_ROLES: readonly string[] = []
export const hasUnlimitedLeave = (role: string) => UNLIMITED_LEAVE_ROLES.includes(role)

export const WORKDAY_HOURS = 8
export const WORK_START = '09:00'
export const WORK_END = '18:00'
export const HALF_DAY = { morning: ['09:00', '13:00'], afternoon: ['14:00', '18:00'] } as const
export type HalfDay = keyof typeof HALF_DAY

export const halfDayLabel = (h: HalfDay): string => (h === 'morning' ? t('leave.halfDay.morning') : t('leave.halfDay.afternoon'))

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export const TIME_SLOTS: readonly string[] = Array.from({ length: (minutes(WORK_END) - minutes(WORK_START)) / 30 + 1 }, (_, i) => hhmm(minutes(WORK_START) + i * 30))

export const isTimeSlot = (t: string) => TIME_SLOTS.includes(t)

export function leaveHours(start: string, end: string): number {
  const s = minutes(start)
  const e = minutes(end)
  return e <= s ? 0 : (e - s) / 60
}

export const ARIFE_END = '13:00'

export function partialHours(iso: string, start: string, end: string, ctx: LeaveCtx): number {
  return ctx.halfDays?.has(iso) ? leaveHours(start, end < ARIFE_END ? end : ARIFE_END) : leaveHours(start, end)
}

export const hoursToDays = (h: number) => h / WORKDAY_HOURS

const num = (n: number) => formatNumber(n, { maximumFractionDigits: 2 })

export function formatLeaveDays(days: number): string {
  if (days < 0) return `−${formatLeaveDays(-days)}`
  const halfHours = Math.round(days * WORKDAY_HOURS * 2)
  const whole = Math.floor(halfHours / (WORKDAY_HOURS * 2))
  const hours = (halfHours - whole * WORKDAY_HOURS * 2) / 2
  const dayText = tn('leave.duration.days', whole, { n: num(whole) })
  const hourText = tn('leave.duration.hours', hours, { n: num(hours) })
  if (hours === 0) return dayText
  return whole === 0 ? hourText : t('leave.duration.both', { days: dayText, hours: hourText })
}

export function returnDate(end: string, ctx: LeaveCtx, endTime?: string | null): string {
  if (endTime && endTime < WORK_END) return end
  let d = addDays(end, 1)
  for (let i = 0; i < 60 && !isWorkday(d, ctx); i++) d = addDays(d, 1)
  return d
}
