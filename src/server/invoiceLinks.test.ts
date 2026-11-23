import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyRuntimeConfig } from '#/config/runtime'
import { HttpError } from './auth/authorize'
import * as jobs from './services/jobs'
import * as links from './services/invoiceLinks'
import { decideInvoice } from './services/invoiceApproval'
import * as mng from './services/manage'
import { form, pdf, invVersion, setup, type Who } from './testkit'

beforeAll(() => applyRuntimeConfig({ booksStart: '2026-04-01' }))
afterAll(() => applyRuntimeConfig({ booksStart: '' }))

const rejects = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(HttpError)
  expect((e as HttpError).status).toBe(status)
}

const inv = (over: Record<string, unknown> = {}) =>
  form({ direction: 'in', fileName: 'f.pdf', file: pdf(), firm: 'Matbaa Ltd.', no: 'A1', date: '2026-10-10', net: 1000, vatRate: 20, toInventory: false, costKind: 'direct', items: [], ...over })

function world() {
  const s = setup()
  const by = s.users.manager.id
  const asset = '3'.padEnd(26, '0')
  const digital = '4'.padEnd(26, '0')
  const job = '5'.padEnd(26, '0')
  s.db.raw.prepare(`INSERT INTO assets (id, name, condition, created_by, updated_by) VALUES (?, 'Laptop', 'active', ?, ?)`).run(asset, by, by)
  s.db.raw.prepare(`INSERT INTO digital_assets (id, kind, name, created_by, updated_by) VALUES (?, 'software', 'Whiteboard tool', ?, ?)`).run(digital, by, by)
  s.db.raw.prepare(`INSERT INTO jobs (id, client, title, kind, status, end_date, created_by, updated_by) VALUES (?, 'Örnek Ltd.', 'Kartvizit', 'design', 'done', '2026-10-15', ?, ?)`).run(job, by, by)
  const mk = async (who: Who = 'manager', over: Record<string, unknown> = {}) => {
    const r = await mng.createInvoice(s.ctx(who), inv(over))
    if (!r.ok) throw new Error(r.error)
    return r.invoice.id
  }
  return { ...s, asset, digital, job, mk }
}

