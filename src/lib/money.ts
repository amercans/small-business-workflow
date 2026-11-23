import { currentLocale, intlLocale } from '#/i18n'
import { runtimeConfig } from '#/config/runtime'

export const CURRENCIES = ['TRY', 'USD', 'EUR'] as const
export type Currency = (typeof CURRENCIES)[number]
export const CURRENCY_SYMBOL: Record<Currency, string> = { TRY: '₺', USD: '$', EUR: '€' }

export const currencyLabel = (c: Currency): string => (c === 'TRY' && currentLocale() === 'tr' ? 'TL' : c)

export const baseCurrency = (): Currency => runtimeConfig().baseCurrency

export const isBaseCurrency = (c: string | null | undefined): boolean => !c || c === baseCurrency()

export const foreignCurrencies = (): Currency[] => CURRENCIES.filter((c) => c !== baseCurrency())

export const isCurrency = (c: unknown): c is Currency => typeof c === 'string' && (CURRENCIES as readonly string[]).includes(c)

const nf = (digits: number) => new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })

const withSymbol = (amount: string, currency: Currency, negative = false, sign = ''): string => {
  const sym = CURRENCY_SYMBOL[currency] ?? currency
  const pre = negative ? '−' : sign
  return currentLocale() === 'tr' ? `${pre}${amount} ${sym}` : `${pre}${sym}${amount}`
}

export const formatAmount = (n: number): string => nf(2).format(round2(n))

export const formatMoney = (n: number, currency: Currency = baseCurrency()): string => {
  const sym = CURRENCY_SYMBOL[currency] ?? currency
  if (currentLocale() === 'tr') return `${formatAmount(n)} ${sym}`
  return n < 0 ? `-${sym}${formatAmount(-n)}` : `${sym}${formatAmount(n)}`
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export function parseMoney(input: string): number | null {
  const s = input.replace(/[^\d.,]/g, '')
  if (!/\d/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma)
    normalized = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1).replace(/[.,]/g, '')
  } else if (lastComma >= 0) {
    normalized = s.slice(0, lastComma).replace(/,/g, '') + '.' + s.slice(lastComma + 1).replace(/,/g, '')
  } else if (lastDot >= 0) {
    const thousands = /^\d{1,3}(\.\d{3})+$/.test(s)
    normalized = thousands ? s.replace(/\./g, '') : s.slice(0, lastDot).replace(/\./g, '') + '.' + s.slice(lastDot + 1)
  } else {
    normalized = s
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? round2(n) : null
}

export const cleanMoneyInput = (s: string): string => s.replace(/[^\d.,]/g, '')

export function formatOnBlur(s: string): string {
  const n = parseMoney(s)
  return n === null ? s : formatAmount(n)
}

export const formatMoneyRounded = (n: number, currency: Currency = baseCurrency()): string => {
  const r = Math.round(n)
  return r === 0 ? withSymbol('0', currency) : withSymbol(nf(0).format(Math.abs(r)), currency, r < 0)
}

export const formatSignedRounded = (n: number, currency: Currency = baseCurrency()): string => {
  const r = Math.round(n)
  return r === 0 ? withSymbol('0', currency) : withSymbol(nf(0).format(Math.abs(r)), currency, r < 0, '+')
}

export const formatMillions = (n: number): string => `${nf(2).format(n / 1_000_000)}M`
