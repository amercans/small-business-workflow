import { describe, expect, it } from 'vitest'
import { dailyMails, deliver, enqueue, renderMail, type Mail, type Mailer } from './notify'
import { applyRuntimeConfig } from '#/config/runtime'
import * as req from './services/requests'
import { expenseInput, leaveInput, setup } from './testkit'

applyRuntimeConfig({ appName: 'Test Paneli' })

const outbox = (s: ReturnType<typeof setup>) =>
  (
    s.db.raw.prepare(`SELECT to_user_id, template, message_json, status FROM email_outbox ORDER BY created_at, to_user_id`).all() as {
      to_user_id: string; template: string; message_json: string; status: string
    }[]
  ).map((r) => {
    const m = renderMail('tr', JSON.parse(r.message_json))
    return { to_user_id: r.to_user_id, template: r.template, status: r.status, subject: m.subject, body_text: m.text }
  })

const rendered = (m: Mail) => renderMail('tr', m.message)

describe('notification queue', () => {
  it("a new request asks the approver and informs managers; neither the requester nor the owner gets it", async () => {
    const s = setup()
    await req.submitLeave(s.ctx('employeeA'), leaveInput())
    const o = outbox(s)
    const toKoord = o.find((m) => m.to_user_id === s.users.approver.id)!
    expect(toKoord.subject).toBe('Onayını bekleyen izin talebi: employeeA')
    expect(toKoord.body_text).toContain('için yıllık izin talebi (2 iş günü)')
    expect(toKoord.body_text).toContain('Yıllık izin bakiyesi: 14 gün. Bu talep onaylanırsa 12 gün kalır.')
    const fyi = o.filter((m) => m.subject.startsWith('Yeni izin talebi'))
    expect(fyi.map((m) => m.to_user_id).sort()).toEqual([s.users.manager.id, s.users.manager2.id].sort())
    expect(fyi[0].body_text).toContain('Talep Onaylayıcı rolünün onayına gitti')
    expect(o.some((m) => [s.users.owner.id, s.users.employeeA.id].includes(m.to_user_id))).toBe(false)
  })
  it('half-day leave is described with its time in the email', async () => {
    const s = setup()
    await req.submitLeave(s.ctx('employeeA'), leaveInput({ span: 'half_day', end: '2026-11-02', half: 'morning' }))
    expect(outbox(s).find((m) => m.to_user_id === s.users.approver.id)?.body_text).toContain('2 Kas 09:00–13:00 için yıllık izin talebi (4 saat)')
  })
  it("sends the approver's own request to the owner for approval and informs managers", async () => {
    const s = setup()
    await req.submitExpense(s.ctx('approver'), expenseInput())
    const o = outbox(s)
    expect(o.map((m) => m.to_user_id).sort()).toEqual([s.users.manager.id, s.users.manager2.id, s.users.owner.id].sort())
    expect(o.find((m) => m.to_user_id === s.users.owner.id)?.subject).toContain('Onayını bekleyen talep: approver')
    expect(o.find((m) => m.to_user_id === s.users.manager.id)?.body_text).toContain('Şirket sahibi rolünün onayına gitti')
  })
  it("approves the owner's own request automatically, informs managers and never mails the owner about results", async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('owner'), expenseInput())
    if (!r.ok) throw new Error(r.error)
    expect(s.db.raw.prepare(`SELECT status FROM requests WHERE id = ?`).get(r.requests[0].id)).toEqual({ status: 'approved' })
    expect(outbox(s).find((m) => m.to_user_id === s.users.manager.id)?.body_text).toContain('Talep sahibinin rolü nedeniyle otomatik onaylandı')
    await req.markPaid(s.ctx('approver'), r.requests[0].id)
    expect(outbox(s).some((m) => m.to_user_id === s.users.owner.id)).toBe(false)
  })
  it('includes the amount but never the title, note or health details', async () => {
    const s = setup()
    await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', note: 'grip' }))
    await req.submitExpense(s.ctx('employeeA'), expenseInput(4321))
    const o = outbox(s)
    for (const m of o) expect(m.subject + m.body_text).not.toMatch(/Raporlu|sağlık|grip|Ekip yemeği/i)
    expect(o.some((m) => m.subject.includes('4.321,00 ₺') && m.body_text.includes('4.321,00 ₺ tutarında masraf talebi'))).toBe(true)
    expect(o.some((m) => m.body_text.includes('bu izin bakiyeden düşmez'))).toBe(true)
    const s2 = setup()
    await req.submitLeave(s2.ctx('employeeA'), leaveInput({ kind: 'excuse' }))
    for (const m of outbox(s2)) expect(m.body_text).not.toMatch(/mazeret|ücretsiz/i)
  })
  it('a failed submit does not queue the email (same batch)', async () => {
    const s = setup()
    await req.submitLeave(s.ctx('employeeA'), leaveInput())
    const before = outbox(s).length
    expect((await req.submitLeave(s.ctx('employeeA'), leaveInput())).ok).toBe(false)
    expect(outbox(s)).toHaveLength(before)
  })
  it('decision and payment emails go to the requester; a race produces one email', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('employeeA'), expenseInput())
    if (!r.ok) throw new Error(r.error)
    const id = r.requests[0].id
    await Promise.all([req.decide(s.ctx('approver'), id, 'approved'), req.decide(s.ctx('approver'), id, 'approved')])
    await req.markPaid(s.ctx('approver'), id)
    const mine = outbox(s).filter((m) => m.to_user_id === s.users.employeeA.id)
    expect(mine.map((m) => m.subject)).toEqual(['Masraf talebin onaylandı', expect.stringMatching(/^Masraf talebin ödendi · [\d.,]+ ₺$/)])
  })
  it('the same event is not queued twice', async () => {
    const s = setup()
    const m: Mail = { to: s.users.employeeA.id, template: 'agreement_expiring', entityType: 'user', entityId: 'x', dedupe: 'k1', message: { kind: 'invoiceRejected', params: { firm: 'Örnek Ltd.', no: '1', reason: 'r' } } }
    await s.db.batch(enqueue(s.db, [m]))
    await s.db.batch(enqueue(s.db, [m]))
    expect(outbox(s)).toHaveLength(1)
  })
})