describe('invoice links', () => {
  it('links and unlinks, shows them in detail and list views and audits the change', async () => {
    const w = world()
    const id = await w.mk()
    for (const [kind, target] of [['asset', w.asset], ['digital', w.digital], ['job', w.job]] as const) {
      expect(await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind, id: target })).toEqual({ ok: true })
    }
    const a = await mng.getAsset(w.ctx('manager'), w.asset)
    expect(a!.invoices).toHaveLength(1)
    expect(a!.invoices![0]).toMatchObject({ id, no: 'A1', counterparty: 'Matbaa Ltd.', direction: 'in', totalTry: 1200, hasPdf: true })
    expect(a!.invoices![0].fileUrl).toMatch(/^\/files\/[0-9A-Z]{26}$/)
    expect((await mng.listAssets(w.ctx('manager')))[0].hasInvoice).toBe(true)
    const d = (await mng.listDigital(w.ctx('manager')))[0]
    expect(d.hasInvoice).toBe(true)
    expect(d.invoices).toHaveLength(1)
    const page = await jobs.listJobs(w.ctx('manager'), { from: '2026-10-01', to: '2026-10-31' })
    expect(page.jobs[0].hasInvoice).toBe(true)
    expect(page.jobs[0].invoices![0].id).toBe(id)

    expect(await links.unlinkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'asset', id: w.asset })).toEqual({ ok: true })
    expect((await mng.getAsset(w.ctx('manager'), w.asset))!.invoices).toEqual([])
    expect((await mng.listAssets(w.ctx('manager')))[0].hasInvoice).toBe(false)
    const log = w.db.raw.prepare(`SELECT action FROM audit_log WHERE action IN ('invoice.link','invoice.unlink') ORDER BY id`).all() as { action: string }[]
    expect(log.map((l) => l.action)).toEqual(['invoice.link', 'invoice.link', 'invoice.link', 'invoice.unlink'])
  })

  it('the invoice list labels linked records and hides kinds the viewer cannot read; history uses names', async () => {
    const w = world()
    const id = await w.mk()
    await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'asset', id: w.asset })
    await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'job', id: w.job })
    const row = (await mng.listInvoices(w.ctx('manager'))).find((i) => i.id === id)!
    expect(row.links).toEqual([
      { kind: 'asset', id: w.asset, label: 'Laptop' },
      { kind: 'job', id: w.job, label: 'Kartvizit' },
    ])
    const upd = await mng.updateInvoice(w.ctx('manager'), { id, version: row.version, direction: 'in', firm: 'Matbaa Ltd.', no: 'A1', date: row.date, currency: 'TRY', net: 1000, vatRate: 20, costKind: 'overhead' })
    if (!upd.ok) throw new Error(upd.error)
    expect(upd.invoice.links).toHaveLength(2)
    w.db.raw.prepare(`UPDATE assets SET name = 'Laptop Pro' WHERE id = ?`).run(w.asset)
    await links.unlinkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'job', id: w.job })
    const h = await mng.invoiceHistory(w.ctx('manager'), id)
    const texts = h.entries.map((e) => e.text)
    expect(texts).toContain('Laptop (ekipman) bağlandı')
    expect(texts).toContain('Kartvizit (iş) bağlandı')
    expect(texts).toContain('Kartvizit (iş) bağı kaldırıldı')
    expect((await mng.listInvoices(w.ctx('manager'))).find((i) => i.id === id)!.links).toEqual([{ kind: 'asset', id: w.asset, label: 'Laptop Pro' }])
    w.db.raw.exec('DROP TRIGGER trg_audit_no_update')
    w.db.raw.prepare(`UPDATE audit_log SET after_json = json_remove(after_json, '$.name') WHERE action = 'invoice.link' AND json_extract(after_json, '$.kind') = 'asset'`).run()
    expect((await mng.invoiceHistory(w.ctx('manager'), id)).entries.map((e) => e.text)).toContain('Laptop Pro (ekipman) bağlandı')
  })

  it('someone who sees invoices but cannot read assets does not see equipment or software names', async () => {
    const w = world()
    const id = await w.mk('employeeB', { no: 'U1' })
    for (const [kind, target] of [['asset', w.asset], ['digital', w.digital], ['job', w.job]] as const) {
      await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind, id: target })
    }
    const row = (await mng.listInvoices(w.ctx('employeeB'))).find((i) => i.id === id)!
    expect(row.links).toEqual([{ kind: 'job', id: w.job, label: 'Kartvizit' }])
    const texts = (await mng.invoiceHistory(w.ctx('employeeB'), id)).entries.map((e) => e.text)
    expect(texts.join('|')).not.toMatch(/Laptop|Whiteboard tool/)
    expect(texts).toContain('Bir ekipman bağlandı')
    expect(texts).toContain('Bir dijital kayıt bağlandı')
    expect(texts).toContain('Kartvizit (iş) bağlandı')
    expect((await mng.invoiceHistory(w.ctx('manager'), id)).entries.map((e) => e.text)).toContain('Laptop (ekipman) bağlandı')
  })

  it('rejects a duplicate link with a clear error', async () => {
    const w = world()
    const id = await w.mk()
    await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'job', id: w.job })
    const r = await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'job', id: w.job })
    expect(r).toMatchObject({ ok: false, error: 'Bu fatura bu kayda zaten bağlı' })
  })

  it('outgoing invoices cannot be linked, including through links on create', async () => {
    const w = world()
    const out = await w.mk('manager', { direction: 'out', due: '2026-11-10', no: 'S1', costKind: undefined })
    const r = await links.linkInvoice(w.ctx('manager'), { invoiceId: out, kind: 'job', id: w.job })
    expect(r).toMatchObject({ ok: false, error: 'Yalnız gelen faturalar bağlanabilir' })
    const c = await mng.createInvoice(w.ctx('manager'), inv({ direction: 'out', due: '2026-11-10', no: 'S2', costKind: undefined, links: [{ kind: 'job', id: w.job }] }))
    expect(c.ok).toBe(false)
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM invoice_links`).get()).toEqual({ n: 0 })
  })

  it('an employee cannot link or unlink; sending links gives 403 and nothing is written', async () => {
    const w = world()
    const id = await w.mk()
    await rejects(links.linkInvoice(w.ctx('employeeB'), { invoiceId: id, kind: 'job', id: w.job }), 403)
    await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'job', id: w.job })
    await rejects(links.unlinkInvoice(w.ctx('employeeB'), { invoiceId: id, kind: 'job', id: w.job }), 403)
    await rejects(mng.createInvoice(w.ctx('employeeB'), inv({ no: 'B1', links: [{ kind: 'job', id: w.job }] })), 403)
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM invoices WHERE invoice_no = 'B1'`).get()).toEqual({ n: 0 })
  })

  it('archived invoices are hidden; archived or missing targets cannot be linked', async () => {
    const w = world()
    const id = await w.mk()
    await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'asset', id: w.asset })
    w.db.raw.prepare(`UPDATE invoices SET archived_at = '2026-10-11T00:00:00.000Z', archived_by = ? WHERE id = ?`).run(w.users.manager.id, id)
    expect((await mng.getAsset(w.ctx('manager'), w.asset))!.invoices).toEqual([])
    expect((await mng.listAssets(w.ctx('manager')))[0].hasInvoice).toBe(false)
    const id2 = await w.mk('manager', { no: 'A2' })
    w.db.raw.prepare(`UPDATE jobs SET archived_at = '2026-10-11T00:00:00.000Z', archived_by = ? WHERE id = ?`).run(w.users.manager.id, w.job)
    expect(await links.linkInvoice(w.ctx('manager'), { invoiceId: id2, kind: 'job', id: w.job })).toMatchObject({ ok: false })
    expect(await links.linkInvoice(w.ctx('manager'), { invoiceId: id2, kind: 'asset', id: '9'.padEnd(26, '0') })).toMatchObject({ ok: false })
  })

  it('viewers without invoice access get no invoice fields; flagged employees see only their own uploads', async () => {
    const w = world()
    const id = await w.mk('manager')
    const mine = await w.mk('employeeB', { no: 'B7' })
    await links.linkInvoice(w.ctx('manager'), { invoiceId: id, kind: 'job', id: w.job })
    await links.linkInvoice(w.ctx('manager'), { invoiceId: mine, kind: 'job', id: w.job })
    const none = await jobs.listJobs(w.ctx('employeeA'), { from: '2026-10-01', to: '2026-10-31' })
    expect('invoices' in none.jobs[0]).toBe(false)
    expect('hasInvoice' in none.jobs[0]).toBe(false)
    const own = await jobs.listJobs(w.ctx('employeeB'), { from: '2026-10-01', to: '2026-10-31' })
    expect(own.jobs[0].invoices!.map((i) => i.no)).toEqual(['B7'])
    await rejects(mng.getAsset(w.ctx('employeeA'), w.asset), 403)
  })

  it('managers can create links together with the invoice', async () => {
    const w = world()
    const r = await mng.createInvoice(w.ctx('manager'), inv({ links: [{ kind: 'job', id: w.job }, { kind: 'digital', id: w.digital }, { kind: 'job', id: w.job }] }))
    expect(r.ok).toBe(true)
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM invoice_links`).get()).toEqual({ n: 2 })
    const bad = await mng.createInvoice(w.ctx('manager'), inv({ no: 'A9', links: [{ kind: 'asset', id: '9'.padEnd(26, '0') }] }))
    expect(bad.ok).toBe(false)
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM invoices WHERE invoice_no = 'A9'`).get()).toEqual({ n: 0 })
  })
})

