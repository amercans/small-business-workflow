import { describe, expect, it } from 'vitest'
import { authorize, HttpError, type Action, type AuthUser } from './auth/authorize'
import { attachmentForRead } from './db/attachments'
import { sniffType, prepareFile, FileRejected } from './files'
import * as req from './services/requests'
import { decideInvoice } from './services/invoiceApproval'
import * as mng from './services/manage'
import * as cmp from './services/compliance'
import * as rep from './services/reports'
import * as cal from './services/calendar'
import { LEGAL_VERSION } from '#/lib/legal'
import { defaultApprovalRules } from '#/lib/approvals'
import { saveApprovalRules } from './services/settings'
import { advanceInput, expenseInput, form, IBAN, invVersion, jpg, leaveInput, pdf, purchaseInput, setup, travelInput, type Who } from './testkit'

const rejects = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(HttpError)
  expect((e as HttpError).status).toBe(status)
}

async function submitted(s: ReturnType<typeof setup>, who: Who, kind: 'leave' | 'expense' | 'advance' | 'purchase' | 'travel' = 'leave') {
  const ctx = s.ctx(who)
  const r =
    kind === 'leave' ? await req.submitLeave(ctx, leaveInput())
    : kind === 'expense' ? await req.submitExpense(ctx, expenseInput())
    : kind === 'advance' ? await req.submitAdvance(ctx, advanceInput())
    : kind === 'purchase' ? await req.submitPurchase(ctx, purchaseInput())
    : await req.submitTravel(ctx, travelInput())
  if (!r.ok) throw new Error(`gönderilemedi: ${r.error}`)
  return 'request' in r ? r.request.id : r.requests[0].id
}

async function travelAdvance(s: ReturnType<typeof setup>, who: Who = 'employeeA', amount = 3500) {
  const r = await req.submitTravel(s.ctx(who), travelInput({ wantAdvance: true, advanceAmount: amount }))
  if (!r.ok) throw new Error(r.error)
  await approveAll(s, r.requests[0].id)
  return r.requests[1].id
}

async function approveAll(s: ReturnType<typeof setup>, id: string) {
  const b = await req.decide(s.ctx('approver'), id, 'approved')
  if (!b.ok) throw new Error(b.error)
}

