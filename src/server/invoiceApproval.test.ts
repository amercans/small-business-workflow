import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyRuntimeConfig } from '#/config/runtime'
import { HttpError } from './auth/authorize'
import { deliverAccounting, isLastDayOfMonth, monthEndInvoiceMails, zipSafe, type AccountingConfig } from './accounting'
import { handleActionLink } from './actionLink'
import { hashToken, issueToken } from './actionToken'
import { ACTIONS, deliver, renderMail, type Mailer } from './notify'
import * as ia from './services/invoiceApproval'
import * as mng from './services/manage'
import * as req from './services/requests'
import { expenseInput, form, leaveInput, pdf, invVersion, setup, type Who } from './testkit'

beforeAll(() => applyRuntimeConfig({ booksStart: '2026-04-01', appName: 'Test Paneli', accountingLocale: 'tr' }))
afterAll(() => applyRuntimeConfig({ booksStart: '' }))

type S = ReturnType<typeof setup>
type Sent = Parameters<Mailer['send']>[0]
const recorder = () => {
  const sent: Sent[] = []
  return { sent, mailer: { send: async (m: Sent) => void sent.push(m) } satisfies Mailer }
}
const files = (s: S) => ({
  get: async (key: string) => {
    const f = s.stored.find((x) => x.r2Key === key)
    return f ? { arrayBuffer: async () => f.bytes.slice().buffer as ArrayBuffer } : null
  },
})
const CFG: AccountingConfig = { to: ['accountant@example.com'], cc: ['Örnek Koordinatör <coordinator@example.com>'], replyTo: 'Örnek Koordinatör <coordinator@example.com>', salutation: 'Deniz Örnek' }
const PANEL_URL = 'https://panel.ornek.test'

const inv = (over: Record<string, unknown> = {}) =>
  form({ direction: 'in', fileName: 'fatura.pdf', file: pdf('fatura.pdf'), firm: 'Matbaa Ltd.', no: 'A1', date: '2026-10-10', net: 1000, vatRate: 20, toInventory: false, costKind: 'overhead', items: [], ...over })
async function mk(s: S, who: Who, over: Record<string, unknown> = {}) {
  const r = await mng.createInvoice(s.ctx(who), inv(over))
  if (!r.ok) throw new Error(r.error)
  return r.invoice
}
const acct = (s: S) =>
  s.db.raw.prepare(`SELECT dedupe_key, subject, body_text, attachment_ids, zip_name, zip_paths, from_name, cc_extra FROM accounting_outbox ORDER BY created_at, dedupe_key`).all() as {
    dedupe_key: string; subject: string; body_text: string; attachment_ids: string; zip_name: string | null; zip_paths: string | null; from_name: string | null; cc_extra: string | null
  }[]
const outbox = (s: S) =>
  (
    s.db.raw.prepare(`SELECT to_user_id, template, entity_type, entity_id, message_json FROM email_outbox ORDER BY created_at, dedupe_key`).all() as {
      to_user_id: string; template: string; entity_type: string; entity_id: string; message_json: string
    }[]
  ).map(({ message_json, ...r }) => {
    const m = renderMail('tr', JSON.parse(message_json))
    return { ...r, subject: m.subject, body_text: m.text }
  })
const status = (s: S, id: string) => s.db.raw.prepare(`SELECT approval_status, decided_by, auto_approved, decision_note FROM invoices WHERE id = ?`).get(id)

