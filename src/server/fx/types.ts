import type { Currency } from '#/lib/money'

export type RateTable = Partial<Record<Currency, number>>

export interface RateSnapshot {
  date: string
  rates: RateTable
}

export interface FxProvider {
  id: 'tcmb' | 'ecb'
  latest(fetcher: typeof fetch): Promise<RateSnapshot | null>
  on(day: string, fetcher: typeof fetch): Promise<RateSnapshot | null>
}

export const FETCH_TIMEOUT_MS = 5000

export async function fetchText(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const res = await fetcher(url, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}