describe('delivery', () => {
  it('fills in the panel URL, skips inactive recipients and retries on error', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('employeeA'), expenseInput())
    s.db.raw.prepare(`INSERT INTO email_outbox (id, to_user_id, template, entity_type, entity_id, dedupe_key, message_json) VALUES ('88888888888888888888888888', ?, 'agreement_expiring', 'user', 'x', 'p', '{"kind":"invoiceRejected","params":{"firm":"Örnek Ltd.","no":"1","reason":"r"}}')`).run(s.users.inactive.id)
    const got: { to: string; text: string }[] = []
    const ok: Mailer = { send: async (m) => void got.push(m) }
    expect(await deliver(s.db, ok, 'https://panel.ornek/')).toEqual({ sent: 3, failed: 1 })
    expect(got.find((m) => m.to === 'approver@ornek.test')?.text).toContain('https://panel.ornek/approvals')
    expect(got.find((m) => m.to === 'manager@ornek.test')?.text).toContain('https://panel.ornek/all-requests/')
    const bad: Mailer = { send: async () => { throw new Error('kanal kapalı') } }
    await req.submitAdvance(s.ctx('employeeB'), { json: { amount: 10, reason: 'x' }, files: new Map() })
    await deliver(s.db, bad, 'https://p')
    const q = s.db.raw.prepare(`SELECT status, attempts, last_error FROM email_outbox WHERE status = 'queued'`).get()
    expect(q).toEqual({ status: 'queued', attempts: 1, last_error: 'kanal kapalı' })
  })
})

describe('delivery safety', () => {
  it('two concurrent deliveries do not send the same email twice; placeholder addresses are never mailed', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('employeeA'), expenseInput())
    const got: string[] = []
    const slow: Mailer = { send: async (m) => { await new Promise((r) => setTimeout(r, 5)); got.push(m.to) } }
    await Promise.all([deliver(s.db, slow, 'https://p'), deliver(s.db, slow, 'https://p')])
    expect(got.length).toBe(new Set(got).size)
    await req.submitAdvance(s.ctx('employeeB'), { json: { amount: 10, reason: 'x' }, files: new Map() })
    const key = (m: { to: string; subject: string }) => `${m.to}|${m.subject}`
    let outer = ''
    const inner: string[] = []
    const reentrant: Mailer = {
      send: async (m) => {
        outer = key(m)
        await deliver(s.db, { send: async (x) => void inner.push(key(x)) }, 'https://p')
      },
    }
    await deliver(s.db, reentrant, 'https://p', 1)
    expect(outer).not.toBe('')
    expect(inner).not.toContain(outer)
    s.db.raw.prepare(`UPDATE users SET email = 'someone@no-login.invalid' WHERE id = ?`).run(s.users.approver.id)
    s.db.raw.prepare(`INSERT INTO email_outbox (id, to_user_id, template, entity_type, entity_id, dedupe_key, message_json) VALUES ('66666666666666666666666666', ?, 'agreement_expiring', 'user', 'x', 'inv', '{"kind":"invoiceRejected","params":{"firm":"Örnek Ltd.","no":"1","reason":"r"}}')`).run(s.users.approver.id)
    expect(await deliver(s.db, slow, 'https://p')).toEqual({ sent: 0, failed: 1 })
  })
})