describe('incoming invoice approval', () => {
  it('an invoice uploaded by an employee or manager waits for approval, notifies the approver with a link placeholder and is not sent to accounting', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    expect(i.approval).toBe('pending')
    expect(acct(s)).toHaveLength(0)
    const o = outbox(s)
    expect(o).toHaveLength(1)
    expect(o[0]).toMatchObject({ to_user_id: s.users.approver.id, template: 'request_submitted', entity_type: 'invoice', entity_id: i.id, subject: 'Onayını bekleyen fatura: Matbaa Ltd. · 1.200,00 ₺' })
    expect(o[0].body_text).toContain(ACTIONS)
  })

  it('an invoice uploaded by the approver is approved and sent at once; outgoing and pre-books invoices skip approval and accounting', async () => {
    const s = setup()
    const a = await mk(s, 'approver')
    expect(status(s, a.id)).toEqual({ approval_status: 'approved', decided_by: s.users.approver.id, auto_approved: 1, decision_note: null })
    const [m] = acct(s)
    expect(m.dedupe_key).toBe(`acct:invoice:${a.id}`)
    expect(m.body_text).toContain('Aşağıdaki gelen fatura otomatik onaylandı.')
    expect(m.body_text).toContain('Yükleyen: approver\nOnaylayan: approver (otomatik)')
    expect(m.from_name).toBeNull()
    expect(m.cc_extra).toBeNull()
    const out = await mk(s, 'manager', { direction: 'out', no: 'S1', firm: 'Müşteri AŞ', due: '2026-11-10', costKind: undefined })
    const early = await mk(s, 'manager', { no: 'J1', firm: 'Eski Firma', date: '2026-02-09' })
    for (const x of [out, early]) expect(status(s, x.id)).toMatchObject({ approval_status: 'approved', decided_by: null, auto_approved: 0 })
    expect(acct(s)).toHaveLength(1)
    expect(outbox(s)).toHaveLength(0)
  })

  it('only the approver decides; one accounting email with the file, an audit entry, and a second decision conflicts', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    for (const w of ['manager', 'manager2', 'owner'] as const) await expect(ia.decideInvoice(s.ctx(w), i.id, 'approved', undefined, { expectedVersion: await invVersion(s.ctx(w), i.id) })).rejects.toBeInstanceOf(HttpError)
    await expect(ia.decideInvoice(s.ctx('employeeB'), i.id, 'approved', undefined, { expectedVersion: await invVersion(s.ctx('employeeB'), i.id) })).rejects.toMatchObject({ status: 404 })
    expect(await ia.decideInvoice(s.ctx('approver'), i.id, 'approved', undefined, { expectedVersion: await invVersion(s.ctx('approver'), i.id) })).toEqual({ ok: true })
    expect(status(s, i.id)).toMatchObject({ approval_status: 'approved', decided_by: s.users.approver.id, auto_approved: 0 })
    const [m] = acct(s)
    expect(m.subject).toBe('Test Paneli / Onaylanan Fatura: Matbaa Ltd. · A1')
    expect(m.body_text).toBe(
      [
        '{GREETING}', '', 'Aşağıdaki gelen fatura approver tarafından onaylandı.', '',
        'Firma: Matbaa Ltd.', 'Fatura No: A1', 'Fatura Tarihi: 10 Ekim 2026', 'Tutar: 1.200,00 ₺ (KDV dahil)', 'Yükleyen: employeeB', 'Onaylayan: approver', 'Onay Tarihi: 21 Ekim 2026',
        '', 'Ek: fatura.pdf', '', 'Bu e-posta Test Paneli tarafından otomatik gönderildi.',
      ].join('\n'),
    )
    expect(JSON.parse(m.attachment_ids)).toHaveLength(1)
    expect(s.db.raw.prepare(`SELECT action FROM audit_log WHERE action = 'invoice.approve'`).all()).toHaveLength(1)
    await expect(ia.decideInvoice(s.ctx('approver'), i.id, 'rejected', 'x', { expectedVersion: await invVersion(s.ctx('approver'), i.id) })).rejects.toBeInstanceOf(HttpError)
  })

  it('rejection needs a reason, mails the uploader, skips accounting, shows the reason in the list and is not counted as an expense', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB', { costKind: 'direct' })
    expect(await ia.decideInvoice(s.ctx('approver'), i.id, 'rejected', '  ', { expectedVersion: await invVersion(s.ctx('approver'), i.id) })).toEqual({ ok: false, error: 'Red gerekçesi zorunlu' })
    expect(await ia.decideInvoice(s.ctx('approver'), i.id, 'rejected', 'Tutar yanlış', { expectedVersion: await invVersion(s.ctx('approver'), i.id) })).toEqual({ ok: true })
    expect(status(s, i.id)).toMatchObject({ approval_status: 'rejected', decision_note: 'Tutar yanlış' })
    expect(acct(s)).toHaveLength(0)
    const rej = outbox(s).find((m) => m.to_user_id === s.users.employeeB.id)!
    expect(rej.subject).toBe('Fatura reddedildi: Matbaa Ltd.')
    expect(rej.body_text).toContain('Gerekçe: Tutar yanlış')
    expect((await mng.listInvoices(s.ctx('employeeB'))).find((x) => x.id === i.id)).toMatchObject({ approval: 'rejected', rejectNote: 'Tutar yanlış' })
    expect((await mng.overview(s.ctx('manager2'))).months.find((m) => m.key === '2026-10')!.breakdown.invoicesDirect).toBe(0)
  })

  it('the approvals page shows pending invoices only to the approver', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    await mk(s, 'approver', { no: 'K1' })
    const a = await req.approvals(s.ctx('approver'))
    expect(a.invoices.map((x) => x.id)).toEqual([i.id])
    expect(a.invoices[0]).toMatchObject({ firm: 'Matbaa Ltd.', no: 'A1', total: '1.200,00 ₺', who: 'employeeB' })
    expect((await req.approvals(s.ctx('owner'))).invoices).toEqual([])
  })
})

