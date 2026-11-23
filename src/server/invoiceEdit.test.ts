import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyRuntimeConfig } from '#/config/runtime'
import { HttpError } from './auth/authorize'
import * as mng from './services/manage'
import * as ia from './services/invoiceApproval'
import { form, pdf, invVersion, setup, type Who } from './testkit'

beforeAll(() => applyRuntimeConfig({ booksStart: '2026-04-01' }))
afterAll(() => applyRuntimeConfig({ booksStart: '' }))

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

const create = (over: Record<string, unknown> = {}) =>
  form({ direction: 'in', fileName: 'f.pdf', file: pdf(), firm: 'Matbaa Ltd.', no: 'A1', date: '2026-10-10', net: 1000, vatRate: 20, toInventory: false, costKind: 'direct', items: [], ...over })

async function world(over: Record<string, unknown> = {}, rates: Record<string, [number, number]> = { '2026-10-10': [34.5, 38], '2026-10-12': [35, 39] }) {
  const s = setup()
  const t = tcmb(rates)
  const r = await mng.createInvoice({ ...s.ctx('manager'), fetcher: t.f }, create(over))
  if (!r.ok) throw new Error(r.error)
  const edit = (who: Who, patch: Record<string, unknown>, version = r.invoice.version) => {
    const i = r.invoice
    return mng.updateInvoice({ ...s.ctx(who), fetcher: t.f }, {
      id: i.id, version, firm: i.firm, no: i.no, date: i.date, currency: i.currency, net: i.netOrig, vatRate: i.vatRate, due: i.due ?? undefined, costKind: i.costKind ?? undefined, ...patch,
    })
  }
  const row = () => s.db.raw.prepare(`SELECT invoice_no, counterparty, invoice_date, currency, fx_rate_micro, net_minor, vat_minor, net_base_minor, vat_base_minor, version FROM invoices WHERE id = ?`).get(r.invoice.id) as Record<string, number | string>
  return { ...s, t, inv: r.invoice, edit, row }
}

const rejects = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(HttpError)
  expect((e as HttpError).status).toBe(status)
}

