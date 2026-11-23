import { describe, expect, it } from 'vitest'
import { authorize, HttpError } from './auth/authorize'
import * as req from './services/requests'
import { form, leaveInput, pdf, setup } from './testkit'

const withReport = (id: string, f = pdf('rapor.pdf')) => form({ id, file: f })

async function sickLeave(s: ReturnType<typeof setup>, who: 'employeeA' | 'employeeB' = 'employeeA', over: Record<string, unknown> = {}) {
  const r = await req.submitLeave(s.ctx(who), leaveInput({ kind: 'sick', start: '2026-11-02', end: '2026-11-03', ...over }))
  if (!r.ok) throw new Error(r.error)
  return r.request.id
}

describe('adding a medical certificate later', () => {
  it('adds it to a pending sick leave, writes an audit entry and hides the add action afterwards', async () => {
    const s = setup()
    const id = await sickLeave(s)
    expect((await req.myRequest(s.ctx('employeeA'), id))!.canAddReport).toBe(true)
    expect(await req.addLeaveReport(s.ctx('employeeA'), withReport(id))).toEqual({ ok: true })
    const a = s.db.raw.prepare(`SELECT kind, is_sensitive FROM attachments WHERE request_id = ?`).get(id)
    expect(a).toEqual({ kind: 'health_report', is_sensitive: 1 })
    expect(s.db.raw.prepare(`SELECT action, entity_id FROM audit_log WHERE action = 'attachment.add'`).get()).toEqual({ action: 'attachment.add', entity_id: id })
    const v = (await req.myRequest(s.ctx('employeeA'), id))!
    expect(v.canAddReport).toBeUndefined()
    expect(v.detail.attachments).toHaveLength(1)
    expect(v.detail.attachments![0].name).toBe('Sağlık raporu')
  })

  it('adds it to an approved sick leave too', async () => {
    const s = setup()
    const id = await sickLeave(s)
    for (const w of ['approver'] as const) expect((await req.decide(s.ctx(w), id, 'approved')).ok).toBe(true)
    expect((await req.myRequest(s.ctx('employeeA'), id))!.status).toBe('approved')
    expect(await req.addLeaveReport(s.ctx('employeeA'), withReport(id))).toEqual({ ok: true })
  })

  it('rejects a second certificate, another user, another leave type and rejected leave', async () => {
    const s = setup()
    const id = await sickLeave(s)
    expect(await req.addLeaveReport(s.ctx('employeeA'), withReport(id))).toEqual({ ok: true })
    expect(await req.addLeaveReport(s.ctx('employeeA'), withReport(id))).toMatchObject({ ok: false, error: expect.stringContaining('zaten') })
    const other = await sickLeave(s, 'employeeB', { start: '2026-11-09', end: '2026-11-09' })
    const e = await req.addLeaveReport(s.ctx('employeeA'), withReport(other)).then(() => null, (x) => x)
    expect(e).toBeInstanceOf(HttpError)
    const annual = await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-11-16', end: '2026-11-16' }))
    if (!annual.ok) throw new Error(annual.error)
    expect(await req.addLeaveReport(s.ctx('employeeA'), withReport(annual.request.id))).toMatchObject({ ok: false, error: expect.stringContaining('raporlu izne') })
    expect((await req.myRequest(s.ctx('employeeA'), annual.request.id))!.canAddReport).toBeUndefined()
    const rej = await sickLeave(s, 'employeeA', { start: '2026-11-23', end: '2026-11-23' })
    expect((await req.decide(s.ctx('approver'), rej, 'rejected', 'Uygun değil')).ok).toBe(true)
    await expect(req.addLeaveReport(s.ctx('employeeA'), withReport(rej))).rejects.toBeInstanceOf(HttpError)
  })

  it('requires a valid file and does not let a manager add one', async () => {
    const s = setup()
    const id = await sickLeave(s)
    expect(await req.addLeaveReport(s.ctx('employeeA'), form({ id }))).toMatchObject({ ok: false })
    expect(await req.addLeaveReport(s.ctx('employeeA'), form({ id, file: new File([new Uint8Array([1, 2, 3])], 'x.pdf') }))).toMatchObject({ ok: false })
    expect(authorize(s.users.manager, { a: 'request.addReport', r: { requesterId: s.users.employeeA.id, type: 'leave', status: 'pending' } }).ok).toBe(false)
  })

  it('does not change the queued accounting email', async () => {
    const s = setup()
    const id = await sickLeave(s)
    expect((await req.decide(s.ctx('approver'), id, 'approved')).ok).toBe(true)
    const before = s.db.raw.prepare(`SELECT count(*) AS n, group_concat(attachment_ids) AS a FROM accounting_outbox`).get() as { n: number; a: string }
    expect(await req.addLeaveReport(s.ctx('employeeA'), withReport(id))).toEqual({ ok: true })
    expect(s.db.raw.prepare(`SELECT count(*) AS n, group_concat(attachment_ids) AS a FROM accounting_outbox`).get()).toEqual(before)
  })
})

describe('cancelling approved leave', () => {
  it('keeps the approval time in the detail view', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-12-28', end: '2026-12-29' }))
    if (!r.ok) throw new Error(r.error)
    expect((await req.decide(s.ctx('approver'), r.request.id, 'approved')).ok).toBe(true)
    expect(await req.cancel(s.ctx('employeeA'), r.request.id)).toEqual({ ok: true })
    const v = (await req.myRequest(s.ctx('employeeA'), r.request.id))!
    expect(v.status).toBe('cancelled')
    expect(v.detail.decidedAt).toBeTruthy()
    expect(v.detail.cancelledAt).toBeTruthy()
    const p = await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-12-30', end: '2026-12-30' }))
    if (!p.ok) throw new Error(p.error)
    await req.cancel(s.ctx('employeeA'), p.request.id)
    expect((await req.myRequest(s.ctx('employeeA'), p.request.id))!.detail.decidedAt).toBeFalsy()
  })
})