describe('authorize() matrix', () => {
  const s = setup()
  const u = s.users
  const leave = (owner: AuthUser, status = 'pending' as const) => ({ requesterId: owner.id, type: 'leave' as const, status })
  const exp = (owner: AuthUser, status: 'pending' | 'approved' = 'pending') => ({ requesterId: owner.id, type: 'expense' as const, status })
  const cases: [string, Who, Action, boolean][] = [
    ['an employee reads their own request', 'employeeA', { a: 'request.read', r: leave(u.employeeA) }, true],
    ['an employee cannot read someone else\'s request', 'employeeA', { a: 'request.read', r: leave(u.employeeB) }, false],
    ['a manager reads someone else\'s leave', 'manager', { a: 'request.read', r: leave(u.employeeA) }, true],
    ['a manager reads someone else\'s expense', 'manager', { a: 'request.read', r: exp(u.employeeA) }, true],
    ['the owner reads someone else\'s expense', 'owner', { a: 'request.read', r: exp(u.employeeA) }, true],
    ['an employee cannot see reports', 'employeeB', { a: 'report.read' }, false],
    ['the owner sees reports', 'owner', { a: 'report.read' }, true],
    ['the approver reads an expense', 'approver', { a: 'request.read', r: exp(u.employeeA) }, true],
    ['a draft is hidden from others', 'approver', { a: 'request.read', r: { requesterId: u.employeeA.id, type: 'expense', status: 'draft' } }, false],
    ['a manager cannot decide a request waiting on the approver', 'manager', { a: 'request.decide', r: { ...leave(u.employeeA), approverRole: 'approver' } }, false],
    ['the approver decides a request waiting on the approver', 'approver', { a: 'request.decide', r: { ...leave(u.employeeA), approverRole: 'approver' } }, true],
    ['the owner cannot decide a request waiting on the approver', 'owner', { a: 'request.decide', r: { ...exp(u.employeeA), approverRole: 'approver' } }, false],
    ['the owner decides a request routed to the owner', 'owner', { a: 'request.decide', r: { ...exp(u.approver), approverRole: 'owner' } }, true],
    ['a manager decides a request routed to managers', 'manager2', { a: 'request.decide', r: { ...exp(u.employeeA), approverRole: 'manager' } }, true],
    ['nobody decides a request without an approver role', 'approver', { a: 'request.decide', r: leave(u.employeeA) }, false],
    ['the requester never decides their own request', 'approver', { a: 'request.decide', r: { ...exp(u.approver), approverRole: 'approver' } }, false],
    ['only the owner of an advance closes it', 'employeeB', { a: 'advance.close', r: { requesterId: u.employeeA.id, type: 'advance', status: 'paid' } }, false],
    ['an unpaid advance cannot be closed', 'employeeA', { a: 'advance.close', r: { requesterId: u.employeeA.id, type: 'advance', status: 'approved' } }, false],
    ['the approver records a refund', 'approver', { a: 'advance.refundReceived', r: { requesterId: u.employeeA.id, type: 'advance', status: 'paid' } }, true],
    ['the approver cannot record their own refund', 'approver', { a: 'advance.refundReceived', r: { requesterId: u.approver.id, type: 'advance', status: 'paid' } }, false],
    ['a manager cannot record a refund', 'manager2', { a: 'advance.refundReceived', r: { requesterId: u.employeeA.id, type: 'advance', status: 'paid' } }, false],
    ['the approver marks an approved expense as paid', 'approver', { a: 'request.markPaid', r: exp(u.employeeA, 'approved') }, true],
    ['the approver cannot mark a pending expense as paid', 'approver', { a: 'request.markPaid', r: exp(u.employeeA) }, false],
    ['a manager cannot mark as paid', 'manager', { a: 'request.markPaid', r: exp(u.employeeA, 'approved') }, false],
    ['the approver cannot mark a purchase as paid', 'approver', { a: 'request.markPaid', r: { requesterId: u.employeeA.id, type: 'purchase', status: 'approved' } }, false],
    ['an employee cannot open the approvals queue', 'employeeA', { a: 'approvals.list' }, false],
    ['managers can open the approvals queue', 'manager', { a: 'approvals.list' }, true],
    ['the owner can open the approvals queue', 'owner', { a: 'approvals.list' }, true],
    ['an employee cannot see the dashboard', 'employeeA', { a: 'dashboard.read' }, false],
    ['an employee cannot see agreements', 'employeeB', { a: 'agreement.read' }, false],
    ['an employee cannot see inventory', 'employeeB', { a: 'asset.read' }, false],
    ['the owner sees the dashboard', 'owner', { a: 'dashboard.read' }, true],
    ['an unflagged employee cannot upload invoices', 'employeeA', { a: 'invoice.create', direction: 'in' }, false],
    ['a flagged employee uploads incoming invoices', 'employeeB', { a: 'invoice.create', direction: 'in' }, true],
    ['a flagged employee cannot upload outgoing invoices', 'employeeB', { a: 'invoice.create', direction: 'out' }, false],
    ['a flagged employee cannot see someone else\'s invoice', 'employeeB', { a: 'invoice.read', uploadedBy: u.manager.id }, false],
    ['a flagged employee sees their own invoice', 'employeeB', { a: 'invoice.read', uploadedBy: u.employeeB.id }, true],
    ['medical certificate: another employee cannot see it', 'employeeB', { a: 'attachment.read', p: { kind: 'request', request: leave(u.employeeA), sensitive: true } }, false],
    ['medical certificate: the approver sees it', 'approver', { a: 'attachment.read', p: { kind: 'request', request: leave(u.employeeA), sensitive: true } }, true],
    ['medical certificate: the owner sees it', 'owner', { a: 'attachment.read', p: { kind: 'request', request: leave(u.employeeA), sensitive: true } }, true],
    ['expense attachment: a manager sees it', 'manager', { a: 'attachment.read', p: { kind: 'request', request: exp(u.employeeA), sensitive: false } }, true],
    ['a non-admin cannot manage users', 'owner', { a: 'user.manage' }, false],
    ['an admin manages users', 'manager', { a: 'user.manage' }, true],
    ['expense export is available to management', 'manager', { a: 'export.expenses' }, true],
    ['an inactive user cannot read even their own request', 'inactive', { a: 'request.read', r: leave(u.inactive) }, false],
  ]
  it.each(cases)('%s', (_n, who, act, ok) => {
    expect(authorize(u[who], act).ok).toBe(ok)
  })
  it('another user\'s record returns 404 so its existence does not leak', () => {
    expect(authorize(u.employeeA, { a: 'request.read', r: leave(u.employeeB) })).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('requests: ownership and cancellation', () => {
  it('an employee lists only their own requests; another user\'s detail is null', async () => {
    const s = setup()
    const mine = await submitted(s, 'employeeA')
    const other = await submitted(s, 'employeeB', 'expense')
    const list = await req.myRequests(s.ctx('employeeA'))
    expect(list.requests.map((r) => r.id)).toEqual([mine])
    expect(await req.myRequest(s.ctx('employeeA'), other)).toBeNull()
    expect((await req.myRequest(s.ctx('employeeA'), mine))?.title).toContain('Yıllık izin')
  })
  it('a requester id in the input is ignored; the request is opened for the signed-in user', async () => {
    const s = setup()
    const r = await req.submitAdvance(s.ctx('employeeA'), form({ amount: 100, reason: 'x', iban: IBAN, requester_id: s.users.employeeB.id, requesterId: s.users.employeeB.id }))
    expect(r.ok).toBe(true)
    const row = s.db.raw.prepare(`SELECT requester_id FROM requests`).get() as { requester_id: string }
    expect(row.requester_id).toBe(s.users.employeeA.id)
  })
  it('cancels own pending request, not someone else\'s, and not twice', async () => {
    const s = setup()
    const id = await submitted(s, 'employeeA')
    expect(await req.cancel(s.ctx('employeeB'), id)).toEqual({ ok: false, error: 'Talep bulunamadı' })
    expect(await req.cancel(s.ctx('employeeA'), id)).toEqual({ ok: true })
    expect((await req.cancel(s.ctx('employeeA'), id)).ok).toBe(false)
  })
  it('cannot approve own request', async () => {
    const s = setup()
    const id = await submitted(s, 'manager')
    await rejects(req.decide(s.ctx('manager'), id, 'approved'), 403)
    await approveAll(s, id)
    const own = await submitted(s, 'approver', 'leave')
    await rejects(req.decide(s.ctx('approver'), own, 'approved'), 403)
  })
  it('cancelling a trip also cancels its linked pending advance', async () => {
    const s = setup()
    const r = await req.submitTravel(s.ctx('employeeA'), travelInput({ wantAdvance: true, advanceAmount: 2000 }))
    if (!r.ok) throw new Error(r.error)
    expect(r.requests).toHaveLength(2)
    await req.cancel(s.ctx('employeeA'), r.requests[0].id)
    const st = s.db.raw.prepare(`SELECT type, status FROM requests ORDER BY type`).all()
    expect(st).toEqual([{ type: 'advance', status: 'cancelled' }, { type: 'travel', status: 'cancelled' }])
  })
})

describe('no bank account number is requested', () => {
  it('advances and travel prepayments pass without an account number, none is stored and payment goes by bank transfer', async () => {
    const s = setup()
    expect((await req.submitAdvance(s.ctx('employeeA'), form({ amount: 100, reason: 'x', iban: IBAN }))).ok).toBe(true)
    expect((await req.submitTravel(s.ctx('employeeA'), travelInput({ wantAdvance: true, advanceAmount: 2000 }))).ok).toBe(true)
    const rows = s.db.raw.prepare(`SELECT iban, payment_method FROM advance_requests`).all()
    expect(rows).toEqual([{ iban: null, payment_method: 'bank' }, { iban: null, payment_method: 'bank' }])
  })
})

describe('cancelling approved leave', () => {
  it('the owner cancels approved leave that has not started; others cannot; approvers and managers are informed', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-12-28', end: '2026-12-29' }))
    if (!r.ok) throw new Error(r.error)
    const id = r.request.id
    expect((await req.decide(s.ctx('approver'), id, 'approved')).ok).toBe(true)
    expect((await req.myRequest(s.ctx('employeeA'), id))?.cancellable).toBe(true)
    expect((await req.cancel(s.ctx('employeeB'), id)).ok).toBe(false)
    expect((await req.cancel(s.ctx('employeeA'), id)).ok).toBe(true)
    const row = s.db.raw.prepare(`SELECT status FROM requests WHERE id = ?`).get(id) as { status: string }
    expect(row.status).toBe('cancelled')
    const to = (s.db.raw.prepare(`SELECT to_user_id FROM email_outbox WHERE dedupe_key LIKE 'request_cancelled:%'`).all() as { to_user_id: string }[]).map((r) => r.to_user_id).sort()
    expect(to).toEqual([s.users.manager.id, s.users.manager2.id, s.users.approver.id].sort())
  })
  it('leave that has started cannot be cancelled and shows no cancel button', async () => {
    const s = setup()
    const id = await submitted(s, 'employeeA')
    await req.decide(s.ctx('approver'), id, 'approved')
    const late = { ...s.ctx('employeeA'), today: '2026-11-02' }
    expect((await req.myRequest(late, id))?.cancellable).toBeUndefined()
    expect(await req.cancel(late, id)).toMatchObject({ ok: false })
  })
})

describe('approval routing', () => {
  const statusOf = (s: ReturnType<typeof setup>, id: string) => s.db.raw.prepare(`SELECT status, auto_approved, approver_role FROM requests WHERE id = ?`).get(id)
  it('sends employee and manager requests to the approver by default', async () => {
    const s = setup()
    await submitted(s, 'employeeA')
    await submitted(s, 'employeeB', 'expense')
    await submitted(s, 'manager2', 'purchase')
    expect((await req.approvals(s.ctx('approver'))).pending.map((p) => p.type).sort()).toEqual(['expense', 'leave', 'purchase'])
    expect(s.db.raw.prepare(`SELECT DISTINCT approver_role FROM requests`).all()).toEqual([{ approver_role: 'approver' }])
    await rejects(req.approvals(s.ctx('employeeA')), 403)
    expect((await req.approvals(s.ctx('manager'))).pending).toEqual([])
    expect((await req.approvals(s.ctx('owner'))).pending).toEqual([])
  })
  it('sends the approver\'s own requests to the owner, who can decide them', async () => {
    const s = setup()
    const id = await submitted(s, 'approver', 'expense')
    expect(statusOf(s, id)).toEqual({ status: 'pending', auto_approved: 0, approver_role: 'owner' })
    expect((await req.approvals(s.ctx('approver'))).pending).toEqual([])
    expect((await req.approvals(s.ctx('owner'))).pending.map((p) => p.id)).toEqual([id])
    await rejects(req.decide(s.ctx('approver'), id, 'approved'), 403)
    expect((await req.decide(s.ctx('owner'), id, 'approved')).ok).toBe(true)
  })
  it('approves the owner\'s own requests automatically and records it in the audit log', async () => {
    const s = setup()
    const id = await submitted(s, 'owner', 'expense')
    expect(statusOf(s, id)).toEqual({ status: 'approved', auto_approved: 1, approver_role: null })
    const a = s.db.raw.prepare(`SELECT meta_json FROM audit_log WHERE action = 'request.submit' AND entity_id = ?`).get(id) as { meta_json: string }
    expect(JSON.parse(a.meta_json)).toEqual({ auto: true })
  })
  it('follows a configured override per request type and requester role', async () => {
    const s = setup()
    const rules = defaultApprovalRules()
    rules.routes.leave.employee = 'manager'
    rules.autoApprove = ['owner', 'approver']
    expect((await saveApprovalRules(s.ctx('manager'), rules)).ok).toBe(true)
    const leave = await submitted(s, 'employeeA', 'leave')
    const exp = await submitted(s, 'employeeA', 'expense')
    const own = await submitted(s, 'approver', 'expense')
    expect(statusOf(s, leave)).toEqual({ status: 'pending', auto_approved: 0, approver_role: 'manager' })
    expect(statusOf(s, exp)).toEqual({ status: 'pending', auto_approved: 0, approver_role: 'approver' })
    expect(statusOf(s, own)).toEqual({ status: 'approved', auto_approved: 1, approver_role: null })
    await rejects(req.decide(s.ctx('approver'), leave, 'approved'), 403)
    expect((await req.decide(s.ctx('manager2'), leave, 'approved')).ok).toBe(true)
  })
  it('only admins can change approval settings, and invalid settings are refused', async () => {
    const s = setup()
    await rejects(saveApprovalRules(s.ctx('owner'), defaultApprovalRules()), 403)
    const bad = { ...defaultApprovalRules(), routes: { ...defaultApprovalRules().routes, leave: { employee: 'employee' } } }
    expect((await saveApprovalRules(s.ctx('manager'), bad)).ok).toBe(false)
  })
  it('falls back to the owner when nobody holds the configured approver role', async () => {
    const s = setup()
    s.db.raw.prepare(`UPDATE users SET status = 'inactive', deactivated_at = ? WHERE id = ?`).run('2026-01-01T00:00:00.000Z', s.users.approver.id)
    const id = await submitted(s, 'employeeA', 'expense')
    expect(statusOf(s, id)).toEqual({ status: 'pending', auto_approved: 0, approver_role: 'owner' })
    expect((await req.decide(s.ctx('owner'), id, 'approved')).ok).toBe(true)
  })
  it('keeps a request pending instead of approving it automatically when no other approver or owner exists', async () => {
    const s = setup()
    const rules = defaultApprovalRules()
    rules.autoApprove = []
    expect((await saveApprovalRules(s.ctx('manager'), rules)).ok).toBe(true)
    const id = await submitted(s, 'owner', 'expense')
    expect(statusOf(s, id)).toEqual({ status: 'pending', auto_approved: 0, approver_role: 'owner' })
    await expect(req.decide(s.ctx('owner'), id, 'approved')).rejects.toThrow()
  })
  it('lets only one of two concurrent decisions through and writes one audit row', async () => {
    const s = setup()
    const id = await submitted(s, 'employeeA')
    const [a, b] = await Promise.all([req.decide(s.ctx('approver'), id, 'approved'), req.decide(s.ctx('approver'), id, 'rejected', 'x')])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    const n = s.db.raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('request.approve','request.reject')`).get() as { n: number }
    expect(n.n).toBe(1)
  })
  it('refuses decisions from roles the request is not waiting on', async () => {
    const s = setup()
    const leave = await submitted(s, 'employeeA')
    const exp = await submitted(s, 'employeeB', 'expense')
    for (const w of ['manager', 'manager2', 'owner'] as const) {
      await rejects(req.decide(s.ctx(w), exp, 'approved'), 403)
      await rejects(req.decide(s.ctx(w), leave, 'approved'), 403)
    }
  })
  it('requires a reason for rejection', async () => {
    const s = setup()
    const id = await submitted(s, 'employeeA', 'expense')
    expect(await req.decide(s.ctx('approver'), id, 'rejected', '  ')).toEqual({ ok: false, error: 'Red gerekçesi zorunlu' })
    expect((await req.decide(s.ctx('approver'), id, 'rejected', 'Fiş okunmuyor')).ok).toBe(true)
  })
  it('lets the approver mark approved expenses as paid, but not purchases, and not managers', async () => {
    const s = setup()
    const exp = await submitted(s, 'employeeA', 'expense')
    const pur = await submitted(s, 'employeeA', 'purchase')
    await approveAll(s, exp)
    await approveAll(s, pur)
    await rejects(req.markPaid(s.ctx('manager'), exp), 403)
    expect((await req.markPaid(s.ctx('approver'), exp)).ok).toBe(true)
    await rejects(req.markPaid(s.ctx('approver'), pur), 403)
  })
})

describe('leave balance and overlaps', () => {
  it('refuses overlapping leave; the balance cannot go more than 14 workdays negative; pending days count', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect((await req.submitLeave(c, leaveInput())).ok).toBe(true)
    expect(await req.submitLeave(c, leaveInput({ start: '2026-11-03', end: '2026-11-04' }))).toMatchObject({ ok: false, error: expect.stringContaining('çakışıyor') })
    expect((await req.submitLeave(c, leaveInput({ start: '2026-11-16', end: '2026-11-30' }))).ok).toBe(true)
    expect((await req.submitLeave(c, leaveInput({ start: '2026-12-01', end: '2026-12-01' }))).ok).toBe(true)
    expect((await req.submitLeave(c, leaveInput({ start: '2026-12-02', end: '2026-12-21' }))).ok).toBe(true)
    const no = await req.submitLeave(c, leaveInput({ start: '2026-12-22', end: '2026-12-22' }))
    expect(no).toMatchObject({ ok: false, error: expect.stringContaining('Bakiyen yetmiyor') })
    expect(JSON.stringify(no)).not.toContain('14')
    expect((await req.submitLeave(c, leaveInput({ kind: 'excuse', reason: 'other', start: '2026-12-22', end: '2026-12-22' }))).ok).toBe(true)
    const home = await req.homeData(c, [])
    expect(home.leave).toMatchObject({ total: 14, left: 14, pendingDays: 28 })
  })
  it('applies the annual leave balance to every role, managers included', async () => {
    const s = setup()
    for (const w of ['manager', 'employeeA'] as const) {
      expect(await req.submitLeave(s.ctx(w), leaveInput({ start: '2026-11-02', end: '2026-12-31' }))).toMatchObject({ ok: false, error: expect.stringContaining('Bakiyen yetmiyor') })
      expect((await req.homeData(s.ctx(w), [])).leave.unlimited).toBe(false)
    }
  })
  it('sick, excuse, unpaid and other leave do not reduce the annual balance even when approved', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    const kinds = [['sick', '2026-11-02'], ['excuse', '2026-11-03'], ['unpaid', '2026-11-04']] as const
    for (const [kind, d] of kinds) {
      const r = await req.submitLeave(c, leaveInput({ kind, start: d, end: d, reason: kind === 'excuse' ? 'marriage' : undefined }))
      if (!r.ok) throw new Error(r.error)
      await req.decide(s.ctx('approver'), r.request.id, 'approved')
    }
    expect((await req.homeData(c, [])).leave).toMatchObject({ total: 14, left: 14, pendingDays: 0 })
  })
  it('leave types: no generic other type, excuse leave needs a reason shown in the title, sick leave label', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect((await req.submitLeave(c, leaveInput({ kind: 'other' as 'annual', start: '2026-11-02', end: '2026-11-02' }))).ok).toBe(false)
    expect((await req.submitLeave(c, leaveInput({ kind: 'excuse', start: '2026-11-02', end: '2026-11-02' }))).ok).toBe(false)
    const m = await req.submitLeave(c, leaveInput({ kind: 'excuse', reason: 'marriage', start: '2026-11-02', end: '2026-11-04' }))
    if (!m.ok) throw new Error(m.error)
    expect(m.request.title).toMatch(/^Evlilik izni, /)
    const r = await req.submitLeave(c, leaveInput({ kind: 'sick', start: '2026-11-05', end: '2026-11-05' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.request.title).toMatch(/^Hastalık izni \(raporlu\), /)
  })
  it('leave cannot be requested for a year without a holiday calendar', async () => {
    const s = setup()
    expect(await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2028-01-04', end: '2028-01-04' }))).toMatchObject({ ok: false, error: expect.stringContaining('tatil takvimi henüz girilmedi') })
  })
  it('the client cannot supply today; the server value is used', async () => {
    const fn = await import('node:fs').then((m) => m.readFileSync(new URL('./fn.ts', import.meta.url), 'utf8'))
    expect(fn).toMatch(/const ctx: Ctx = \{ user, db: env\.DB, store, today: todayISO\(\), client \}/)
    expect(fn).toMatch(/headers\.get\('CF-Connecting-IP'\)/)
  })
  it('a user without an entitlement cannot request annual leave', async () => {
    const s = setup()
    s.db.raw.exec(`DROP TRIGGER trg_leave_entitlements_no_delete`)
    s.db.raw.prepare(`DELETE FROM leave_entitlements WHERE user_id = ?`).run(s.users.employeeA.id)
    expect(await req.submitLeave(s.ctx('employeeA'), leaveInput())).toMatchObject({ ok: false, error: expect.stringContaining('izin hakkın henüz girilmedi') })
  })
  it('rejects past dates and ranges without workdays', async () => {
    const s = setup()
    expect((await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-10-20', end: '2026-10-20' }))).ok).toBe(false)
    expect(await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-10-31', end: '2026-11-01' }))).toMatchObject({ ok: false, error: expect.stringContaining('iş günü') })
  })
  it('a medical certificate on sick leave is stored as a sensitive attachment', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', file: pdf('rapor.pdf') }))
    expect(r.ok).toBe(true)
    const a = s.db.raw.prepare(`SELECT kind, is_sensitive FROM attachments`).get()
    expect(a).toEqual({ kind: 'health_report', is_sensitive: 1 })
    expect(s.stored).toHaveLength(1)
  })
})

describe('advance and expense offsetting', () => {
  it('a salary advance is not offset by expenses, not counted as open and cannot be closed', async () => {
    const s = setup()
    const adv = await submitted(s, 'employeeA', 'advance')
    await approveAll(s, adv)
    await req.markPaid(s.ctx('approver'), adv)
    const c = s.ctx('employeeA')
    expect((await req.homeData(c, [])).advance.openAmount).toBe(0)
    const e = await req.submitExpense(c, expenseInput(1200))
    if (!e.ok) throw new Error(e.error)
    expect(s.db.raw.prepare(`SELECT COUNT(*) AS n FROM advance_allocations`).get()).toEqual({ n: 0 })
    expect((await req.closeAdvance(c, adv, {})).ok).toBe(false)
    expect((await req.myRequest(c, adv))?.detail.closure).toBeUndefined()
  })
  it('expenses are offset against a paid advance; approval reduces the open advance', async () => {
    const s = setup()
    const adv = await travelAdvance(s)
    await approveAll(s, adv)
    await req.markPaid(s.ctx('approver'), adv)
    expect((await req.homeData(s.ctx('employeeA'), [])).advance.openAmount).toBe(3500)
    const r = await req.submitExpense(s.ctx('employeeA'), expenseInput(1200))
    if (!r.ok) throw new Error(r.error)
    const q = await req.approvals(s.ctx('approver'))
    expect(q.pending[0]).toMatchObject({ openAdvance: 3500, allocated: 1200 })
    await approveAll(s, r.requests[0].id)
    expect((await req.homeData(s.ctx('employeeA'), [])).advance.openAmount).toBe(2300)
  })
  it('the offset of a rejected expense is released automatically', async () => {
    const s = setup()
    const adv = await travelAdvance(s)
    await approveAll(s, adv)
    await req.markPaid(s.ctx('approver'), adv)
    const r = await req.submitExpense(s.ctx('employeeA'), expenseInput(5000))
    if (!r.ok) throw new Error(r.error)
    await req.decide(s.ctx('approver'), r.requests[0].id, 'rejected', 'Proje dışı')
    expect((await req.homeData(s.ctx('employeeA'), [])).advance.openAmount).toBe(3500)
  })
  it('the same file cannot be attached to two lines', async () => {
    const s = setup()
    const item = { date: '2026-10-20', amount: 10, currency: 'TRY', category: 'meals', description: 'x', fileName: 'f.jpg', file: { $file: 'f0' } }
    const r = await req.submitExpense(s.ctx('employeeA'), { json: { items: [item, item] }, files: new Map([['f0', jpg()]]) })
    expect(r).toMatchObject({ ok: false, fieldErrors: { 'items.1.fileName': expect.any(String) } })
  })
  it('an expense needs a receipt', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('employeeA'), form({ items: [{ date: '2026-10-20', amount: 10, currency: 'TRY', category: 'meals', description: 'x', fileName: 'fis.jpg' }] }))
    expect(r).toMatchObject({ ok: false, fieldErrors: { 'items.0.fileName': expect.any(String) } })
  })
  it('a foreign-currency line is converted with the rate, rounding half up', async () => {
    const s = setup()
    const r = await req.submitExpense(s.ctx('employeeA'), form({ items: [{ date: '2026-10-20', amount: 10.01, currency: 'EUR', rate: 36.512345, category: 'meals', description: 'x', fileName: 'f.jpg', file: jpg() }] }))
    expect(r.ok).toBe(true)
    const it = s.db.raw.prepare(`SELECT amount_minor, fx_rate_micro, amount_base_minor FROM request_items`).get()
    expect(it).toEqual({ amount_minor: 1001, fx_rate_micro: 36512345, amount_base_minor: 36549 })
  })
})

describe('request form rules', () => {
  const leaveRow = (s: ReturnType<typeof setup>) => s.db.raw.prepare(`SELECT kind, start_time, end_time, work_days, return_date, substitute_id FROM leave_requests ORDER BY rowid DESC`).get()
  it('a holiday eve counts as half a day in a full-day range and allows no afternoon leave', async () => {
    const s = setup()
    const c = s.ctx('manager')
    expect(await req.submitLeave(c, leaveInput({ kind: 'unpaid', start: '2027-03-08', end: '2027-03-12' }))).toMatchObject({ ok: true })
    expect(leaveRow(s)).toMatchObject({ work_days: 1.5 })
    expect(await req.submitLeave(c, leaveInput({ kind: 'unpaid', span: 'half_day', start: '2027-05-14', end: '2027-05-14', half: 'morning' }))).toMatchObject({ ok: true })
    expect(await req.submitLeave(c, leaveInput({ span: 'half_day', start: '2026-10-28', end: '2026-10-28', half: 'afternoon' }))).toMatchObject({ ok: false })
  })
  it('hourly and half-day leave: duration is hours/8; non-overlapping same-day leave is allowed, overlapping is not', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect((await req.submitLeave(c, leaveInput({ kind: 'excuse', reason: 'other', span: 'hours', start: '2026-11-04', end: '2026-11-04', startTime: '12:00', endTime: '15:00' }))).ok).toBe(true)
    expect(leaveRow(s)).toEqual({ kind: 'excuse', start_time: '12:00', end_time: '15:00', work_days: 0.375, return_date: '2026-11-04', substitute_id: null })
    expect((await req.submitLeave(c, leaveInput({ span: 'half_day', start: '2026-11-04', end: '2026-11-04', half: 'afternoon' }))).ok).toBe(false)
    expect((await req.submitLeave(c, leaveInput({ span: 'hours', start: '2026-11-04', end: '2026-11-04', startTime: '16:00', endTime: '18:00' }))).ok).toBe(true)
    expect(leaveRow(s)).toMatchObject({ work_days: 0.25, return_date: '2026-11-05' })
    expect(await req.submitLeave(c, leaveInput({ start: '2026-11-04', end: '2026-11-04' }))).toMatchObject({ ok: false, error: expect.stringContaining('çakışıyor') })
    expect((await req.homeData(c, [])).leave).toMatchObject({ pendingDays: 0.25 })
  })
  it('partial-day leave covers one day; 8 hours or more must be full day; no weekends', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect((await req.submitLeave(c, leaveInput({ span: 'hours', start: '2026-11-04', end: '2026-11-05', startTime: '09:00', endTime: '10:00' }))).ok).toBe(false)
    expect(await req.submitLeave(c, leaveInput({ span: 'hours', start: '2026-11-04', end: '2026-11-04', startTime: '09:00', endTime: '18:00' }))).toMatchObject({ ok: false, error: expect.stringContaining('tam gün') })
    expect(await req.submitLeave(c, leaveInput({ span: 'half_day', start: '2026-11-07', end: '2026-11-07', half: 'morning' }))).toMatchObject({ ok: false, error: expect.stringContaining('iş günü değil') })
  })
  it('return date is computed; the substitute must be an active colleague other than the requester', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect(await req.submitLeave(c, leaveInput({ substituteId: s.users.employeeA.id }))).toMatchObject({ ok: false, error: expect.stringContaining('Vekalet') })
    expect((await req.submitLeave(c, leaveInput({ substituteId: s.users.inactive.id }))).ok).toBe(false)
    expect((await req.submitLeave(c, leaveInput({ start: '2026-11-05', end: '2026-11-06', substituteId: s.users.employeeB.id }))).ok).toBe(true)
    expect(leaveRow(s)).toMatchObject({ return_date: '2026-11-09', substitute_id: s.users.employeeB.id })
    expect((await req.submitLeave(c, leaveInput({ kind: 'unpaid', start: '2026-11-10', end: '2026-11-10' }))).ok).toBe(true)
    expect((await req.homeData(c, [])).leave).toMatchObject({ pendingDays: 2 })
    const d = await req.anyRequest(s.ctx('manager'), (s.db.raw.prepare(`SELECT request_id FROM leave_requests WHERE substitute_id IS NOT NULL`).get() as { request_id: string }).request_id)
    expect(d?.detail.fields).toEqual(expect.arrayContaining([{ label: 'İşe dönüş', value: '9 Kas' }, { label: 'Vekalet edecek kişi', value: 'employeeB' }, { label: 'Görevi / departmanı', value: 'Çalışan' }]))
  })
  it('expenses store document number and VAT per line, no account number; net payable is subtotal minus offset', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    const item = { date: '2026-10-20', amount: 1200, vat: 200, docNo: 'A-1042', currency: 'TRY', category: 'meals', description: 'x', fileName: 'f.jpg', file: jpg() }
    expect(await req.submitExpense(c, form({ items: [{ ...item, vat: 1200 }] }))).toMatchObject({ ok: false, fieldErrors: { 'items.0.vat': expect.any(String) } })
    const r = await req.submitExpense(c, form({ iban: IBAN, items: [item] }))
    if (!r.ok) throw new Error(r.error)
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM expense_requests`).get()).toEqual({ n: 0 })
    expect(s.db.raw.prepare(`SELECT doc_no, vat_minor FROM request_items`).get()).toEqual({ doc_no: 'A-1042', vat_minor: 20000 })
    const mine = await req.myRequest(c, r.requests[0].id)
    expect(mine?.detail.totals).toEqual({ subtotal: '1.200,00 ₺', offset: '0,00 ₺', net: '1.200,00 ₺', hasOffset: false })
    expect(mine?.detail.items?.[0].sub).toBe('20 Eki · Yemek · Belge A-1042 · KDV 200,00 ₺')
    expect(mine?.detail.fields?.some((f) => f.label.startsWith('IBAN'))).toBe(false)
  })
  it('closing an advance: not with pending expenses; refunds freeze; no offsets after closing; the approver records the refund', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    const adv = await travelAdvance(s)
    expect(s.db.raw.prepare(`SELECT payment_method FROM advance_requests`).get()).toEqual({ payment_method: 'bank' })
    await rejects(req.closeAdvance(c, adv, {}), 403)
    await approveAll(s, adv)
    await req.markPaid(s.ctx('approver'), adv)
    const e = await req.submitExpense(c, expenseInput(1200))
    if (!e.ok) throw new Error(e.error)
    expect(await req.closeAdvance(c, adv, {})).toMatchObject({ ok: false, error: expect.stringContaining('onay bekleyen') })
    await approveAll(s, e.requests[0].id)
    await rejects(req.closeAdvance(s.ctx('employeeB'), adv, {}), 404)
    expect(await req.closeAdvance(c, adv, { note: 'Kalan elden iade' })).toEqual({ ok: true })
    expect((await req.closeAdvance(c, adv, {})).ok).toBe(false)
    expect(s.db.raw.prepare(`SELECT paid_minor, spent_minor, refund_minor FROM advance_closures`).get()).toEqual({ paid_minor: 350000, spent_minor: 120000, refund_minor: 230000 })
    expect((await req.homeData(c, [])).advance.openAmount).toBe(0)
    const e2 = await req.submitExpense(c, expenseInput(500))
    if (!e2.ok) throw new Error(e2.error)
    expect(s.db.raw.prepare(`SELECT COUNT(*) AS n FROM advance_allocations WHERE expense_request_id = ?`).get(e2.requests[0].id)).toEqual({ n: 0 })
    expect((await req.approvals(s.ctx('approver'))).refunds).toMatchObject([{ id: adv, amount: '2.300,00 ₺' }])
    await rejects(req.refundReceived(s.ctx('manager2'), adv), 403)
    expect(await req.refundReceived(s.ctx('approver'), adv)).toEqual({ ok: true })
    expect((await req.refundReceived(s.ctx('approver'), adv)).ok).toBe(false)
    expect((await req.myRequest(c, adv))?.detail.closure).toMatchObject({ paid: '3.500,00 ₺', spent: '1.200,00 ₺', refund: '2.300,00 ₺', note: 'Kalan elden iade', canClose: false })
    expect(() => s.db.raw.prepare(`UPDATE advance_closures SET refund_minor = 0`).run()).toThrow(/closure is fixed/)
  })
})

