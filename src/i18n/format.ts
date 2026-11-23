import { currentLocale, intlLocale } from './index'
import type { Locale } from './locales'
import { runtimeConfig } from '#/config/runtime'

export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions, locale: Locale = currentLocale()) => new Intl.NumberFormat(intlLocale(locale), opts).format(n)

export const formatDecimal = (n: number, digits = 2, locale: Locale = currentLocale()) =>
  formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits }, locale)

const asDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)

export const formatDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }, locale: Locale = currentLocale()) =>
  new Intl.DateTimeFormat(intlLocale(locale), { timeZone: iso.length === 10 ? 'UTC' : runtimeConfig().timeZone, ...opts }).format(asDate(iso))

export const monthName = (month1: number, style: 'long' | 'short' = 'long', locale: Locale = currentLocale()) =>
  new Intl.DateTimeFormat(intlLocale(locale), { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month1 - 1, 15)))

export const weekdayName = (iso: string, style: 'long' | 'short' | 'narrow' = 'long', locale: Locale = currentLocale()) =>
  new Intl.DateTimeFormat(intlLocale(locale), { weekday: style, timeZone: 'UTC' }).format(asDate(iso))