describe('month-end invoice summary', () => {
  it('last day of the month follows the configured time zone and leap years', () => {
    expect(isLastDayOfMonth('2026-11-30')).toBe(true)
    expect(isLastDayOfMonth('2026-11-29')).toBe(false)
    expect(isLastDayOfMonth('2026-12-31')).toBe(true)
    expect(isLastDayOfMonth('2027-02-28')).toBe(true)
    expect(isLastDayOfMonth('2028-02-28')).toBe(false)
    expect(isLastDayOfMonth('2028-02-29')).toBe(true)
  })

  it('lists the month\'s approved invoices with uploader and approver, excludes the rest, groups files by company in a zip and runs once', async () => {
    const s = setup()
    const a = await mk(s, 'employeeB', { no: 'A1', firm: 'Matbaa Ltd.' })
    const b = await mk(s, 'approver', { no: 'B1', firm: 'Kırtasiye / Ofis AŞ', fileName: 'fatura.pdf', file: pdf('fatura.pdf', 300) })
    const c = await mk(s, 'approver', { no: 'B2', firm: 'Kırtasiye / Ofis AŞ', fileName: 'fatura.pdf', file: pdf('fatura.pdf', 200) })
    const pending = await mk(s, 'employeeB', { no: 'P1', firm: 'Bekleyen Ltd.' })
    const rejected = await mk(s, 'employeeB', { no: 'R1', firm: 'Red Ltd.' })
    await mk(s, 'manager', { direction: 'out', no: 'S1', firm: 'Müşteri AŞ', due: '2026-11-10', costKind: undefined })
    await mk(s, 'manager', { no: 'J1', firm: 'Eski Firma', date: '2026-02-09' })
    expect(await ia.decideInvoice(s.ctx('approver'), a.id, 'approved', undefined, { expectedVersion: await invVersion(s.ctx('approver'), a.id) })).toEqual({ ok: true })
    expect(await ia.decideInvoice(s.ctx('approver'), rejected.id, 'rejected', 'yanlış', { expectedVersion: await invVersion(s.ctx('approver'), rejected.id) })).toEqual({ ok: true })
    s.db.raw.prepare(`UPDATE invoices SET decided_at = '2026-11-12T10:00:00.000Z', created_at = '2026-11-12T09:00:00.000Z' WHERE id IN (?, ?)`).run(a.id, b.id)
    s.db.raw.prepare(`UPDATE invoices SET decided_at = '2026-11-30T20:59:59.000Z' WHERE id = ?`).run(c.id)
    const before = acct(s).length
    expect(await monthEndInvoiceMails(s.db, '2026-11-29')).toEqual([])
    await s.db.batch(await monthEndInvoiceMails(s.db, '2026-11-30'))
    expect(await monthEndInvoiceMails(s.db, '2026-11-30')).toEqual([])
    const m = acct(s).slice(before)
    expect(m).toHaveLength(1)
    expect(m[0].subject).toBe('Test Paneli / Kasım 2026 fatura özeti (3 adet)')
    expect(m[0].body_text).toContain('Kasım 2026 döneminde onaylanan gelen faturaların özeti (3 adet, toplam 3.600,00 ₺ KDV dahil)')
    expect(m[0].body_text).toContain('Firma: Matbaa Ltd.\nFatura No: A1\nFatura Tarihi: 10 Ekim 2026\nTutar: 1.200,00 ₺ (KDV dahil)\nYükleyen: employeeB\nOnaylayan: approver')
    expect(m[0].body_text).toContain('Yükleyen: approver\nOnaylayan: approver (otomatik)')
    expect(m[0].body_text).not.toMatch(/Bekleyen Ltd|Red Ltd|Müşteri AŞ|Eski Firma/)
    expect(m[0].zip_name).toBe('Faturalar-Kasim-2026.zip')
    expect(m[0].body_text).toContain('Ek: Faturalar-Kasim-2026.zip (3 dosya, firma klasörlerinde)')
    expect(Object.values(JSON.parse(m[0].zip_paths!)).sort()).toEqual(['Kırtasiye Ofis AŞ/B2 fatura.pdf', 'Kırtasiye Ofis AŞ/fatura.pdf', 'Matbaa Ltd./fatura.pdf'])
    void pending

    s.db.raw.prepare(`UPDATE accounting_outbox SET status = 'sent' WHERE dedupe_key NOT LIKE 'acct:invoices_monthend:%'`).run()
    const { sent, mailer } = recorder()
    expect(await deliverAccounting(s.db, files(s), mailer, CFG)).toEqual({ sent: 1, failed: 0 })
    expect(sent[0].attachments).toHaveLength(1)
    expect(sent[0].attachments![0]).toMatchObject({ name: 'Faturalar-Kasim-2026.zip', contentType: 'application/zip' })
    const tree = unzipSync(sent[0].attachments![0].bytes)
    expect(Object.keys(tree).sort()).toEqual(['Kırtasiye Ofis AŞ/B2 fatura.pdf', 'Kırtasiye Ofis AŞ/fatura.pdf', 'Matbaa Ltd./fatura.pdf'])
    expect(tree['Kırtasiye Ofis AŞ/fatura.pdf'].length).toBe(300)
    expect(sent[0].cc).toEqual(CFG.cc)
  })

  it('zip entry names are safe: no path separators, parent directories or control characters', () => {
    expect(zipSafe('../../etc/passwd', 'x')).toBe('etc passwd')
    expect(zipSafe('A\\B:C*?"<>|D', 'x')).toBe('A B C D')
    expect(zipSafe('...', 'Firma')).toBe('Firma')
    expect(zipSafe('Örnek\u0000Ltd', 'x')).toBe('Örnek Ltd')
  })
})