describe('attachments', () => {
  it('content type comes from the bytes, not the extension: exe and svg rejected, heic accepted', () => {
    expect(sniffType(new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toBeNull()
    expect(sniffType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    const heic = new Uint8Array(12)
    heic.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
    expect(sniffType(heic)).toBe('image/heic')
  })
  it('rejects 10 MB plus one byte and an exe disguised as jpeg', async () => {
    await expect(prepareFile(pdf('b.pdf', 10 * 1024 * 1024 + 1), 'f')).rejects.toBeInstanceOf(FileRejected)
    await expect(prepareFile(new File([new Uint8Array([0x4d, 0x5a])], 'x.jpg', { type: 'image/jpeg' }), 'f')).rejects.toThrow('Yalnız PDF')
  })
  it('a medical certificate opens for its owner and management, not for other employees', async () => {
    const s = setup()
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', file: pdf('rapor.pdf') }))
    expect(r.ok).toBe(true)
    const { id } = s.db.raw.prepare(`SELECT id FROM attachments`).get() as { id: string }
    const att = (await attachmentForRead(s.db, id))!
    for (const [who, ok] of [['employeeA', true], ['approver', true], ['manager', true], ['manager2', true], ['owner', true], ['employeeB', false]] as const) {
      expect(authorize(s.users[who], { a: 'attachment.read', p: att.parent }).ok, who).toBe(ok)
    }
  })
})

describe('invoices', () => {
  const inv = (over: Record<string, unknown> = {}) =>
    form({ direction: 'in', fileName: 'f.pdf', file: pdf(), firm: 'Örnek Ltd.', no: 'A1', date: '2026-10-10', net: 1000, vatRate: 20, toInventory: false, costKind: 'overhead', items: [], ...over })
  it('an unflagged employee cannot upload; a flagged one uploads incoming but not outgoing invoices', async () => {
    const s = setup()
    await rejects(mng.createInvoice(s.ctx('employeeA'), inv()), 403)
    expect((await mng.createInvoice(s.ctx('employeeB'), inv())).ok).toBe(true)
    await rejects(mng.createInvoice(s.ctx('employeeB'), inv({ direction: 'out', due: '2026-11-10', no: 'B1' })), 403)
  })
  it('a flagged employee lists only their own uploads; management lists all', async () => {
    const s = setup()
    await mng.createInvoice(s.ctx('employeeB'), inv())
    await mng.createInvoice(s.ctx('manager'), inv({ no: 'A2' }))
    expect((await mng.listInvoices(s.ctx('employeeB'))).map((i) => i.no)).toEqual(['A1'])
    expect(await mng.listInvoices(s.ctx('owner'))).toHaveLength(2)
    await rejects(mng.listInvoices(s.ctx('employeeA')), 403)
  })
  it('the same company and number cannot be uploaded twice (Turkish case folding included)', async () => {
    const s = setup()
    expect((await mng.createInvoice(s.ctx('manager'), inv({ firm: 'İnci Ltd.' }))).ok).toBe(true)
    expect(await mng.createInvoice(s.ctx('manager'), inv({ firm: 'inci ltd.' }))).toMatchObject({ ok: false, fieldErrors: { no: expect.any(String) } })
  })
  it('adding to inventory creates one item per unit and computes VAT', async () => {
    const s = setup()
    const r = await mng.createInvoice(s.ctx('manager'), inv({ toInventory: true, items: [{ name: 'Işık', qty: 2 }, { name: 'Kamera', qty: 1, serial: 'K-1' }] }))
    expect(r).toMatchObject({ ok: true, assets: 3, invoice: { vat: 200, total: 1200 } })
    expect((await mng.listAssets(s.ctx('manager'))).map((a) => a.serial).sort()).toEqual(['', '', 'K-1'])
  })
  it('settlement date: management marks and clears it; employees cannot; date limits apply', async () => {
    const s = setup()
    const r = await mng.createInvoice(s.ctx('manager'), inv({ direction: 'out', due: '2026-11-10', no: 'S1' }))
    if (!r.ok) throw new Error('fatura')
    const id = r.invoice.id
    await rejects(mng.settleInvoice(s.ctx('employeeB'), { id, settledOn: '2026-10-15' }), 403)
    expect(await mng.settleInvoice(s.ctx('manager'), { id, settledOn: '2026-10-05' })).toMatchObject({ ok: false, fieldErrors: { settledOn: expect.any(String) } })
    expect(await mng.settleInvoice(s.ctx('manager'), { id, settledOn: '2026-10-30' })).toMatchObject({ ok: false, fieldErrors: { settledOn: expect.any(String) } })
    expect(await mng.settleInvoice(s.ctx('manager'), { id, settledOn: '2026-10-15' })).toEqual({ ok: true, settledOn: '2026-10-15' })
    expect((await mng.listInvoices(s.ctx('manager'))).find((i) => i.id === id)?.settledOn).toBe('2026-10-15')
    expect(await mng.settleInvoice(s.ctx('manager'), { id, settledOn: null })).toEqual({ ok: true, settledOn: null })
    expect((await mng.listInvoices(s.ctx('manager'))).find((i) => i.id === id)?.settledOn).toBeNull()
  })
})

describe('user management', () => {
  const user = (over: Record<string, unknown> = {}) => ({ displayName: 'Yeni Kişi', email: 'yeni@ornek.test', role: 'employee', isAdmin: false, canUploadInvoices: false, leaveEntitlement: 14, status: 'active', ...over })
  it('non-admins cannot add users; admins can, with an audit entry', async () => {
    const s = setup()
    await rejects(mng.saveUser(s.ctx('owner'), user(), 'ornek.test'), 403)
    const r = await mng.saveUser(s.ctx('manager'), user(), 'ornek.test')
    expect(r.ok).toBe(true)
    expect(s.db.raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.create'`).get()).toEqual({ n: 1 })
  })
  it('the edit-jobs flag is kept only for employees and cleared on a role change', async () => {
    const s = setup()
    const r = await mng.saveUser(s.ctx('manager'), user({ canManageJobs: true }), 'ornek.test')
    if (!r.ok) throw new Error(r.error)
    expect(r.user.canManageJobs).toBe(true)
    const flag = () => s.db.raw.prepare(`SELECT can_manage_jobs AS f FROM users WHERE id = ?`).get(r.user.id)
    expect(flag()).toEqual({ f: 1 })
    const up = await mng.saveUser(s.ctx('manager'), user({ id: r.user.id, role: 'manager', canManageJobs: true }), 'ornek.test')
    expect(up.ok).toBe(true)
    expect(flag()).toEqual({ f: 0 })
  })
  it('rejects emails outside the allowed domain and duplicates', async () => {
    const s = setup()
    expect(await mng.saveUser(s.ctx('manager'), user({ email: 'x@gmail.com' }), 'ornek.test')).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } })
    expect(await mng.saveUser(s.ctx('manager'), user({ email: 'employeea@ornek.test' }), 'ornek.test')).toMatchObject({ ok: false, fieldErrors: { email: 'Bu e-posta zaten kayıtlı' } })
  })
  it('an admin cannot remove their own admin flag or deactivate themselves', async () => {
    const s = setup()
    const me = { id: s.users.manager.id, displayName: 'manager', email: 'manager@ornek.test', role: 'manager' }
    expect((await mng.saveUser(s.ctx('manager'), user({ ...me, isAdmin: false }), 'ornek.test')).ok).toBe(false)
    expect((await mng.saveUser(s.ctx('manager'), user({ ...me, isAdmin: true, status: 'inactive' }), 'ornek.test')).ok).toBe(false)
  })
  it('an admin cannot change their own role', async () => {
    const s = setup()
    const me = { id: s.users.manager.id, displayName: 'manager', email: 'manager@ornek.test', isAdmin: true }
    expect(await mng.saveUser(s.ctx('manager'), user({ ...me, role: 'owner' }), 'ornek.test')).toMatchObject({ ok: false, fieldErrors: { role: expect.any(String) } })
    expect((await mng.saveUser(s.ctx('manager'), user({ ...me, role: 'manager' }), 'ornek.test')).ok).toBe(true)
  })
  it('the invoice flag is kept only for employees', async () => {
    const s = setup()
    const r = await mng.saveUser(s.ctx('manager'), user({ role: 'owner', canUploadInvoices: true, email: 'c2@ornek.test' }), 'ornek.test')
    expect(r).toMatchObject({ ok: true, user: { canUploadInvoices: false } })
  })
})

describe('database guards', () => {
  it('business tables reject DELETE; audit_log cannot be changed', async () => {
    const s = setup()
    await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', file: pdf() }))
    for (const t of ['users', 'requests', 'leave_requests', 'attachments', 'leave_entitlements']) {
      expect(() => s.db.raw.exec(`DELETE FROM ${t}`), t).toThrow(/no delete/)
    }
    const business = (s.db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('audit_log','assertions','d1_migrations','invoice_links','sessions','app_settings') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`).all() as { name: string }[]).map((r) => r.name)
    const guarded = new Set((s.db.raw.prepare(`SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_no_delete'`).all() as { tbl_name: string }[]).map((r) => r.tbl_name))
    expect(business.filter((t) => !guarded.has(t))).toEqual([])
    expect(() => s.db.raw.exec(`UPDATE audit_log SET action = 'x'`)).toThrow(/append-only/)
    expect(() => s.db.raw.exec(`DELETE FROM audit_log`)).toThrow(/append-only/)
  })
  it('status changes keep the content; submitted requests take no new attachments', async () => {
    const s = setup()
    const id = await submitted(s, 'employeeA', 'expense')
    expect(() => s.db.raw.prepare(`UPDATE requests SET status = 'approved', decided_at = '2026-10-21T10:00:00.000Z', decided_by = ?, requester_id = ? WHERE id = ?`).run(s.users.employeeA.id, s.users.employeeB.id, id)).toThrow(/locked/)
    expect(() =>
      s.db.raw
        .prepare(`INSERT INTO attachments (id, r2_key, kind, request_id, original_name, content_type, size_bytes, sha256, uploaded_by) VALUES ('99999999999999999999999999', 'att/2026/10/x', 'other', ?, 'x.pdf', 'application/pdf', 1, ?, ?)`)
        .run(id, 'a'.repeat(64), s.users.employeeA.id),
    ).toThrow(/not draft/)
  })
  it('state machine: a rejected request cannot be reopened and submitted content cannot change', async () => {
    const s = setup()
    const id = await submitted(s, 'employeeA', 'expense')
    expect(() => s.db.raw.prepare(`UPDATE requests SET title = 'x' WHERE id = ?`).run(id)).toThrow(/frozen|locked/)
    expect(() => s.db.raw.prepare(`UPDATE requests SET approver_role = 'owner' WHERE id = ?`).run(id)).toThrow(/frozen/)
    expect(() => s.db.raw.prepare(`UPDATE requests SET approver_role = NULL WHERE id = ?`).run(id)).toThrow(/frozen/)
    expect(() => s.db.raw.prepare(`UPDATE requests SET approver_role = 'employee' WHERE id = ?`).run(id)).toThrow()
    expect(() => s.db.raw.prepare(`INSERT INTO leave_requests (request_id, kind, start_date, end_date, work_days, year) VALUES (?, 'annual', '2026-11-02', '2026-11-02', 0.3, 2026)`).run(id)).toThrow()
    await req.decide(s.ctx('approver'), id, 'rejected', 'yok')
    expect(() => s.db.raw.prepare(`UPDATE requests SET status = 'pending' WHERE id = ?`).run(id)).toThrow()
  })
})

describe('dashboard and fixed costs', () => {
  it('only management enters fixed costs; re-entering updates them; dashboard totals add up', async () => {
    const s = setup()
    const rate = { people: null, hours: 160, utilization: 65, margin: 25 }
    const fc = (month: string, personnel: number, office: number, extra: Record<string, number> = {}) => ({ month, personnel, office, ...extra, ...rate })
    await rejects(mng.saveFixedCosts(s.ctx('employeeA'), fc('2026-10', 1, 1)), 403)
    expect((await mng.saveFixedCosts(s.ctx('owner'), fc('2026-10', 760000, 128000))).ok).toBe(true)
    expect((await mng.saveFixedCosts(s.ctx('manager'), { ...fc('2026-10', 760000, 130000, { software: 50000, professional: 32000 }), people: 8 })).ok).toBe(true)
    expect((await mng.saveFixedCosts(s.ctx('manager'), fc('2026-11', 1, 1))).ok).toBe(false)
    expect((await mng.saveFixedCosts(s.ctx('manager'), { ...fc('2026-10', 1, 1), utilization: 0 })).ok).toBe(false)
    const direct = form({ direction: 'in', fileName: 'f.pdf', file: pdf(), firm: 'Freelancer', no: 'D1', date: '2026-10-06', net: 40_000, vatRate: 20, toInventory: false, items: [] })
    expect((await mng.createInvoice(s.ctx('manager'), direct)).ok).toBe(false)
    direct.json = { ...(direct.json as object), costKind: 'direct' }
    const d1 = await mng.createInvoice(s.ctx('manager'), direct)
    if (!d1.ok) throw new Error(d1.error)
    expect((await mng.overview(s.ctx('manager2'))).months.find((m) => m.key === '2026-10')!.breakdown.invoicesDirect).toBe(0)
    expect(await decideInvoice(s.ctx('approver'), d1.invoice.id, 'approved', undefined, { expectedVersion: await invVersion(s.ctx('approver'), d1.invoice.id) })).toEqual({ ok: true })
    const inv = form({ direction: 'out', fileName: 'f.pdf', file: pdf(), firm: 'Müşteri', no: 'S1', date: '2026-10-05', due: '2026-11-05', net: 1_000_000, vatRate: 20, toInventory: false, items: [] })
    await mng.createInvoice(s.ctx('approver'), inv)
    const o = await mng.overview(s.ctx('manager2'))
    const oct = o.months.find((m) => m.key === '2026-10')!
    expect(oct).toMatchObject({ income: 1_000_000, expense: 1_012_000, fixedMissing: false, invoiceCount: 1 })
    expect(oct.breakdown).toMatchObject({ personnel: 760_000, office: 130_000, software: 50_000, professional: 32_000, invoicesDirect: 40_000, invoicesOverhead: 0 })
    expect(o.rate).toMatchObject({ people: 8, peopleAuto: false, utilization: 65, margin: 25 })
    expect(o.months.find((m) => m.key === '2026-09')!.fixedMissing).toBe(true)
    expect(o.receivables).toMatchObject({ amount: 1_000_000, count: 1 })
    await rejects(mng.overview(s.ctx('employeeB')), 403)
  })
})

describe('software inventory', () => {
  it('seat count is informational: a seat can be assigned to several people', async () => {
    const s = setup()
    const r = await mng.saveDigital(s.ctx('manager'), { kind: 'software', name: 'Design suite', purpose: 'Layout work', period: 'yearly', cost: 1_000, currency: 'TRY', seats: 1, userIds: [s.users.employeeA.id, s.users.employeeB.id] })
    expect(r.ok).toBe(true)
    expect((await mng.listDigital(s.ctx('manager')))[0]).toMatchObject({ purpose: 'Layout work' })
    expect((await mng.listDigital(s.ctx('manager')))[0].users).toHaveLength(2)
  })
  it('management only; add, edit, cancel; no seat limit; the monthly amount feeds the fixed-cost suggestion', async () => {
    const s = setup()
    const base = { kind: 'software', name: 'Design suite', period: 'yearly', renewsOn: '2026-11-12', cost: 96_000, currency: 'TRY', seats: 3, userIds: [s.users.employeeA.id] }
    await rejects(mng.saveDigital(s.ctx('employeeA'), base), 403)
    await rejects(mng.listDigital(s.ctx('employeeB')), 403)
    const r = await mng.saveDigital(s.ctx('manager'), base)
    expect(r.ok).toBe(true)
    const id = (r as { id: string }).id
    expect((await mng.saveDigital(s.ctx('manager2'), { kind: 'domain', name: 'example.com', period: 'monthly', renewsOn: '2026-11-01', cost: 1_000, currency: 'TRY', userIds: [] })).ok).toBe(true)
    let list = await mng.listDigital(s.ctx('owner'))
    expect(list).toHaveLength(2)
    expect(list.find((d) => d.id === id)).toMatchObject({ cost: 96_000, seats: 3, users: [{ id: s.users.employeeA.id }] })
    expect((await mng.digitalMonthlyTotal(s.db)).total).toBe(9_000)
    expect((await mng.saveDigital(s.ctx('manager'), { ...base, id, status: 'cancelled', userIds: [] })).ok).toBe(true)
    list = await mng.listDigital(s.ctx('manager'))
    expect(list.find((d) => d.id === id)).toMatchObject({ status: 'cancelled', users: [] })
    expect((await mng.digitalMonthlyTotal(s.db)).total).toBe(1_000)
    expect((await mng.saveDigital(s.ctx('manager'), { kind: 'software', name: 'Team chat', period: 'monthly', cost: 20, currency: 'USD', seats: 4, userIds: [] })).ok).toBe(true)
    expect(await mng.digitalMonthlyTotal(s.db)).toEqual({ total: 1_000, missingFx: 1 })
    await rejects(mng.saveFx(s.ctx('employeeA'), { rates: { USD: 40, EUR: 45 } }), 403)
    expect((await mng.saveFx(s.ctx('manager'), { rates: { USD: 41.5, EUR: null } })).ok).toBe(true)
    expect(await mng.digitalMonthlyTotal(s.db)).toEqual({ total: 1_830, missingFx: 0 })
  })
})

describe('inventory editing and person page', () => {
  it('equipment can be edited; assigned items cannot go to service; the person page shows items and seats', async () => {
    const s = setup()
    const add = await mng.createAsset(s.ctx('manager'), { name: 'Camera battery', acquiredOn: '2026-10-01', quantity: 5, category: 'Battery' })
    expect(add.ok).toBe(true)
    const id = (add as { asset: { id: string } }).asset.id
    const base = { id, name: 'Camera battery pack', quantity: 5, category: 'Battery', condition: 'active' }
    await rejects(mng.updateAsset(s.ctx('employeeA'), base), 403)
    expect((await mng.updateAsset(s.ctx('manager'), { ...base, serial: 'X1' })).ok).toBe(false)
    expect((await mng.updateAsset(s.ctx('manager'), base)).ok).toBe(true)
    expect((await mng.assignAsset(s.ctx('manager'), { assetId: id, userId: s.users.employeeA.id, date: '2026-10-10' })).ok).toBe(true)
    expect((await mng.updateAsset(s.ctx('manager'), { ...base, condition: 'in_repair' })).ok).toBe(false)
    const d = await mng.saveDigital(s.ctx('manager'), { kind: 'software', name: 'Whiteboard tool', period: 'monthly', cost: 10, currency: 'USD', seats: 1, userIds: [] })
    const did = (d as { id: string }).id
    expect((await mng.setDigitalSeat(s.ctx('manager'), { assetId: did, userId: s.users.employeeA.id, on: true })).ok).toBe(true)
    expect((await mng.setDigitalSeat(s.ctx('manager'), { assetId: did, userId: s.users.employeeB.id, on: true })).ok).toBe(true)
    const p = (await mng.personInventory(s.ctx('manager2'), s.users.employeeA.id))!
    expect(p.holding.map((a) => a.name)).toEqual(['Camera battery pack'])
    expect(p.seats.map((x) => x.name)).toEqual(['Whiteboard tool'])
    await rejects(mng.personInventory(s.ctx('employeeB'), s.users.employeeA.id), 403)
    expect((await mng.setDigitalSeat(s.ctx('manager'), { assetId: did, userId: s.users.employeeA.id, on: false })).ok).toBe(true)
    expect((await mng.personInventory(s.ctx('manager'), s.users.employeeA.id))!.seats).toEqual([])
  })
})

describe('negative leave balance limit', () => {
  it('with 2 days of entitlement, 16 workdays pass (-14) and 17 do not', async () => {
    const s = setup()
    s.db.raw.prepare(`UPDATE leave_entitlements SET entitled_days = 2 WHERE user_id = ?`).run(s.users.employeeA.id)
    expect((await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-11-02', end: '2026-11-24' }))).ok).toBe(false)
    expect((await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-11-02', end: '2026-11-23' }))).ok).toBe(true)
  })
})

describe('all requests (management, read-only)', () => {
  it('management lists and opens everyone\'s requests; employees cannot; drafts stay hidden', async () => {
    const s = setup()
    await req.submitLeave(s.ctx('employeeA'), leaveInput())
    for (const who of ['manager', 'manager2', 'approver', 'owner'] as const) {
      const all = await req.allRequests(s.ctx(who))
      const mine = all.requests.find((r) => r.requesterName === 'employeeA')
      expect(mine, who).toBeTruthy()
      expect((await req.anyRequest(s.ctx(who), mine!.id))?.requesterName).toBe('employeeA')
    }
    await rejects(req.allRequests(s.ctx('employeeB')), 403)
    const any = (await req.allRequests(s.ctx('manager'))).requests[0]
    expect(await req.anyRequest(s.ctx('employeeB'), any.id)).toBeNull()
  })
})

describe('legal records: document acceptance, handover confirmation, leave statement', () => {
  it('document acceptance uses the current version; only the holder confirms an assignment, once; statements are confirmed once; records cannot be changed', async () => {
    const s = setup({ policies: false })
    expect(await cmp.pendingPolicies(s.db, s.users.employeeA.id)).toEqual(['policy', 'kvkk'])
    expect((await cmp.acceptPolicies(s.ctx('employeeA'), { version: 'eski', docs: ['policy'] })).ok).toBe(false)
    expect((await cmp.acceptPolicies(s.ctx('employeeA'), { version: LEGAL_VERSION, docs: ['policy', 'kvkk'] })).ok).toBe(true)
    expect(await cmp.pendingPolicies(s.db, s.users.employeeA.id)).toEqual([])
    const a = await mng.createAsset(s.ctx('manager'), { name: 'Laptop', acquiredOn: '2026-10-01' })
    const aid = (a as { asset: { id: string } }).asset.id
    await mng.assignAsset(s.ctx('manager'), { assetId: aid, userId: s.users.employeeA.id, date: '2026-10-10' })
    const rec = await cmp.myRecords(s.ctx('employeeA'))
    const gid = rec.assets[0].assignmentId
    expect(rec.assets[0].acknowledgedAt).toBeNull()
    expect(await cmp.myPending(s.ctx('employeeA'))).toMatchObject({ assets: 1 })
    expect((await cmp.acknowledgeAssignment(s.ctx('employeeB'), gid)).ok).toBe(false)
    expect((await cmp.acknowledgeAssignment(s.ctx('employeeA'), gid)).ok).toBe(true)
    expect((await cmp.acknowledgeAssignment(s.ctx('employeeA'), gid)).ok).toBe(false)
    expect((await cmp.myRecords(s.ctx('employeeA'))).assets[0].acknowledgedAt).toBeTruthy()
    expect((await cmp.confirmLeaveStatement(s.ctx('employeeA'), 2027)).ok).toBe(false)
    expect((await cmp.confirmLeaveStatement(s.ctx('employeeA'), 2026)).ok).toBe(true)
    expect((await cmp.confirmLeaveStatement(s.ctx('employeeA'), 2026)).ok).toBe(false)
    expect((await cmp.leaveStatement(s.ctx('employeeA'), 2026)).confirmedAt).toBeTruthy()
    await rejects(cmp.leaveStatement(s.ctx('employeeB'), 2026, s.users.employeeA.id), 403)
    expect((await cmp.leaveStatement(s.ctx('manager'), 2026, s.users.employeeA.id)).confirmedAt).toBeTruthy()
    expect(() => s.db.raw.prepare(`DELETE FROM policy_acceptances`).run()).toThrow(/append-only/)
    expect(() => s.db.raw.prepare(`UPDATE leave_statements SET year = 2025`).run()).toThrow(/append-only/)
    await rejects(cmp.undertakingPeople(s.ctx('employeeA')), 403)
  })
})

describe('return confirmation and statement in reports', () => {
  it('only the holder confirms a return, after it happened and once; management sees it in history; reports show the statement date', async () => {
    const s = setup()
    const a = await mng.createAsset(s.ctx('manager'), { name: 'Laptop', acquiredOn: '2026-10-01' })
    const aid = (a as { asset: { id: string } }).asset.id
    await mng.assignAsset(s.ctx('manager'), { assetId: aid, userId: s.users.employeeA.id, date: '2026-10-10' })
    const gid = (await cmp.myRecords(s.ctx('employeeA'))).assets[0].assignmentId
    expect((await cmp.confirmReturn(s.ctx('employeeA'), gid)).ok).toBe(false)
    expect(() => s.db.raw.prepare(`UPDATE assignments SET return_confirmed_at = '2026-10-27T10:00:00.000Z' WHERE id = ?`).run(gid)).toThrow(/needs a return/)
    await mng.returnAsset(s.ctx('manager'), aid)
    expect((await cmp.myRecords(s.ctx('employeeA'))).returned).toMatchObject([{ assignmentId: gid, confirmedAt: null }])
    expect((await cmp.confirmReturn(s.ctx('employeeB'), gid)).ok).toBe(false)
    expect((await cmp.confirmReturn(s.ctx('employeeA'), gid)).ok).toBe(true)
    expect((await cmp.confirmReturn(s.ctx('employeeA'), gid)).ok).toBe(false)
    expect(() => s.db.raw.prepare(`UPDATE assignments SET return_confirmed_at = NULL WHERE id = ?`).run(gid)).toThrow(/fixed/)
    const asset = (await mng.listAssets(s.ctx('manager'))).find((x) => x.id === aid)!
    expect(asset.history[0].returnConfirmedAt).toBeTruthy()
    expect((await rep.leaveReport(s.ctx('manager'), '2026-10')).balances.find((b) => b.userId === s.users.employeeA.id)?.statementAt).toBeNull()
    await cmp.confirmLeaveStatement(s.ctx('employeeA'), 2026)
    expect((await rep.leaveReport(s.ctx('manager'), '2026-10')).balances.find((b) => b.userId === s.users.employeeA.id)?.statementAt).toBeTruthy()
  })
})

describe('leave calendar', () => {
  it('everyone sees approved leave without its type; pending leave is hidden', async () => {
    const s = setup()
    const a = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', start: '2026-11-02', end: '2026-11-03' }))
    if (!a.ok) throw new Error(a.error)
    await req.decide(s.ctx('approver'), a.request.id, 'approved')
    const b = await req.submitLeave(s.ctx('employeeB'), leaveInput({ start: '2026-11-05', end: '2026-11-05' }))
    if (!b.ok) throw new Error(b.error)
    const r = await cal.teamLeaves(s.ctx('employeeB'), '2026-11')
    expect(r.leaves).toHaveLength(1)
    expect(r.leaves[0]).toMatchObject({ userId: s.users.employeeA.id, start: '2026-11-02', end: '2026-11-03' })
    expect(Object.keys(r.leaves[0]).sort()).toEqual(['end', 'hue', 'name', 'part', 'start', 'userId'])
    expect((await cal.teamLeaves(s.ctx('employeeB'), '2026-12')).leaves).toHaveLength(0)
    expect(authorize(s.users.employeeB, { a: 'calendar.read' }).ok).toBe(true)
    const h = await req.submitLeave(s.ctx('employeeA'), leaveInput({ span: 'hours', start: '2026-11-10', end: '2026-11-10', startTime: '14:00', endTime: '16:00' }))
    if (!h.ok) throw new Error(h.error)
    await req.decide(s.ctx('approver'), h.request.id, 'approved')
    const hours = (await cal.teamLeaves(s.ctx('employeeB'), '2026-11')).leaves.find((l) => l.start === '2026-11-10')
    expect(hours).toMatchObject({ part: 'hours' })
    expect(JSON.stringify(hours)).not.toMatch(/14:00|16:00/)
    expect(authorize({ ...s.users.employeeB, status: 'inactive' } as AuthUser, { a: 'calendar.read' }).ok).toBe(false)
  })
})

describe('leave calendar: hidden entries and window', () => {
  it('rejected, cancelled and inactive users\' leave is hidden; older than last month and beyond 12 months is empty', async () => {
    const s = setup()
    const rej = await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-11-02', end: '2026-11-02' }))
    if (!rej.ok) throw new Error(rej.error)
    await req.decide(s.ctx('approver'), rej.request.id, 'rejected', 'yoğun hafta')
    const can = await req.submitLeave(s.ctx('employeeA'), leaveInput({ start: '2026-11-03', end: '2026-11-03' }))
    if (!can.ok) throw new Error(can.error)
    await req.cancel(s.ctx('employeeA'), can.request.id)
    const ok = await req.submitLeave(s.ctx('employeeB'), leaveInput({ start: '2026-11-04', end: '2026-11-04' }))
    if (!ok.ok) throw new Error(ok.error)
    await req.decide(s.ctx('approver'), ok.request.id, 'approved')
    expect((await cal.teamLeaves(s.ctx('employeeA'), '2026-11')).leaves.map((l) => l.userId)).toEqual([s.users.employeeB.id])
    s.db.raw.prepare(`UPDATE users SET status = 'inactive', deactivated_at = '2026-10-28T09:00:00.000Z' WHERE id = ?`).run(s.users.employeeB.id)
    expect((await cal.teamLeaves(s.ctx('employeeA'), '2026-11')).leaves).toHaveLength(0)
    const today = s.ctx('employeeA').today ?? '2026-10-28'
    const w = cal.calendarWindow(today)
    expect(w).toEqual(cal.calendarWindow(today))
    expect(w.min < today.slice(0, 7) && w.max > today.slice(0, 7)).toBe(true)
    expect((await cal.teamLeaves(s.ctx('employeeA'), '2025-01')).leaves).toEqual([])
    expect((await cal.teamLeaves(s.ctx('employeeA'), '2030-01')).leaves).toEqual([])
  })
})

describe('inventory: held by someone outside the panel', () => {
  it('is given with a description, counts as assigned, cannot be given twice and returns to storage when taken back', async () => {
    const s = setup()
    const a = await mng.createAsset(s.ctx('manager'), { name: 'Camera body', acquiredOn: '2026-10-01' })
    if (!a.ok) throw new Error('asset')
    const id = a.asset.id
    expect((await mng.assignAsset(s.ctx('manager'), { assetId: id, date: '2026-10-20' })).ok).toBe(false)
    const o = await mng.assignAsset(s.ctx('manager'), { assetId: id, other: 'Outside studio (contractor)', date: '2026-10-20' })
    if (!o.ok) throw new Error(JSON.stringify(o))
    let x = (await mng.listAssets(s.ctx('manager'))).find((v) => v.id === id)!
    expect(x).toMatchObject({ holderOther: 'Outside studio (contractor)', holderName: 'Outside studio (contractor)', holderOtherOn: '2026-10-20' })
    expect((await mng.assignAsset(s.ctx('manager'), { assetId: id, userId: s.users.employeeA.id, date: '2026-10-21' })).ok).toBe(false)
    expect((await mng.returnAsset(s.ctx('manager'), id)).ok).toBe(true)
    x = (await mng.listAssets(s.ctx('manager'))).find((v) => v.id === id)!
    expect(x).toMatchObject({ holderOther: '', holderName: '—', officeOn: '2026-10-21' })
    expect((await mng.returnAsset(s.ctx('manager'), id)).ok).toBe(false)
    expect((await mng.assignAsset(s.ctx('manager'), { assetId: id, userId: s.users.employeeA.id, date: '2026-10-21' })).ok).toBe(true)
  })
})

describe('inventory: inactive (in office) date', () => {
  it('moves an assigned item to the office on the chosen date; date corrections show in the history; cannot predate the assignment', async () => {
    const s = setup()
    const a = await mng.createAsset(s.ctx('manager'), { name: 'Desktop workstation', acquiredOn: '2026-10-01' })
    if (!a.ok) throw new Error('asset')
    const id = a.asset.id
    await mng.assignAsset(s.ctx('manager'), { assetId: id, userId: s.users.employeeA.id, date: '2026-10-12' })
    expect((await mng.toOffice(s.ctx('manager'), { id, date: '2026-10-05' })).ok).toBe(false)
    expect((await mng.toOffice(s.ctx('manager'), { id, date: '2026-10-15' })).ok).toBe(true)
    const ret = () => s.db.raw.prepare(`SELECT returned_on FROM assignments WHERE asset_id = ?`).get(id) as { returned_on: string }
    expect(ret().returned_on).toBe('2026-10-15')
    expect((await mng.toOffice(s.ctx('manager'), { id, date: '2026-10-17' })).ok).toBe(true)
    expect(ret().returned_on).toBe('2026-10-17')
    expect((await mng.listAssets(s.ctx('manager'))).find((v) => v.id === id)).toMatchObject({ officeOn: '2026-10-17' })
    expect((await mng.toOffice(s.ctx('manager'), { id, date: '2026-10-11' })).ok).toBe(false)
  })
})

describe('required assignment confirmation at sign-in', () => {
  it('pending list; not mine is recorded once, cannot then be confirmed, shows in inventory and leaves the list', async () => {
    const s = setup()
    const mk = async (name: string) => {
      const a = await mng.createAsset(s.ctx('manager'), { name, acquiredOn: '2026-10-01' })
      if (!a.ok) throw new Error('asset')
      await mng.assignAsset(s.ctx('manager'), { assetId: a.asset.id, userId: s.users.employeeA.id, date: '2026-10-10' })
      return (s.db.raw.prepare(`SELECT id FROM assignments WHERE asset_id = ?`).get(a.asset.id) as { id: string }).id
    }
    const g1 = await mk('Laptop')
    const g2 = await mk('Kamera')
    expect((await cmp.pendingAssets(s.db, s.users.employeeA.id)).map((x) => x.id).sort()).toEqual([g1, g2].sort())
    expect((await cmp.disputeAssignment(s.ctx('employeeB'), { id: g1 })).ok).toBe(false)
    expect((await cmp.disputeAssignment(s.ctx('employeeA'), { id: g1, note: 'bende değil' })).ok).toBe(true)
    expect((await cmp.disputeAssignment(s.ctx('employeeA'), { id: g1 })).ok).toBe(false)
    expect((await cmp.acknowledgeAssignment(s.ctx('employeeA'), g1)).ok).toBe(false)
    expect((await cmp.acknowledgeAssignment(s.ctx('employeeA'), g2)).ok).toBe(true)
    expect((await cmp.disputeAssignment(s.ctx('employeeA'), { id: g2 })).ok).toBe(false)
    expect(await cmp.pendingAssets(s.db, s.users.employeeA.id)).toEqual([])
    expect((await cmp.myPending(s.ctx('employeeA'))).assets).toBe(0)
    const inv = await mng.listAssets(s.ctx('manager'))
    expect(inv.find((x) => x.name === 'Laptop')?.history[0]).toMatchObject({ disputeNote: 'bende değil' })
    expect(inv.find((x) => x.name === 'Laptop')?.history[0].disputedAt).toBeTruthy()
  })
})

describe('D1 limits', () => {
  it('lists work with more than 100 invoices and items (100 parameters per query)', async () => {
    const s = setup()
    const ins = s.db.raw.prepare(`INSERT INTO invoices (id, direction, invoice_no, counterparty, invoice_date, net_minor, vat_minor, net_base_minor, vat_base_minor, uploaded_by, created_by, updated_by) VALUES (?, 'in', ?, 'F', '2026-10-01', 1, 0, 1, 0, ?, ?, ?)`)
    const asset = s.db.raw.prepare(`INSERT INTO assets (id, name, created_by, updated_by) VALUES (?, 'E', ?, ?)`)
    const m = s.users.manager.id
    for (let i = 0; i < 130; i++) {
      ins.run(`6${String(i).padStart(25, '0')}`, `N${i}`, m, m, m)
      asset.run(`7${String(i).padStart(25, '0')}`, m, m)
    }
    expect(await mng.listInvoices(s.ctx('manager'))).toHaveLength(130)
    expect(await mng.listAssets(s.ctx('manager'))).toHaveLength(130)
  })
  it('at most 200 items are added to inventory from one invoice', async () => {
    const s = setup()
    const r = await mng.createInvoice(s.ctx('manager'), form({ direction: 'in', fileName: 'f.pdf', file: pdf(), firm: 'X', no: 'Z9', date: '2026-10-10', net: 1, vatRate: 20, toInventory: true, costKind: 'overhead', items: [{ name: 'Kablo', qty: 201 }] }))
    expect(r).toMatchObject({ ok: false, fieldErrors: { items: expect.any(String) } })
  })
  it('new uploads are removed when the batch fails', async () => {
    const s = setup()
    expect((await req.submitLeave(s.ctx('employeeA'), leaveInput())).ok).toBe(true)
    const r = await req.submitLeave(s.ctx('employeeA'), leaveInput({ kind: 'sick', file: pdf('rapor.pdf') }))
    expect(r.ok).toBe(false)
    expect(s.stored).toHaveLength(0)
  })
})

