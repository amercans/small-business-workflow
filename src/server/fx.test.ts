import { afterEach, describe, expect, it } from 'vitest'
import { applyRuntimeConfig } from '#/config/runtime'
import { defaultVatRates, normalizeVatRates, parseVatList } from '#/lib/vat'
import { testDb } from './db/testing'
import { crossRates, fxMissing, parseEcb, parseTcmb, providerFor, rateOn, refreshFx, storedRates } from './fx'
import { vatRateError, vatRates, VAT_SETTING } from './vat'
import { writeSetting } from './settings'
import { setup, form, jpg } from './testkit'
import * as req from './services/requests'

const TCMB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="27.10.2026" Date="10/27/2026"  Bulten_No="2026/203" >
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><ForexBuying>49.6997</ForexBuying><ForexSelling>49.7892</ForexSelling></Currency>
  <Currency CrossOrder="1" Kod="AUD" CurrencyCode="AUD"><Unit>1</Unit><ForexBuying>32.1</ForexBuying><ForexSelling>32.3</ForexSelling></Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexBuying>55.4241</ForexBuying><ForexSelling>55.5241</ForexSelling></Currency>
</Tarih_Date>`

const ecbXml = (days: [string, number, number][]) => `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
${days.map(([d, usd, tr]) => `    <Cube time='${d}'>
      <Cube currency='USD' rate='${usd}'/>
      <Cube currency='JPY' rate='160.12'/>
      <Cube currency='TRY' rate='${tr}'/>
    </Cube>`).join('\n')}
  </Cube>