const ORIGIN = 'https://panel.ornek.test'
const get = (s: S, path: string) => handleActionLink(new Request(`${ORIGIN}${path}`), new URL(`${ORIGIN}${path}`), { db: s.db, panelUrl: PANEL_URL, ctxFor: (user) => ({ ...s.ctx('approver'), user }) })
const post = (s: S, path: string, body: Record<string, string>, origin = ORIGIN) =>
  handleActionLink(new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams(body) }), new URL(`${ORIGIN}${path}`), {
    db: s.db, panelUrl: PANEL_URL, ctxFor: (user) => ({ ...s.ctx('approver'), user }),
  })

describe('approval link from email', () => {
  it('the link is created at delivery: no raw link in the queue, only a hash stored; plain text plus HTML buttons; valid 7 days', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    const { sent, mailer } = recorder()
    await deliver(s.db, mailer, PANEL_URL)
    expect(sent).toHaveLength(1)
    const t = sent[0].text.match(/\/a\/([A-Za-z0-9_-]{43})/)![1]
    expect(sent[0].text).toContain(`Onayla: ${PANEL_URL}/a/${t}\nReddet: ${PANEL_URL}/a/${t}?r=1`)
    expect(sent[0].html).toContain(`href="${PANEL_URL}/a/${t}"`)
    expect(sent[0].html).toContain('Onayla</a>')
    const row = s.db.raw.prepare(`SELECT token_hash, entity_type, entity_id, user_id, created_at, expires_at FROM action_tokens`).get() as Record<string, string>
    expect(row).toMatchObject({ token_hash: await hashToken(t), entity_type: 'invoice', entity_id: i.id, user_id: s.users.approver.id })
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(7 * 24 * 3600_000)
    const dump = JSON.stringify(s.db.raw.prepare(`SELECT * FROM email_outbox`).all()) + JSON.stringify(s.db.raw.prepare(`SELECT * FROM action_tokens`).all())
    expect(dump).not.toContain(t)
  })

  it('GET never decides; POST approves once and audits via=email', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    const t = await issueToken(s.db, { entityType: 'invoice', entityId: i.id, userId: s.users.approver.id })
    const g = await get(s, `/a/${t}`)
    expect(g.status).toBe(200)
    const html = await g.text()
    expect(html).toContain('Matbaa Ltd.')
    expect(html).toContain('name="d" value="approved"')
    expect(g.headers.get('Referrer-Policy')).toBe('strict-origin')
    expect(status(s, i.id)).toMatchObject({ approval_status: 'pending' })
    expect((await post(s, `/a/${t}`, { t, d: 'approved', v: String(await invVersion(s.ctx('approver'), i.id)) })).status).toBe(200)
    expect(status(s, i.id)).toMatchObject({ approval_status: 'approved', decided_by: s.users.approver.id })
    const a = s.db.raw.prepare(`SELECT meta_json FROM audit_log WHERE action = 'invoice.approve'`).get() as { meta_json: string }
    expect(JSON.parse(a.meta_json)).toEqual({ via: 'email' })
    expect(acct(s)).toHaveLength(1)
    expect((await get(s, `/a/${t}`)).status).toBe(410)
    expect((await post(s, `/a/${t}`, { t, d: 'approved' })).status).toBe(410)
  })

  it('rejection without a reason returns 422 and with a reason rejects', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    const t = await issueToken(s.db, { entityType: 'invoice', entityId: i.id, userId: s.users.approver.id })
    expect((await post(s, `/a/${t}`, { t, d: 'rejected', n: ' ' })).status).toBe(422)
    expect((await post(s, `/a/${t}`, { t, d: 'rejected', n: 'Fatura okunmuyor', v: String(await invVersion(s.ctx('approver'), i.id)) })).status).toBe(200)
    expect(status(s, i.id)).toMatchObject({ approval_status: 'rejected', decision_note: 'Fatura okunmuyor' })
  })

  it('a decision is refused with 409 if the invoice changed after the link was opened', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    const t = await issueToken(s.db, { entityType: 'invoice', entityId: i.id, userId: s.users.approver.id })
    const seen = await invVersion(s.ctx('approver'), i.id)
    s.db.raw.prepare(`UPDATE invoices SET net_minor = net_minor + 100, net_base_minor = net_base_minor + 100, version = version + 1 WHERE id = ?`).run(i.id)
    expect((await post(s, `/a/${t}`, { t, d: 'approved', v: String(seen) })).status).toBe(409)
    expect(s.db.raw.prepare(`SELECT approval_status FROM invoices WHERE id = ?`).get(i.id)).toEqual({ approval_status: 'pending' })
    expect((await post(s, `/a/${t}`, { t, d: 'approved' })).status).toBe(409)
  })

  it('invalid links: wrong 404; expired or already decided 410; cross-site POST 403; body and path mismatch 400', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    expect((await get(s, `/a/${'x'.repeat(43)}`)).status).toBe(404)
    expect((await get(s, '/a/kisa')).status).toBe(404)
    const t = await issueToken(s.db, { entityType: 'invoice', entityId: i.id, userId: s.users.approver.id })
    expect((await post(s, `/a/${t}`, { t, d: 'approved' }, 'https://kotu.example')).status).toBe(403)
    expect((await post(s, `/a/${t}`, { t: 'baska', d: 'approved' })).status).toBe(400)
    expect(status(s, i.id)).toMatchObject({ approval_status: 'pending' })
    const old = await issueToken(s.db, { entityType: 'invoice', entityId: i.id, userId: s.users.approver.id }, new Date(Date.now() - 8 * 24 * 3600_000))
    expect((await get(s, `/a/${old}`)).status).toBe(410)
    expect(await ia.decideInvoice(s.ctx('approver'), i.id, 'approved', undefined, { expectedVersion: await invVersion(s.ctx('approver'), i.id) })).toEqual({ ok: true })
    expect((await get(s, `/a/${t}`)).status).toBe(410)
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM action_tokens WHERE used_at IS NULL AND entity_id = ?`).get(i.id)).toEqual({ n: 0 })
  })

  it('a request link approves an expense; the leave summary hides the leave type and the note', async () => {
    const s = setup()
    const e = await req.submitExpense(s.ctx('employeeA'), expenseInput(4321))
    if (!e.ok) throw new Error(e.error)
    const te = await issueToken(s.db, { entityType: 'request', entityId: e.requests[0].id, userId: s.users.approver.id })
    const ge = await (await get(s, `/a/${te}`)).text()
    expect(ge).toContain('4.321,00 ₺')
    expect((await post(s, `/a/${te}`, { t: te, d: 'approved' })).status).toBe(200)
    expect(s.db.raw.prepare(`SELECT status FROM requests WHERE id = ?`).get(e.requests[0].id)).toEqual({ status: 'approved' })
    const a = s.db.raw.prepare(`SELECT meta_json FROM audit_log WHERE action = 'request.approve'`).get() as { meta_json: string }
    expect(JSON.parse(a.meta_json)).toEqual({ via: 'email' })

    const l = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', note: 'grip' }))
    if (!l.ok) throw new Error(l.error)
    const tl = await issueToken(s.db, { entityType: 'request', entityId: l.request.id, userId: s.users.approver.id })
    const gl = await (await get(s, `/a/${tl}`)).text()
    expect(gl).toContain('İzin talebi')
    expect(gl).not.toMatch(/Raporlu|rapor|sağlık|grip/i)
    const tm = await issueToken(s.db, { entityType: 'request', entityId: l.request.id, userId: s.users.manager.id })
    expect((await get(s, `/a/${tm}`)).status).toBe(410)
  })

  it('the waiting-for-approval email has the link; the information email does not', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('employeeA'), expenseInput())
    const { sent, mailer } = recorder()
    await deliver(s.db, mailer, PANEL_URL)
    const toKoord = sent.find((m) => m.to === 'approver@ornek.test')!
    const toMudur = sent.find((m) => m.to === 'manager@ornek.test')!
    expect(toKoord.text).toMatch(/Onayla: https:\/\/panel\.ornek\.test\/a\/[A-Za-z0-9_-]{43}/)
    expect(toKoord.html).toBeDefined()
    expect(toMudur.text).not.toContain('/a/')
    expect(toMudur.text).not.toContain(ACTIONS)
    expect(toMudur.html).toBeUndefined()
  })
})

describe('email link hardening', () => {
  it('decisions from email record IP address and browser in the audit log', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    const t = await issueToken(s.db, { entityType: 'invoice', entityId: i.id, userId: s.users.approver.id })
    const v = String(await invVersion(s.ctx('approver'), i.id))
    const r = new Request(`${ORIGIN}/a/${t}`, { method: 'POST', headers: { Origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (iPhone)' }, body: new URLSearchParams({ t, d: 'approved', v }) })
    expect((await handleActionLink(r, new URL(`${ORIGIN}/a/${t}`), { db: s.db, panelUrl: PANEL_URL, ctxFor: (user) => ({ ...s.ctx('approver'), user }) })).status).toBe(200)
    const a = s.db.raw.prepare(`SELECT meta_json FROM audit_log WHERE action = 'invoice.approve'`).get() as { meta_json: string }
    expect(JSON.parse(a.meta_json)).toEqual({ via: 'email', ip: '203.0.113.7', ua: 'Mozilla/5.0 (iPhone)' })
  })

  it('a placeholder in a company name and an outside URL: one link is generated and the outside URL is not clickable', async () => {
    const s = setup()
    await mk(s, 'employeeB', { firm: `Matbaa ${ACTIONS} https://kotu.example/giris` })
    const { sent, mailer } = recorder()
    await deliver(s.db, mailer, PANEL_URL)
    expect(sent).toHaveLength(1)
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM action_tokens`).get()).toEqual({ n: 1 })
    expect(sent[0].text.match(/\/a\/[A-Za-z0-9_-]{43}/g)).toHaveLength(2)
    expect(sent[0].html).not.toContain('href="https://kotu.example')
    expect(sent[0].html).toContain(`href="${PANEL_URL}/approvals"`)
  })

  it('emails other than the approval template never get a generated link', async () => {
    const s = setup()
    const i = await mk(s, 'employeeB')
    await deliver(s.db, recorder().mailer, PANEL_URL)
    const before = (s.db.raw.prepare(`SELECT count(*) AS n FROM action_tokens`).get() as { n: number }).n
    expect(await ia.decideInvoice(s.ctx('approver'), i.id, 'rejected', `Okunmuyor ${ACTIONS}`, { expectedVersion: await invVersion(s.ctx('approver'), i.id) })).toEqual({ ok: true })
    const { sent, mailer } = recorder()
    await deliver(s.db, mailer, PANEL_URL)
    expect(sent.length).toBeGreaterThan(0)
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM action_tokens`).get()).toEqual({ n: before })
    for (const m of sent) {
      expect(m.text).not.toContain('/a/')
      expect(m.text).not.toContain(ACTIONS)
    }
  })
})

