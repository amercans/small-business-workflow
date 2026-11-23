import { defaultVatRates } from './vat'
import { formatDay } from './leave'
import { baseCurrency, currencyLabel, formatMoney, isCurrency, round2, type Currency } from './money'
import { runtimeConfig } from '#/config/runtime'
import { intlLocale, t } from '#/i18n'
import { formatDate, formatNumber } from '#/i18n/format'

export const configuredVatRates = (): number[] => runtimeConfig().vatRates ?? defaultVatRates(runtimeConfig().holidayCountry)

export const vatAmount = (net: number, rate: number): number => round2((net * rate) / 100)

export const grossTotal = (net: number, rate: number): number => round2(net + vatAmount(net, rate))

export const isOverdue = (due: string | null, settledOn: string | null, todayISO: string): boolean =>
  !settledOn && !!due && due < todayISO

export interface Receivables {
  amount: number
  count: number
  oldestDays: number
  overdue: number
}

interface InvLike {
  direction: 'in' | 'out'
  net: number
  date: string
  due: string | null
  settledOn: string | null
}

export function receivablesOf(list: InvLike[], todayISO: string): Receivables {
  const open = list.filter((i) => i.direction === 'out' && !i.settledOn)
  const oldest = open.reduce((m, i) => (i.date < m ? i.date : m), open[0]?.date ?? todayISO)
  return {
    amount: round2(open.reduce((s, i) => s + i.net, 0)),
    count: open.length,
    oldestDays: open.length ? Math.round((Date.parse(todayISO) - Date.parse(oldest)) / 86_400_000) : 0,
    overdue: open.filter((i) => isOverdue(i.due, i.settledOn, todayISO)).length,
  }
}

export const normalizeFirm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase(intlLocale())

export const booksStart = (): string => runtimeConfig().booksStart

export const isBeforeBooks = (invoiceDate: string): boolean => {
  const start = booksStart()
  return !!start && invoiceDate < start
}

export const beforeBooksHint = (direction: 'in' | 'out'): string =>
  t(direction === 'in' ? 'invoices.beforeBooks.hintIn' : 'invoices.beforeBooks.hintOut', { date: formatDate(booksStart()) })

export type InvoiceSnap = Partial<{ firm: string; no: string; date: string; currency: Currency; net: number; vatRate: number; fxRate: number; due: string | null; costKind: 'direct' | 'overhead' | null }>

const costLabel = (k: 'direct' | 'overhead') => t(k === 'direct' ? 'invoices.cost.direct' : 'invoices.cost.overhead')
const currencyName = (c: unknown) => (isCurrency(c) ? currencyLabel(c) : String(c))
const FIELD_ORDER = ['firm', 'no', 'date', 'currency', 'net', 'vatRate', 'fxRate', 'due', 'costKind'] as const

export function describeInvoiceChange(before: InvoiceSnap, after: InvoiceSnap): string {
  const rate = (n: number) => formatNumber(n, { maximumFractionDigits: 4 })
  const day = (v: unknown) => (v ? formatDay(v as string) : '—')
  const out: string[] = []
  for (const k of FIELD_ORDER) {
    if (!(k in before) && !(k in after)) continue
    const b = before[k]
    const a = after[k]
    switch (k) {
      case 'firm': out.push(t('invoices.change.firm', { from: String(b), to: String(a) })); break
      case 'no': out.push(t('invoices.change.no', { from: String(b), to: String(a) })); break
      case 'date': out.push(t('invoices.change.date', { from: day(b), to: day(a) })); break
      case 'currency': if (b !== a) out.push(t('invoices.change.currency', { from: currencyName(b), to: currencyName(a) })); break
      case 'net': out.push(t('invoices.change.amount', { from: formatMoney(b as number, before.currency ?? baseCurrency()), to: formatMoney(a as number, after.currency ?? baseCurrency()) })); break
      case 'vatRate': out.push(t('invoices.change.vat', { from: String(b), to: String(a) })); break
      case 'fxRate': out.push(t('invoices.change.fx', { from: rate(b as number), to: rate(a as number) })); break
      case 'due': out.push(t('invoices.change.due', { from: day(b), to: day(a) })); break
      case 'costKind': out.push(t('invoices.change.cost', { from: b ? costLabel(b as 'direct') : '—', to: a ? costLabel(a as 'direct') : '—' })); break
    }
  }
  return out.join('; ')
}
