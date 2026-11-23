import { describe, expect, it } from 'vitest'
import { attachLines, deliverAccounting, longDay, MAX_ATTACH_BYTES, mergeCc, requesterCc, senderName, type AccountingConfig } from './accounting'
import { resendMailer } from './resend'
import { applyRuntimeConfig } from '#/config/runtime'
import type { Mailer } from './notify'
import * as req from './services/requests'
import { advanceInput, expenseInput, form, leaveInput, pdf, setup } from './testkit'

const acct = (s: ReturnType<typeof setup>) =>
  s.db.raw.prepare(`SELECT kind, entity_id, subject, body_text, attachment_ids, status, delivered_to FROM accounting_outbox ORDER BY created_at, dedupe_key`).all() as {
    kind: string; entity_id: string; subject: string; body_text: string; attachment_ids: string; status: string; delivered_to: string | null
  }[]

const files = (s: ReturnType<typeof setup>) => ({
  get: async (key: string) => {
    const f = s.stored.find((x) => x.r2Key === key)
    return f ? { arrayBuffer: async () => f.bytes.slice().buffer as ArrayBuffer } : null
  },
})

applyRuntimeConfig({ appName: 'Test Paneli', accountingLocale: 'tr' })

type Sent = Parameters<Mailer['send']>[0]
const recorder = () => {
  const sent: Sent[] = []
  return { sent, mailer: { send: async (m: Sent) => void sent.push(m) } satisfies Mailer }
}

const CFG: AccountingConfig = {
  to: ['accountant@example.com'],
  cc: ['Örnek Koordinatör <coordinator@example.com>'],
  replyTo: 'Örnek Koordinatör <coordinator@example.com>',
  salutation: 'Deniz Örnek',
}

