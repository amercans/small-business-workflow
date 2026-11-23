import { fetchText, type FxProvider, type RateSnapshot } from './types'

const LATEST = 'https://www.tcmb.gov.tr/kurlar/today.xml'
const archive = (y: number, m: number, d: number) => `https://www.tcmb.gov.tr/kurlar/${y}${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}${String(m).padStart(2, '0')}${y}.xml`

export type TcmbRates = { usd: number; eur: number; date: string }

export function parseTcmb(xml: string): TcmbRates | null {
  const d = xml.match(/<Tarih_Date[^>]*\sDate="(\d{2})\/(\d{2})\/(\d{4})"/)
  const sell = (code: string) => {
    const m = xml.match(new RegExp(`<Currency[^>]*Kod="${code}"[\\s\\S]*?<ForexSelling>([\\d.]+)</ForexSelling>`))
    const v = m ? Number(m[1]) : NaN
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const usd = sell('USD')
  const eur = sell('EUR')
  if (!d || usd == null || eur == null) return null
  return { usd, eur, date: `${d[3]}-${d[1]}-${d[2]}` }
}

const snapshot = (r: TcmbRates | null): RateSnapshot | null => (r ? { date: r.date, rates: { USD: r.usd, EUR: r.eur } } : null)

export const tcmbProvider: FxProvider = {
  id: 'tcmb',
  async latest(fetcher) {
    const xml = await fetchText(LATEST, fetcher)
    return xml ? snapshot(parseTcmb(xml)) : null
  },
  async on(day, fetcher) {
    const [y, m, d] = day.split('-').map(Number)
    for (let back = 0; back <= 7; back++) {
      const t = new Date(Date.UTC(y, m - 1, d - back))
      const xml = await fetchText(archive(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), fetcher)
      const r = xml ? snapshot(parseTcmb(xml)) : null
      if (r) return r
    }
    return null
  },
}