describe('invoice editing', () => {
  it('updates fields, increments the version and audits before and after', async () => {
    const w = await world()
    const r = await w.edit('manager', { firm: 'Yeni Matbaa', no: 'A2', net: 2000, vatRate: 10, costKind: 'overhead' })
    if (!r.ok) throw new Error(r.error)
    expect(r.invoice).toMatchObject({ firm: 'Yeni Matbaa', no: 'A2', netOrig: 2000, vatRate: 10, costKind: 'overhead', version: 2, total: 2200 })
    expect(w.row()).toMatchObject({ counterparty: 'Yeni Matbaa', invoice_no: 'A2', net_minor: 200000, vat_minor: 20000, version: 2 })
    const a = w.db.raw.prepare(`SELECT before_json, after_json, actor_user_id FROM audit_log WHERE action = 'invoice.update'`).all() as { before_json: string; after_json: string; actor_user_id: string }[]
    expect(a).toHaveLength(1)
    expect(JSON.parse(a[0].before_json)).toMatchObject({ firm: 'Matbaa Ltd.', no: 'A1', net: 1000, vatRate: 20, costKind: 'direct' })
    expect(JSON.parse(a[0].after_json)).toMatchObject({ firm: 'Yeni Matbaa', no: 'A2', net: 2000, vatRate: 10, costKind: 'overhead' })
    expect(a[0].actor_user_id).toBe(w.users.manager.id)
  })

  it('keeps the stored rate and base amounts when an unrelated field changes', async () => {
    const w = await world({ currency: 'USD', net: 100 })
    expect(w.t.calls.length).toBeGreaterThan(0)
    const before = w.row()
    w.t.calls.length = 0
    const r = await w.edit('manager', { firm: 'Başka Ltd.', no: 'Z9', costKind: 'overhead' })
    expect(r.ok).toBe(true)
    expect(w.t.calls).toHaveLength(0)
    expect(w.row()).toMatchObject({ fx_rate_micro: before.fx_rate_micro, net_base_minor: before.net_base_minor, vat_base_minor: before.vat_base_minor })
  })

  it('fetches a new rate and recomputes the base amount when the date changes', async () => {
    const w = await world({ currency: 'USD', net: 100 })
    expect(w.row()).toMatchObject({ fx_rate_micro: 34_500_000, net_base_minor: 345000 })
    w.t.calls.length = 0
    const r = await w.edit('manager', { date: '2026-10-12' })
    if (!r.ok) throw new Error(r.error)
    expect(w.t.calls.length).toBeGreaterThan(0)
    expect(w.row()).toMatchObject({ invoice_date: '2026-10-12', fx_rate_micro: 35_000_000, net_base_minor: 350000 })
    const h = await mng.invoiceHistory(w.ctx('manager'), w.inv.id)
    expect(h.entries[0].text).toBe('Tarih 10 Eki → 12 Eki; Kur 34,5 → 35')
  })

  it('recomputes on amount or currency change and applies a manual rate without calling the provider', async () => {
    const w = await world({ currency: 'USD', net: 100 })
    w.t.calls.length = 0
    const r = await w.edit('manager', { net: 200, fxRate: 50.5 })
    if (!r.ok) throw new Error(r.error)
    expect(w.t.calls).toHaveLength(0)
    expect(w.row()).toMatchObject({ net_minor: 20000, fx_rate_micro: 50_500_000, net_base_minor: 1_010_000 })
    const tl = await w.edit('manager', { currency: 'TRY', net: 200, fxRate: undefined }, 2)
    expect(tl.ok).toBe(true)
    expect(w.row()).toMatchObject({ currency: 'TRY', fx_rate_micro: 1_000_000, net_base_minor: 20000 })
  })

  it('rejects an edit based on an old version and leaves the record unchanged', async () => {
    const w = await world()
    expect((await w.edit('manager', { no: 'A2' })).ok).toBe(true)
    const stale = await w.edit('manager', { no: 'A3' }, 1)
    expect(stale).toMatchObject({ ok: false, error: expect.stringContaining('sen açtıktan sonra değişti') })
    expect(w.row().invoice_no).toBe('A2')
  })

  it('rejects a duplicate company and number but allows saving with its own number', async () => {
    const w = await world()
    expect((await mng.createInvoice(w.ctx('manager'), create({ no: 'B1', fileName: 'b.pdf', file: pdf('b.pdf') }))).ok).toBe(true)
    expect(await w.edit('manager', { no: 'B1' })).toMatchObject({ ok: false, fieldErrors: { no: expect.stringContaining('zaten yüklü') } })
    expect((await w.edit('manager', { firm: 'MATBAA LTD.', costKind: 'overhead' })).ok).toBe(true)
  })

  it('blocks employees, requires a due date on outgoing invoices, ignores archived ones and skips no-op saves', async () => {
    const w = await world()
    await rejects(w.edit('employeeB', { no: 'X' }), 403)
    await rejects(mng.invoiceHistory(w.ctx('employeeA'), w.inv.id), 404)
    expect(await w.edit('manager', {})).toMatchObject({ ok: true })
    expect(w.row().version).toBe(1)
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'invoice.update'`).get()).toEqual({ n: 0 })
    w.db.raw.prepare(`UPDATE invoices SET archived_at = '2026-10-20T00:00:00.000Z' WHERE id = ?`).run(w.inv.id)
    expect(await w.edit('manager', { no: 'Q' })).toMatchObject({ ok: false, error: expect.stringContaining('Arşivdeki') })
    const out = await world({ direction: 'out', due: '2026-11-10', costKind: undefined })
    expect(await out.edit('manager', { due: undefined })).toMatchObject({ ok: false, fieldErrors: { due: 'Vade tarihini gir' } })
  })

  it('applies the books start rule to the new date', async () => {
    const w = await world()
    const r = await w.edit('approver', { date: '2026-02-09' })
    if (!r.ok) throw new Error(r.error)
    expect(r.invoice.beforeBooks).toBe(true)
  })

  it('change history is newest first and records amounts', async () => {
    const w = await world({ currency: 'USD', net: 120 })
    await w.edit('manager', { net: 150, fxRate: 34.5 })
    const h = await mng.invoiceHistory(w.ctx('manager'), w.inv.id)
    expect(h.entries.map((e) => e.text)).toEqual(['Tutar 120,00 $ → 150,00 $', 'Yüklendi'])
    expect(h.entries[0].who).toBe('manager')
    expect(h.mailed).toBeNull()
  })

  it('editing an invoice already mailed to accounting reports it as mailed without resending', async () => {
    const w = await world()
    expect((await mng.invoiceHistory(w.ctx('manager'), w.inv.id)).mailed).toBeNull()
    expect(await ia.decideInvoice(w.ctx('approver'), w.inv.id, 'approved', undefined, { expectedVersion: await invVersion(w.ctx('approver'), w.inv.id) })).toEqual({ ok: true })
    const month = (w.db.raw.prepare(`SELECT created_at FROM accounting_outbox`).get() as { created_at: string }).created_at.slice(0, 7)
    expect((await mng.invoiceHistory(w.ctx('manager'), w.inv.id)).mailed).toEqual({ month, state: 'queued' })
    w.db.raw.prepare(`UPDATE accounting_outbox SET status = 'sent'`).run()
    const v = (w.row().version as number)
    expect(await w.edit('manager', { firm: 'Yeni Ad', no: 'YENI' }, v)).toMatchObject({ ok: false, error: 'Onaylanmış faturayı yalnız onaylayıcı düzeltebilir' })
    expect((await w.edit('approver', { firm: 'Yeni Ad', no: 'YENI' }, v)).ok).toBe(true)
    expect((await mng.invoiceHistory(w.ctx('manager'), w.inv.id)).mailed).toEqual({ month, state: 'sent' })
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM accounting_outbox`).get()).toEqual({ n: 1 })
  })

  it('only the approver can move an invoice from before books start into the books, which approves it and sends it to accounting', async () => {
    const w = await world({ date: '2026-03-10' }, { '2026-03-10': [34, 37], '2026-10-10': [34.5, 38] })
    const st = () => w.db.raw.prepare(`SELECT approval_status, auto_approved, decided_by FROM invoices WHERE id = ?`).get(w.inv.id)
    expect(st()).toEqual({ approval_status: 'approved', auto_approved: 0, decided_by: null })
    const m = await w.edit('manager', { date: '2026-10-10' })
    expect(m.ok).toBe(false)
    expect(w.row()).toMatchObject({ invoice_date: '2026-03-10', version: 1 })
    const k = await w.edit('approver', { date: '2026-10-10' })
    if (!k.ok) throw new Error(k.error)
    expect(st()).toEqual({ approval_status: 'approved', auto_approved: 1, decided_by: w.users.approver.id })
    expect(w.db.raw.prepare(`SELECT count(*) AS n FROM accounting_outbox`).get()).toEqual({ n: 1 })
  })

  it('only the approver can move a pending invoice to before books start', async () => {
    const w = await world()
    const st = () => w.db.raw.prepare(`SELECT approval_status FROM invoices WHERE id = ?`).get(w.inv.id)
    expect(st()).toEqual({ approval_status: 'pending' })
    expect((await w.edit('manager', { date: '2026-03-10' })).ok).toBe(false)
    expect(st()).toEqual({ approval_status: 'pending' })
  })
})
