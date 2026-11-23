import type { forLocale } from '#/i18n'
import { formatDate } from '#/i18n/format'
import { INTL_LOCALE, type Locale } from '#/i18n/locales'
import { runtimeConfig } from '#/config/runtime'
import { CURRENCY_SYMBOL, type Currency } from '#/lib/money'

const WORKDAY_HOURS = 8

export function mailMoney(locale: Locale, minor: number, currency?: Currency): string {
  const c = currency ?? runtimeConfig().baseCurrency
  const sym = CURRENCY_SYMBOL[c] ?? c
  const n = Math.abs(minor) / 100
  const amount = new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  const sign = minor < 0 ? '−' : ''
  return locale === 'tr' ? `${sign}${amount} ${sym}` : `${sign}${sym}${amount}`
}

export const mailDay = (locale: Locale, iso: string, withYear = false) => formatDate(iso, withYear ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' }, locale)

export function mailRange(locale: Locale, a: string, b: string): string {
  const [from, to] = a <= b ? [a, b] : [b, a]
  return from === to ? mailDay(locale, from) : `${mailDay(locale, from)}–${mailDay(locale, to)}`
}

export function mailLeaveDays(l: ReturnType<typeof forLocale>, days: number, workDays = false): string {
  if (days < 0) return `−${mailLeaveDays(l, -days, workDays)}`
  const halfHours = Math.round(days * WORKDAY_HOURS * 2)
  const whole = Math.floor(halfHours / (WORKDAY_HOURS * 2))
  const hours = (halfHours - whole * WORKDAY_HOURS * 2) / 2
  const h = new Intl.NumberFormat(INTL_LOCALE[l.locale], { maximumFractionDigits: 1 }).format(hours)
  if (hours === 0) return workDays ? l.tn('mail.fmt.workDays', whole) : l.tn('mail.fmt.days', whole)
  if (whole === 0) return l.tn('mail.fmt.hours', hours, { count: h })
  return `${l.tn('mail.fmt.days', whole)} ${l.tn('mail.fmt.hours', hours, { count: h })}`
}
