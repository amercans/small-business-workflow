import { runtimeConfig } from '#/config/runtime'
import { CURRENCIES, type Currency } from '#/lib/money'
import { audit, type Db } from '../db/d1'
import { ecbProvider } from './ecb'
import { tcmbProvider } from './tcmb'
import type { FxProvider } from './types'

export { parseTcmb } from './tcmb'
export { crossRates, parseEcb } from './ecb'
export type { FxProvider, RateSnapshot, RateTable } from './types'

export const providerFor = (base: Currency = runtimeConfig().baseCurrency): FxProvider => (base === 'TRY' ? tcmbProvider : ecbProvider(base))

const COLUMN: Record<Currency, string> = { TRY: 'try_rate_micro', USD: 'usd_rate_micro', EUR: 'eur_rate_micro' }

export type StoredRates = Record<Currency, number | null>

export async function storedRates(db: Db, base: Currency = runtimeConfig().baseCurrency): Promise<StoredRates & { updatedOn: string | null }> {
  const r = await db.prepare(`SELECT try_rate_micro, usd_rate_micro, eur_rate_micro, fx_updated_on FROM finance_settings WHERE id = 1`).first<Record<string, number | null> & { fx_updated_on: string | null }>()
  const out = { updatedOn: r?.fx_updated_on ?? null } as StoredRates & { updatedOn: string | null }
  for (const c of CURRENCIES) out[c] = c === base ? 1 : r?.[COLUMN[c]] ? Number(r[COLUMN[c]]) / 1e6 : null
  return out
}

export function storeRatesStmt(db: Db, rates: Partial<Record<Currency, number | null>>, day: string, actorId: string | null, base: Currency = runtimeConfig().baseCurrency) {
  const micro = (c: Currency) => (c === base ? null : rates[c] == null ? null : Math.round(rates[c]! * 1e6))
  return db
    .prepare(`UPDATE finance_settings SET try_rate_micro = ?, usd_rate_micro = ?, eur_rate_micro = ?, fx_updated_on = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ? WHERE id = 1`)
    .bind(micro('TRY'), micro('USD'), micro('EUR'), day, actorId)
}

export async function refreshFx(db: Db, fetcher: typeof fetch = fetch, provider: FxProvider = providerFor()): Promise<boolean> {
  const snap = await provider.latest(fetcher)
  if (!snap) {
    console.warn(JSON.stringify({ at: 'fx', provider: provider.id, error: 'rates unavailable' }))
    return false
  }
  const current = await storedRates(db)
  const merged: Partial<Record<Currency, number | null>> = {}
  for (const c of CURRENCIES) merged[c] = snap.rates[c] ?? current[c]
  await db.batch([
    storeRatesStmt(db, merged, snap.date, null),
    audit(db, { actorId: null, actorEmail: provider.id, action: 'fx.set', entityType: 'fixed_cost', entityId: 'fx', after: snap, meta: { auto: true } }),
  ])
  return true
}

export async function fxMissing(db: Db, base: Currency = runtimeConfig().baseCurrency): Promise<boolean> {
  const r = await storedRates(db, base)
  return CURRENCIES.some((c) => c !== base && r[c] == null)
}

export async function rateOn(day: string, currency: Currency, fetcher: typeof fetch = fetch, provider: FxProvider = providerFor()): Promise<{ rate: number; bulletinDate: string; source: FxProvider['id'] } | null> {
  if (currency === runtimeConfig().baseCurrency) return { rate: 1, bulletinDate: day, source: provider.id }
  const snap = await provider.on(day, fetcher)
  const rate = snap?.rates[currency]
  return snap && rate ? { rate, bulletinDate: snap.date, source: provider.id } : null
}
