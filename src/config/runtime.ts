import type { Currency } from '#/lib/money'
import { CURRENCIES } from '#/lib/money'

export interface RuntimeConfig {
  appName: string
  baseCurrency: Currency
  booksStart: string
  holidayCountry: string
  timeZone: string
  accountingLocale: string
  company: { name: string; address: string; registration: string; contactEmail: string }
  vatRates?: number[]
  fxRates?: Partial<Record<Currency, number | null>>
}

function validZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return true
  } catch {
    return false
  }
}

const config: RuntimeConfig = { appName: '', baseCurrency: 'TRY', booksStart: '', holidayCountry: 'TR', timeZone: 'Europe/Istanbul', accountingLocale: 'en', company: { name: '', address: '', registration: '', contactEmail: '' } }

export function applyRuntimeConfig(next: Partial<RuntimeConfig>): void {
  if (next.appName !== undefined) config.appName = next.appName
  if (next.baseCurrency && (CURRENCIES as readonly string[]).includes(next.baseCurrency)) config.baseCurrency = next.baseCurrency
  if (next.booksStart !== undefined) config.booksStart = /^\d{4}-\d{2}-\d{2}$/.test(next.booksStart) ? next.booksStart : ''
  if (next.timeZone && validZone(next.timeZone)) config.timeZone = next.timeZone
  if (next.accountingLocale) config.accountingLocale = next.accountingLocale
  if (next.company) config.company = { ...next.company }
  if (next.fxRates) config.fxRates = { ...next.fxRates }
  if (Array.isArray(next.vatRates)) config.vatRates = next.vatRates.filter((v) => Number.isFinite(v))
  if (next.holidayCountry !== undefined) config.holidayCountry = next.holidayCountry.trim().toUpperCase()
}

export const runtimeConfig = (): Readonly<RuntimeConfig> => config
