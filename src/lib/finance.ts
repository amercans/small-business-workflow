import { t, type MessageKey } from '#/i18n'
import { monthName } from '#/i18n/format'

export const monthLong = (month1: number): string => monthName(month1, 'long')
export const monthShort = (month1: number): string => monthName(month1, 'short').replace(/\.$/, '')
export const monthYear = (key: string): string => `${monthLong(Number(key.slice(5, 7)))} ${key.slice(0, 4)}`

export interface MonthTotals {
  income: number
  expense: number
}

export const net = (m: MonthTotals): number => m.income - m.expense

export type Position = 'surplus' | 'deficit' | 'even'
export const position = (n: number): Position => (n > 0 ? 'surplus' : n < 0 ? 'deficit' : 'even')

export function headline(month: number, n: number, isCurrent: boolean): string {
  const loc = t(`finance.monthIn.m${month}` as MessageKey)
  const p = position(n)
  return t(`finance.headline.${p}${isCurrent ? 'Now' : 'Then'}` as MessageKey, { month: loc })
}

export const closingPhrase = (prevMonth: number, signed: string): string => t('finance.closing', { month: monthLong(prevMonth), amount: signed })

export interface Breakdown {
  personnel: number
  office: number
  software: number
  equipment: number
  professional: number
  otherFixed: number
  invoicesDirect: number
  invoicesOverhead: number
  employeeExpenses: number
}

export const breakdownTotal = (b: Breakdown): number =>
  b.personnel + b.office + b.software + b.equipment + b.professional + b.otherFixed + b.invoicesDirect + b.invoicesOverhead + b.employeeExpenses

export interface Pnl {
  income: number
  direct: number
  netRevenue: number
  personnel: number
  overhead: number
  profit: number
  margin: number | null
}

export function pnl(income: number, b: Breakdown): Pnl {
  const direct = b.invoicesDirect + b.employeeExpenses
  const netRevenue = income - direct
  const overhead = b.office + b.software + b.equipment + b.professional + b.otherFixed + b.invoicesOverhead
  const profit = netRevenue - b.personnel - overhead
  return { income, direct, netRevenue, personnel: b.personnel, overhead, profit, margin: netRevenue > 0 ? profit / netRevenue : null }
}

export interface RateSettings {
  people: number
  hours: number
  utilization: number
  margin: number
}

export function hourlyRate(b: Breakdown, s: RateSettings): { billableHours: number; cost: number; rate: number } | null {
  const billableHours = s.people * s.hours * (s.utilization / 100)
  if (billableHours <= 0 || s.margin >= 100) return null
  const p = pnl(0, b)
  const cost = (p.personnel + p.overhead) / billableHours
  return { billableHours, cost, rate: cost / (1 - s.margin / 100) }
}

export function barPercents(values: number[]): number[] {
  const max = Math.max(...values, 1)
  return values.map((v) => Math.round((v / max) * 100))
}

export const clampIndex = (i: number, len: number): number => Math.min(len - 1, Math.max(0, i))