</gesmes:Envelope>`

const respond = (map: Record<string, string>) => {
  const calls: string[] = []
  const f = (async (url: string | URL) => {
    calls.push(String(url))
    const hit = Object.entries(map).find(([k]) => String(url).includes(k))
    return hit ? new Response(hit[1], { status: 200 }) : new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
  return { f, calls }
}

const down = (async () => {
  throw new Error('offline')
}) as unknown as typeof fetch

afterEach(() => applyRuntimeConfig({ baseCurrency: 'TRY', holidayCountry: 'TR' }))

describe('central bank of Türkiye provider', () => {
  it('reads USD and EUR selling rates and the bulletin date', () => {
    expect(parseTcmb(TCMB_XML)).toEqual({ usd: 49.7892, eur: 55.5241, date: '2026-10-27' })
  })

  it('returns null when a rate is missing or the document is malformed', () => {
    expect(parseTcmb(TCMB_XML.replace(/Kod="EUR"[\s\S]*?<\/Currency>/, ''))).toBeNull()
    expect(parseTcmb('<html>maintenance</html>')).toBeNull()
  })

  it('is used for a lira base currency and stores rates in base units', async () => {
    const db = testDb()
    expect(providerFor('TRY').id).toBe('tcmb')
    const t = respond({ 'today.xml': TCMB_XML })
    expect(await refreshFx(db, t.f)).toBe(true)
    expect(await storedRates(db)).toMatchObject({ TRY: 1, USD: 49.7892, EUR: 55.5241, updatedOn: '2026-10-27' })
    expect(await fxMissing(db)).toBe(false)
  })
})

describe('European Central Bank provider', () => {
  const XML = ecbXml([
    ['2026-10-26', 1.08, 37.8],
    ['2026-10-27', 1.1, 38.5],
  ])

  it('parses every day, newest first, with EUR as 1', () => {
    const days = parseEcb(XML)
    expect(days.map((d) => d.date)).toEqual(['2026-10-27', '2026-10-26'])
    expect(days[0].perEur).toMatchObject({ EUR: 1, USD: 1.1, TRY: 38.5 })
  })

  it('derives cross rates for a USD base', () => {
    const snap = crossRates(parseEcb(XML)[0], 'USD')
    expect(snap).toEqual({ date: '2026-10-27', rates: { EUR: 1.1, TRY: 0.028571 } })
  })

  it('derives direct rates for a EUR base', () => {
    expect(crossRates(parseEcb(XML)[0], 'EUR')).toEqual({ date: '2026-10-27', rates: { TRY: 0.025974, USD: 0.909091 } })
  })

  it('is selected for USD and EUR bases and refreshes stored rates', async () => {
    applyRuntimeConfig({ baseCurrency: 'USD' })
    expect(providerFor().id).toBe('ecb')
    const db = testDb()
    const t = respond({ 'eurofxref-daily.xml': ecbXml([['2026-10-27', 1.1, 38.5]]) })
    expect(await refreshFx(db, t.f)).toBe(true)
    expect(await storedRates(db)).toMatchObject({ USD: 1, EUR: 1.1, TRY: 0.028571 })
    expect(t.calls[0]).toContain('ecb.europa.eu')
  })

  it('looks up the rate for a past date, falling back to the previous business day', async () => {
    applyRuntimeConfig({ baseCurrency: 'EUR' })
    const t = respond({ 'eurofxref-hist-90d.xml': XML })
    expect(await rateOn('2026-10-26', 'USD', t.f)).toEqual({ rate: 0.925926, bulletinDate: '2026-10-26', source: 'ecb' })
    expect(await rateOn('2026-10-28', 'USD', t.f)).toMatchObject({ bulletinDate: '2026-10-27' })
    expect(await rateOn('2026-12-31', 'USD', t.f)).toBeNull()
    expect(await rateOn('2026-10-27', 'EUR', t.f)).toEqual({ rate: 1, bulletinDate: '2026-10-27', source: 'ecb' })
  })
})

describe('manual fallback', () => {
  it('keeps the stored rates when the provider fails', async () => {
    const db = testDb()
    expect(await fxMissing(db)).toBe(true)
    const t = respond({ 'today.xml': TCMB_XML })
    await refreshFx(db, t.f)
    expect(await refreshFx(db, down)).toBe(false)
    expect(await storedRates(db)).toMatchObject({ USD: 49.7892, EUR: 55.5241 })
  })
})

describe('expense in a foreign currency', () => {
  const usdExpense = (rate?: number) =>
    form({ items: [{ date: '2026-10-20', amount: 100, currency: 'USD', ...(rate ? { rate } : {}), category: 'meals', description: 'Team lunch', fileName: 'receipt.jpg', file: jpg() }] })
  const who = () => {
    const s = setup()
    const user = Object.keys(s.users)[0] as keyof typeof s.users
    return { s, ctx: s.ctx(user) }
  }

  it('converts to the base currency with the official rate of the expense date', async () => {
    const { s, ctx } = who()
    const t = respond({ '/202610/20102026.xml': TCMB_XML.replace('49.7892', '40.0000') })
    const r = await req.submitExpense({ ...ctx, fetcher: t.f }, usdExpense())
    if (!r.ok) throw new Error(r.error)
    const item = s.db.raw.prepare(`SELECT currency, amount_minor, fx_rate_micro, amount_base_minor FROM request_items`).get()
    expect(item).toEqual({ currency: 'USD', amount_minor: 10000, fx_rate_micro: 40_000_000, amount_base_minor: 400000 })
    expect(s.db.raw.prepare(`SELECT total_base_minor FROM requests WHERE type = 'expense'`).get()).toEqual({ total_base_minor: 400000 })
  })

  it('uses a manually entered rate without calling the provider', async () => {
    const { s, ctx } = who()
    const t = respond({})
    const r = await req.submitExpense({ ...ctx, fetcher: t.f }, usdExpense(35))
    if (!r.ok) throw new Error(r.error)
    expect(t.calls).toHaveLength(0)
    expect(s.db.raw.prepare(`SELECT amount_base_minor FROM request_items`).get()).toEqual({ amount_base_minor: 350000 })
  })

  it('falls back to stored rates, then asks for a manual rate', async () => {
    const { s, ctx } = who()
    const r1 = await req.submitExpense({ ...ctx, fetcher: down }, usdExpense())
    expect(r1).toMatchObject({ ok: false, fieldErrors: { 'items.0.rate': expect.any(String) } })
    await refreshFx(s.db, respond({ 'today.xml': TCMB_XML }).f)
    const r2 = await req.submitExpense({ ...ctx, fetcher: down }, usdExpense())
    if (!r2.ok) throw new Error(r2.error)
    expect(s.db.raw.prepare(`SELECT fx_rate_micro FROM request_items`).get()).toEqual({ fx_rate_micro: 49_789_200 })
  })
})

describe('VAT rates', () => {
  it('defaults by country and parses an admin list', () => {
    expect(defaultVatRates('TR')).toEqual([0, 1, 10, 20])
    expect(defaultVatRates('NONE')).toEqual([0, 5, 10, 20])
    expect(parseVatList('20, 0, 7.5;7.5 %10')).toEqual([0, 7.5, 10, 20])
    expect(parseVatList('20, abc')).toBeNull()
    expect(parseVatList('120')).toBeNull()
    expect(normalizeVatRates([5, 5, 0, 3.333])).toEqual([0, 5])
  })

  it('validates against the configured list', async () => {
    const db = testDb()
    expect(await vatRates(db)).toEqual([0, 1, 10, 20])
    expect(await vatRateError(db, 18)).toMatchObject({ ok: false, fieldErrors: { vatRate: expect.any(String) } })
    await writeSetting(db, VAT_SETTING, [0, 8, 18], null).run()
    expect(await vatRates(db)).toEqual([0, 8, 18])
    expect(await vatRateError(db, 18)).toBeNull()
    expect(await vatRateError(db, 20)).not.toBeNull()
  })
})