describe('accounting email: when', () => {
  it('an expense is queued when the approver approves it; the template matches exactly', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('employeeA'), expenseInput(1250))
    if (!r.ok) throw new Error(r.error)
    expect(acct(s)).toHaveLength(0)
    expect((await req.decide(s.ctx('approver'), r.requests[0].id, 'approved')).ok).toBe(true)
    const [m] = acct(s)
    expect(m.subject).toBe('Test Paneli / Onaylanan Masraf: employeeA')
    expect(m.body_text).toBe(
      [
        '{GREETING}',
        '',
        'Aşağıdaki masraf talebi approver tarafından onaylandı.',
        '',
        'Çalışan: employeeA',
        'Tür: Masraf',
        'Tutar: 1.250,00 ₺ (KDV dahil)',
        'Harcama Tarihi: 20 Ekim 2026',
        'Açıklama: Ekip yemeği',
        'Onay Tarihi: 21 Ekim 2026',
        'Ödeme: Maaş Hesabı',
        '',
        'Ek: fis.jpg',
        '',
        'Bu e-posta Test Paneli tarafından otomatik gönderildi.',
      ].join('\n'),
    )
    expect(JSON.parse(m.attachment_ids)).toHaveLength(1)
    expect(m.body_text).not.toMatch(/https?:|TR\d{2}|IBAN/)
  })

  it('rejection and pending requests produce no email; the same request is not queued twice', async () => {
    const s = setup()
    const a = await req.submitExpense(s.ctx('employeeA'), expenseInput())
    const b = await req.submitAdvance(s.ctx('employeeA'), advanceInput())
    if (!a.ok || !b.ok) throw new Error('talep')
    await req.decide(s.ctx('approver'), a.requests[0].id, 'rejected', 'Fiş okunmuyor')
    expect(acct(s)).toHaveLength(0)
    await req.decide(s.ctx('approver'), b.requests[0].id, 'approved')
    await req.markPaid(s.ctx('approver'), b.requests[0].id)
    expect(acct(s)).toHaveLength(1)
  })

  it('purchase and travel approvals are not sent to accounting', async () => {
    const s = setup()
    const p = await req.submitPurchase(s.ctx('employeeA'), form({ kind: 'equipment', name: 'Lens', unitPrice: 1000, quantity: 2, reason: 'Gerekli' }))
    if (!p.ok) throw new Error(p.error)
    await req.decide(s.ctx('approver'), p.requests[0].id, 'approved')
    expect(acct(s)).toHaveLength(0)
  })

  it('advance: payment request with type, amount without a VAT note and the description', async () => {
    const s = setup()
    const r = await req.submitAdvance(s.ctx('employeeA'), advanceInput(3500))
    if (!r.ok) throw new Error(r.error)
    await req.decide(s.ctx('approver'), r.requests[0].id, 'approved')
    const [m] = acct(s)
    expect(m.subject).toBe('Test Paneli / Onaylanan Avans: employeeA')
    expect(m.body_text).toContain('Aşağıdaki avans talebi approver tarafından onaylandı. 3.500,00 ₺ tutarın çalışanın maaş hesabına ödenmesini rica ederiz.\n\nÇalışan: employeeA\nTür: Avans\nTutar: 3.500,00 ₺\nTalep Tarihi: 21 Ekim 2026\nAçıklama: Stüdyo ön ödeme\nOnay Tarihi: 21 Ekim 2026\nÖdeme: Maaş Hesabı\n\nBu e-posta')
  })

  it('queues an automatically approved expense with an "approved automatically" note', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('owner'), expenseInput())
    if (!r.ok) throw new Error(r.error)
    const [m] = acct(s)
    expect(m.subject).toBe('Test Paneli / Onaylanan Masraf: owner')
    expect(m.body_text).toContain('Aşağıdaki masraf talebi otomatik onaylandı.')
  })

  it('queues automatically approved leave right away', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('owner'), leaveInput({ start: '2026-12-28', end: '2026-12-29' }))
    if (!r.ok) throw new Error(r.error)
    const [m] = acct(s)
    expect(m.subject).toBe('Test Paneli / Onaylanan İzin: owner')
    expect(m.body_text).toContain('Aşağıdaki izin talebi otomatik onaylandı.\n\nÇalışan: owner\nİzin: Yıllık İzin\nTarih: 28 Aralık 2026 – 29 Aralık 2026 (2 iş günü)\nOnay Tarihi: 21 Ekim 2026\n\nBu e-posta')
    expect(JSON.parse(m.attachment_ids)).toEqual([])
  })

  it('the owner\'s expense is approved automatically and queued with the sender name and the requester in CC', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('owner'), expenseInput())
    if (!r.ok) throw new Error(r.error)
    const row = s.db.raw.prepare(`SELECT from_name, cc_extra, subject FROM accounting_outbox`).get()
    expect(row).toEqual({ from_name: 'owner (Test Paneli)', cc_extra: 'owner@ornek.test', subject: 'Test Paneli / Onaylanan Masraf: owner' })
  })

  it('sick leave says only "Sick leave", without a description, and never attaches the certificate', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', note: 'grip', file: pdf('Deniz-grip-raporu.pdf') }))
    if (!r.ok) throw new Error(r.error)
    await req.decide(s.ctx('approver'), r.request.id, 'approved')
    const [m] = acct(s)
    expect(m.body_text).toContain('İzin: Raporlu İzin\nTarih: 2 Kasım 2026 – 3 Kasım 2026 (2 iş günü)')
    expect(m.body_text).not.toMatch(/Ek:|sağlık raporu/i)
    expect(m.body_text + m.subject).not.toMatch(/grip|Hastalık|Deniz-grip/i)
    expect(JSON.parse(m.attachment_ids)).toEqual([])
  })

  it('excuse leave omits the reason and attachments', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'excuse', reason: 'bereavement', note: 'ev taşıma' }))
    if (!r.ok) throw new Error(r.error)
    await req.decide(s.ctx('approver'), r.request.id, 'approved')
    const [m] = acct(s)
    expect(m.body_text).toContain('İzin: Mazeret İzni')
    expect(m.body_text).not.toMatch(/Vefat|ev taşıma|Ek:/)
  })

  it('queue entries cannot be deleted', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('owner'), expenseInput())
    expect(() => s.db.raw.exec(`DELETE FROM accounting_outbox`)).toThrow(/no delete/)
  })
})

