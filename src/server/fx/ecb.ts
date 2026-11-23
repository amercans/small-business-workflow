import type { Currency } from '#/lib/money'
import { CURRENCIES } from '#/lib/money'
import { fetchText, type FxProvider, type RateSnapshot } from './types'

const LATEST = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
const HISTORY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'

export interface EcbDay {
  date: string
  perEur: Record<string, number>
}

export function parseEcb(xml: string): EcbDay[] {
  const days: EcbDay[] = []
  for (const block of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const perEur: Record<string, number> = { EUR: 1 }
    for (const c of block[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/>/g)) {
      const v = Number(c[2])
      if (Number.isFinite(v) && v > 0) perEur[c[1]] = v
    }
    days.push({ date: block[1], perEur })
  }
  return days.sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function crossRates(day: EcbDay, base: Currency): RateSnapshot | null {
  const b = day.perEur[base]
  if (!b) return null
  const rates: Partial<Record<Currency, number>> = {}
  for (const c of CURRENCIES) {
    if (c === base) continue
    const v = day.perEur[c]
    if (!v) return null
    rates[c] = Math.round((b / v) * 1e6) / 1e6
  }
  return { date: day.date, rates }
}

export function ecbProvider(base: Currency): FxProvider {
  return {
    id: 'ecb',
    async latest(fetcher) {
      const xml = await fetchText(LATEST, fetcher)
      const day = xml ? parseEcb(xml)[0] : undefined
      return day ? crossRates(day, base) : null
    },
    async on(dayIso, fetcher) {
      const xml = await fetchText(HISTORY, fetcher)
      if (!xml) return null
      const day = parseEcb(xml).find((d) => d.date <= dayIso)
      if (!day || Date.parse(dayIso) - Date.parse(day.date) > 7 * 86_400_000) return null
      return crossRates(day, base)
    },
  }
}