const xml = (date: string, usd: number, eur: number) => {
  const [y, m, d] = date.split('-')
  return `<Tarih_Date Tarih="${d}.${m}.${y}" Date="${m}/${d}/${y}"><Currency Kod="USD"><ForexSelling>${usd}</ForexSelling></Currency><Currency Kod="EUR"><ForexSelling>${eur}</ForexSelling></Currency></Tarih_Date>`
}
const tcmb = (days: Record<string, [number, number]>) => {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(url)
    const m = String(url).match(/kurlar\/\d{6}\/(\d{2})(\d{2})(\d{4})\.xml$/)
    const day = m ? `${m[3]}-${m[2]}-${m[1]}` : ''
    return days[day] ? new Response(xml(day, ...days[day]), { status: 200 }) : new Response('yok', { status: 404 })
  }) as unknown as typeof fetch
  return { f, calls }
}
const row = (w: ReturnType<typeof world>, id: string) =>
  w.db.raw.prepare(`SELECT currency, fx_rate_micro, net_minor, vat_minor, net_base_minor, vat_base_minor FROM invoices WHERE id = ?`).get(id) as Record<string, number | string>

describe('foreign-currency invoices', () => {
  it('a USD invoice uses the rate of the invoice date and stores a fixed base amount', async () => {
    const w = world()
    const t = tcmb({ '2026-10-10': [34.5, 38], '2026-10-21': [99, 99] })
    const r = await mng.createInvoice({ ...w.ctx('manager'), fetcher: t.f }, inv({ currency: 'USD', net: 100 }))
    if (!r.ok) throw new Error(r.error)
    expect(row(w, r.invoice.id)).toEqual({ currency: 'USD', fx_rate_micro: 34_500_000, net_minor: 10000, vat_minor: 2000, net_base_minor: 345000, vat_base_minor: 69000 })
    expect(r.invoice).toMatchObject({ currency: 'USD', fxRate: 34.5, totalOrig: 120, net: 3450, total: 4140 })
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]).toContain('/202610/10102026.xml')
    await mng.settleInvoice(w.ctx('manager'), { id: r.invoice.id, settledOn: '2026-10-20' })
    expect(row(w, r.invoice.id).fx_rate_micro).toBe(34_500_000)
    await links.linkInvoice(w.ctx('manager'), { invoiceId: r.invoice.id, kind: 'job', id: w.job })
    const li = (await jobs.listJobs(w.ctx('manager'), { from: '2026-10-01', to: '2026-10-31' })).jobs[0].invoices![0]
    expect(li).toMatchObject({ currency: 'USD', fxRate: 34.5, totalOrig: 120, totalTry: 4140 })
  })

  it('a weekend invoice uses the previous business day\'s rate', async () => {
    const w = world()
    const t = tcmb({ '2026-10-09': [40, 44] })
    const r = await mng.createInvoice({ ...w.ctx('manager'), fetcher: t.f }, inv({ currency: 'EUR', net: 50, date: '2026-10-10' }))
    if (!r.ok) throw new Error(r.error)
    expect(row(w, r.invoice.id)).toMatchObject({ currency: 'EUR', fx_rate_micro: 44_000_000, net_base_minor: 220000 })
    expect(t.calls).toHaveLength(2)
  })

  it('when the rate provider is unreachable the rate field errors and nothing is written', async () => {
    const w = world()
    const down = (async () => {
      throw new Error('ağ')
    }) as unknown as typeof fetch
    const r = await mng.createInvoice({ ...w.ctx('manager'), fetcher: down }, inv({ currency: 'USD', net: 100 }))
    expect(r).toMatchObject({ ok: false, fieldErrors: { fxRate: expect.stringContaining('elle yaz') } })
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM invoices`).get()).toEqual({ n: 0 })
  })

  it('a manual rate must be positive and at most 100,000', async () => {
    const w = world()
    const t = tcmb({})
    for (const bad of [0, -1, 100_001]) {
      const r = await mng.createInvoice({ ...w.ctx('manager'), fetcher: t.f }, inv({ currency: 'USD', net: 10, fxRate: bad }))
      expect(r).toMatchObject({ ok: false, fieldErrors: { fxRate: 'Kur sıfırdan büyük ve en fazla 100.000 olmalı' } })
    }
    expect((await mng.createInvoice({ ...w.ctx('manager'), fetcher: t.f }, inv({ currency: 'USD', net: 10, fxRate: 0.5 }))).ok).toBe(true)
  })

  it('a manual rate is used without calling the provider; base-currency invoices ignore the rate', async () => {
    const w = world()
    const t = tcmb({})
    const r = await mng.createInvoice({ ...w.ctx('manager'), fetcher: t.f }, inv({ currency: 'USD', net: 10, fxRate: 30.1234 }))
    if (!r.ok) throw new Error(r.error)
    expect(t.calls).toHaveLength(0)
    expect(row(w, r.invoice.id)).toMatchObject({ fx_rate_micro: 30_123_400, net_base_minor: 30123 })
    const tl = await mng.createInvoice({ ...w.ctx('manager'), fetcher: t.f }, inv({ no: 'T1', fxRate: 5 }))
    if (!tl.ok) throw new Error(tl.error)
    expect(row(w, tl.invoice.id)).toMatchObject({ currency: 'TRY', fx_rate_micro: 1_000_000, net_base_minor: 100000 })
  })
})

describe('invoices before books start', () => {
  it('are excluded from expenses and profit, marked in lists and links, and can still be linked', async () => {
    const w = world()
    const normal = await w.mk('manager', { no: 'N1', date: '2026-10-06', net: 100 })
    const early = await w.mk('manager', { no: 'P1', date: '2026-02-09', net: 5000 })
    expect((await mng.listInvoices(w.ctx('manager'))).find((i) => i.id === early)).toMatchObject({ approval: 'approved' })
    expect(await decideInvoice(w.ctx('approver'), normal, 'approved', undefined, { expectedVersion: await invVersion(w.ctx('approver'), normal) })).toEqual({ ok: true })
    const oct = (await mng.overview(w.ctx('manager2'))).months.find((m) => m.key === '2026-10')!
    expect(oct.breakdown.invoicesDirect).toBe(100)
    const feb = (await mng.overview(w.ctx('manager2'))).months.find((m) => m.key === '2026-02')
    if (feb) expect(feb.breakdown.invoicesDirect + feb.breakdown.invoicesOverhead).toBe(0)

    const list = await mng.listInvoices(w.ctx('manager'))
    expect(list.find((i) => i.id === early)).toMatchObject({ beforeBooks: true, total: 6000 })
    expect(list.find((i) => i.id === normal)).toMatchObject({ beforeBooks: false })

    expect(await links.linkInvoice(w.ctx('manager'), { invoiceId: early, kind: 'asset', id: w.asset })).toEqual({ ok: true })
    const a = await mng.getAsset(w.ctx('manager'), w.asset)
    expect(a!.invoices![0]).toMatchObject({ id: early, totalTry: 6000, hasPdf: true, date: '2026-02-09', direction: 'in' })
  })

  it('outgoing invoices before books start are excluded from income and receivables; later ones count', async () => {
    const w = world()
    const mkOut = async (no: string, date: string, due: string) => {
      const r = await mng.createInvoice(w.ctx('manager'), inv({ direction: 'out', no, date, due, costKind: undefined, net: 1000 }))
      if (!r.ok) throw new Error(r.error)
      return r.invoice
    }
    const old = await mkOut('O1', '2026-02-10', '2026-03-10')
    const fresh = await mkOut('O2', '2026-10-06', '2026-11-06')
    expect(old.beforeBooks).toBe(true)
    expect(fresh.beforeBooks).toBe(false)
    const o = await mng.overview(w.ctx('manager2'))
    const feb = o.months.find((m) => m.key === '2026-02')
    if (feb) expect(feb.income).toBe(0)
    expect(o.months.find((m) => m.key === '2026-10')!.income).toBe(1000)
    expect(o.receivables.count).toBe(1)
    expect(o.receivables.amount).toBe(1000)
  })
})