describe('accounting email: delivery', () => {
  it('with MAIL_ONLY set it goes only there, without accounting or CC; real recipients are in a trace header', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', file: pdf('rapor.pdf', 300) }))
    if (!r.ok) throw new Error(r.error)
    await req.decide(s.ctx('approver'), r.request.id, 'approved')
    const { sent, mailer } = recorder()
    const out = await deliverAccounting(s.db, files(s), mailer, { ...CFG, only: ['admin@example.com'] })
    expect(out).toEqual({ sent: 1, failed: 0 })
    expect(sent[0].to).toBe('admin@example.com')
    expect(sent[0].cc).toEqual([])
    expect(JSON.stringify(sent[0].to) + JSON.stringify(sent[0].cc)).not.toContain('accountant')
    expect(sent[0].text.startsWith('Merhaba Deniz Örnek,')).toBe(true)
    expect(sent[0].attachments).toEqual([])
    expect(sent[0].headers?.['X-Original-Recipients']).toBe('To: accountant@example.com; CC: Örnek Koordinatör <coordinator@example.com>, employeea@ornek.test')
    expect(acct(s)[0]).toMatchObject({ status: 'sent', delivered_to: 'to=admin@example.com; cc=' })
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'attachment.mail'`).get()).toEqual({ n: 0 })
    expect(await deliverAccounting(s.db, files(s), mailer, { ...CFG, only: ['admin@example.com'] })).toEqual({ sent: 0, failed: 0 })
  })

  it('without MAIL_ONLY: to accounting, CC approver and requester, sender name is the employee, reply-to the approver', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('employeeA'), expenseInput())
    if (!r.ok) throw new Error(r.error)
    await req.decide(s.ctx('approver'), r.requests[0].id, 'approved')
    const { sent, mailer } = recorder()
    await deliverAccounting(s.db, files(s), mailer, CFG)
    expect(sent[0]).toMatchObject({
      to: 'accountant@example.com',
      cc: ['Örnek Koordinatör <coordinator@example.com>', 'employeea@ornek.test'],
      fromName: 'employeeA (Test Paneli)',
      replyTo: 'Örnek Koordinatör <coordinator@example.com>',
    })
    expect(sent[0].headers).toBeUndefined()
    expect(acct(s)[0].delivered_to).toBe('to=accountant@example.com; cc=Örnek Koordinatör <coordinator@example.com>, employeea@ornek.test')
  })

  it('the requester is not added twice to CC; placeholder addresses never go to CC', async () => {
    expect(mergeCc(['accountant@example.com'], ['Örnek Koordinatör <coordinator@example.com>'], 'coordinator@example.com')).toEqual(['Örnek Koordinatör <coordinator@example.com>'])
    expect(mergeCc(['accountant@example.com'], [], 'accountant@example.com')).toEqual([])
    expect(requesterCc({ email: 'sam.sample@no-login.invalid', can_login: 0 })).toBeNull()
    expect(requesterCc({ email: 'x@example.com', can_login: 0 })).toBeNull()
    expect(requesterCc({ email: 'X@Example.com', can_login: 1 })).toBe('x@example.com')
    expect(senderName('Deniz "Örnek" <x>\r\nBcc: y')).toBe('Deniz Örnek x Bcc: y (Test Paneli)')
  })

  it('nothing is sent while the recipient setting is empty', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('owner'), expenseInput())
    const { sent, mailer } = recorder()
    expect(await deliverAccounting(s.db, files(s), mailer, { ...CFG, to: [] })).toEqual({ sent: 0, failed: 0 })
    expect(sent).toHaveLength(0)
    expect(acct(s)[0].status).toBe('queued')
  })

  it('a missing attachment file blocks sending and is retried', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('owner'), expenseInput())
    const { sent, mailer } = recorder()
    expect(await deliverAccounting(s.db, { get: async () => null }, mailer, CFG)).toEqual({ sent: 0, failed: 1 })
    expect(sent).toHaveLength(0)
    expect(acct(s)[0].status).toBe('queued')
  })

  it('a MAIL_ONLY skip is not counted as sent and does not write the certificate audit entry', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', file: pdf('rapor.pdf') }))
    if (!r.ok) throw new Error(r.error)
    await req.decide(s.ctx('approver'), r.request.id, 'approved')
    expect(await deliverAccounting(s.db, files(s), { send: async () => 'skipped' as const }, CFG)).toEqual({ sent: 0, failed: 1 })
    expect(acct(s)[0]).toMatchObject({ status: 'failed', delivered_to: null })
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'attachment.mail'`).get()).toEqual({ n: 0 })
  })

  it('a row over the attempt limit is not picked up again', async () => {
    const s = setup()
    await req.submitExpense(s.ctx('owner'), expenseInput())
    s.db.raw.prepare(`UPDATE accounting_outbox SET attempts = 5`).run()
    const { sent, mailer } = recorder()
    expect(await deliverAccounting(s.db, files(s), mailer, CFG)).toEqual({ sent: 0, failed: 0 })
    expect(sent).toHaveLength(0)
    expect(acct(s)[0].status).toBe('failed')
  })

  it('Resend: base64 attachments, recipients outside MAIL_ONLY skipped, CC filtered, no line breaks in the subject', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}')
    }) as unknown as typeof fetch
    const r = resendMailer({ apiKey: 'k', from: 'notify@example.com', only: ['admin@example.com'] }, f)
    await r.send({ to: 'admin@example.com', cc: ['Can Test <can@example.com>'], fromName: 'Ece "Demo"', subject: 'a\r\nBcc: x@evil.test', text: 't', attachments: [{ name: 'a.pdf', contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }] })
    expect(await r.send({ to: 'accountant@example.com', subject: 's', text: 't' })).toBe('skipped')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body).toMatchObject({ from: '"Ece Demo" <notify@example.com>', to: ['admin@example.com'], subject: 'a Bcc: x@evil.test' })
    expect(body.cc).toBeUndefined()
    expect(body.attachments).toEqual([{ filename: 'a.pdf', content: 'JVBERg==', content_type: 'application/pdf' }])
  })

  it('Resend: an error response throws so the queue retries', async () => {
    const f = (async () => new Response('nope', { status: 422 })) as unknown as typeof fetch
    await expect(resendMailer({ apiKey: 'k', from: 'notify@example.com' }, f).send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(/resend 422/)
  })

  it('attachments over the size limit are left out with a note; the certificate name is never shown', () => {
    const a = (id: string, size: number, sens = 0) => ({ id, original_name: `${id}.pdf`, content_type: 'application/pdf', size_bytes: size, is_sensitive: sens })
    expect(attachLines([])).toEqual({ line: null, ids: [] })
    expect(attachLines([a('x', 10), a('y', 20)])).toEqual({ line: 'Ek: x.pdf, y.pdf', ids: ['x', 'y'] })
    expect(attachLines([a('x', MAX_ATTACH_BYTES), a('y', 1)])).toEqual({ line: 'Ek: x.pdf; belge panelde: y.pdf', ids: ['x'] })
    expect(attachLines([a('x', MAX_ATTACH_BYTES + 1)])).toEqual({ line: 'Ek: belge panelde', ids: [] })
    expect(attachLines([a('x', 6e6), a('y', 6e6), a('z', 1e6)])).toEqual({ line: 'Ek: x.pdf, z.pdf; belge panelde: y.pdf', ids: ['x', 'z'] })
    expect(attachLines([a('Deniz-rapor', 10, 1)])).toEqual({ line: 'Ek: sağlık raporu', ids: ['Deniz-rapor'] })
  })

  it('longDay formats a long date', () => {
    expect(longDay('2026-11-03')).toBe('3 Kasım 2026')
    expect(longDay('2026-10-28')).toBe('28 Ekim 2026')
  })
})

describe('accounting email: language', () => {
  it('ACCOUNTING_LOCALE=en gives English text and a generic greeting when no salutation is set', async () => {
    applyRuntimeConfig({ accountingLocale: 'en' })
    try {
      const s = setup()
      const r = await req.submitExpense(s.ctx('owner'), expenseInput(1250))
      if (!r.ok) throw new Error(r.error)
      const [m] = acct(s)
      expect(m.subject).toBe('Test Paneli / Approved expense: owner')
      expect(m.body_text).toContain('The following expense request was approved automatically.')
      expect(m.body_text).toContain('Amount: ₺1,250.00 (VAT included)')
      const { sent, mailer } = recorder()
      await deliverAccounting(s.db, files(s), mailer, { ...CFG, salutation: '' })
      expect(sent[0].text.startsWith('Hello,\n')).toBe(true)
      expect(sent[0].text).toContain('This email was sent automatically by Test Paneli.')
    } finally {
      applyRuntimeConfig({ accountingLocale: 'tr' })
    }
  })
})