describe('stale notifications', () => {
  it('queue entries older than 48 hours are not sent', async () => {
    const s = setup()
    s.db.raw.prepare(`INSERT INTO email_outbox (id, to_user_id, template, entity_type, entity_id, dedupe_key, message_json, created_at) VALUES ('77777777777777777777777777', ?, 'agreement_expiring', 'user', 'x', 'old', '{"kind":"invoiceRejected","params":{"firm":"Örnek Ltd.","no":"1","reason":"r"}}', '2026-01-01T00:00:00.000Z')`).run(s.users.approver.id)
    const got: unknown[] = []
    expect(await deliver(s.db, { send: async (m) => void got.push(m) }, 'https://p')).toEqual({ sent: 0, failed: 0 })
    expect(s.db.raw.prepare(`SELECT status, last_error FROM email_outbox`).get()).toEqual({ status: 'failed', last_error: 'expired' })
  })
})

describe('daily job', () => {
  it('no pending-request reminder; agreements 30 days before the end go to managers only', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('employeeA'), expenseInput())
    expect(await dailyMails(s.db, '2026-10-25')).toEqual([])
    s.db.raw.prepare(`INSERT INTO agreements (id, title, counterparty, start_date, end_date, created_by, updated_by) VALUES ('55555555555555555555555555', 'İçerik', 'Narlı A.Ş.', '2026-01-01', '2026-11-15', ?, ?)`).run(s.users.manager.id, s.users.manager.id)
    const ag = await dailyMails(s.db, '2026-10-21')
    expect(ag.map((m) => m.to).sort()).toEqual([s.users.manager.id, s.users.manager2.id].sort())
    expect(rendered(ag[0]).subject).toBe('Bitişi yaklaşan sözleşme: Narlı A.Ş.')
  })
  it('software renewals within 30 days go to managers for active records only, without amounts', async () => {
    const s = setup()
    const ins = s.db.raw.prepare(`INSERT INTO digital_assets (id, kind, name, period, renews_on, cost_minor, status, created_by, updated_by) VALUES (?, 'software', ?, 'yearly', ?, 15600000, ?, ?, ?)`)
    ins.run('66666666666666666666666661', 'Tasarım yazılımı', '2026-11-12', 'active', s.users.manager.id, s.users.manager.id)
    ins.run('66666666666666666666666662', 'Eski abonelik', '2026-11-01', 'cancelled', s.users.manager.id, s.users.manager.id)
    ins.run('66666666666666666666666663', 'Uzak yenileme', '2027-03-01', 'active', s.users.manager.id, s.users.manager.id)
    const m = await dailyMails(s.db, '2026-10-21')
    expect(m.map((x) => x.to).sort()).toEqual([s.users.manager.id, s.users.manager2.id].sort())
    expect(rendered(m[0]).subject).toBe('Yenileme yaklaşıyor: Tasarım yazılımı')
    expect(rendered(m[0]).text).toContain('22 gün kaldı')
    expect(rendered(m[0]).text).not.toMatch(/156|₺/)
  })
})

describe('recipient language', () => {
  it('the same notification arrives in English for an English user and in Turkish for a Turkish user', async () => {
    const s = setup()
    s.db.raw.prepare(`UPDATE users SET locale = 'en' WHERE id = ?`).run(s.users.approver.id)
    s.db.raw.prepare(`UPDATE users SET locale = 'tr' WHERE id = ?`).run(s.users.manager.id)
    await req.submitExpense(s.ctx('employeeA'), expenseInput(4321))
    const got: { to: string; subject: string; text: string; html?: string }[] = []
    await deliver(s.db, { send: async (m) => void got.push(m) }, 'https://panel.example.com')
    const en = got.find((m) => m.to === 'approver@ornek.test')!
    const tr = got.find((m) => m.to === 'manager@ornek.test')!
    expect(en.subject).toBe('Request awaiting your approval: employeeA · Expense · ₺4,321.00')
    expect(en.text).toContain('employeeA submitted an expense request for ₺4,321.00. It is waiting for your approval.')
    expect(en.text).toContain('Approve: https://panel.example.com/a/')
    expect(en.text).toContain('This email was sent automatically by Test Paneli.')
    expect(en.html).toContain('lang="en"')
    expect(tr.subject).toBe('Yeni talep: employeeA · Masraf · 4.321,00 ₺')
    expect(tr.text).toContain('4.321,00 ₺ tutarında masraf talebi gönderdi.')
    expect(tr.text).toContain('Bu e-posta Test Paneli tarafından otomatik gönderildi.')
  })
})
