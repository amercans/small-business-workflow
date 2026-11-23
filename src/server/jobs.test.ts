import { describe, expect, it } from 'vitest'
import { authorize, HttpError, type AuthUser } from './auth/authorize'
import type { Ctx } from './ctx'
import { splitMinor } from '#/lib/jobs'
import * as jobs from './services/jobs'
import * as jobTypes from './services/jobTypes'
import { jobTypeLabel } from '#/lib/jobs'
import { setup, type Who } from './testkit'

const rejects = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(HttpError)
  expect((e as HttpError).status).toBe(status)
}

function withFlagged() {
  const s = setup()
  s.db.raw.prepare(`UPDATE users SET can_manage_jobs = 1 WHERE id = ?`).run(s.users.employeeA.id)
  const flaggedUser: AuthUser = { ...s.users.employeeA, canManageJobs: true }
  const flagged = (): Ctx => ({ ...s.ctx('employeeA'), user: flaggedUser })
  return { ...s, flaggedUser, flagged }
}

const job = (over: Record<string, unknown> = {}) => ({
  client: 'Örnek Ltd.',
  title: 'Spring Campaign Video',
  unit: 'Marketing',
  kind: 'project',
  start: '2026-10-01',
  end: '2026-10-15',
  ...over,
})

function legacyJob(s: ReturnType<typeof setup>, o: { id: string; title: string; status: string; end?: string | null; members?: { userId: string; bp: number | null }[] }) {
  const by = s.users.manager.id
  s.db.raw.prepare(`INSERT INTO jobs (id, client, title, kind, status, start_date, end_date, created_by, updated_by) VALUES (?, 'Örnek Ltd.', ?, 'project', ?, '2026-08-11', ?, ?, ?)`).run(o.id.padEnd(26, '0'), o.title, o.status, o.end ?? null, by, by)
  for (const m of o.members ?? []) s.db.raw.prepare(`INSERT INTO job_members (job_id, user_id, share_bp, added_by) VALUES (?, ?, ?, ?)`).run(o.id.padEnd(26, '0'), m.userId, m.bp, by)
  return o.id.padEnd(26, '0')
}

describe('jobs: authorization matrix', () => {
  const s = withFlagged()
  const u = s.users
  const MGMT: Who[] = ['manager', 'manager2', 'approver', 'owner']

  it('an employee without the flag sees the list but cannot add or see amounts', () => {
    expect(authorize(u.employeeB, { a: 'jobs.read' }).ok).toBe(true)
    for (const a of ['jobs.write', 'jobs.money'] as const) expect(authorize(u.employeeB, { a }).ok).toBe(false)
  })
  it('a flagged employee sees and adds jobs but not amounts or shares', () => {
    expect(authorize(s.flaggedUser, { a: 'jobs.read' }).ok).toBe(true)
    expect(authorize(s.flaggedUser, { a: 'jobs.write' }).ok).toBe(true)
    expect(authorize(s.flaggedUser, { a: 'jobs.money' }).ok).toBe(false)
  })
  it('only management roles see amounts', () => {
    for (const w of MGMT) {
      expect(authorize(u[w], { a: 'jobs.read' }).ok, w).toBe(true)
      expect(authorize(u[w], { a: 'jobs.money' }).ok, w).toBe(true)
    }
    expect(authorize({ ...u.employeeB, isAdmin: true, canManageJobs: true }, { a: 'jobs.money' }).ok).toBe(false)
  })
  it('an inactive user is refused even with the flag', () => {
    expect(authorize({ ...u.inactive, canManageJobs: true }, { a: 'jobs.read' }).ok).toBe(false)
  })
})

describe('jobs: list and amount privacy', () => {
  it('an employee without the flag gets the list without amounts and cannot add (403)', async () => {
    const s = setup()
    const p = await jobs.listJobs(s.ctx('employeeB'))
    expect(p.money).toBe(false)
    expect(p.canWrite).toBe(false)
    await rejects(jobs.saveJob(s.ctx('employeeB'), { job: job() }), 403)
  })

  it('a flagged employee sees jobs but no amount or not-billable fields', async () => {
    const s = withFlagged()
    const saved = await jobs.saveJob(s.ctx('manager'), { job: job(), money: { amount: 45000, notBillable: false } })
    expect(saved.ok).toBe(true)
    await jobs.saveJob(s.ctx('manager'), { job: job({ title: 'İç iş' }), money: { amount: null, notBillable: true } })
    const page = await jobs.listJobs(s.flagged(), { from: '2026-10-01', to: '2026-10-31' })
    expect(page.money).toBe(false)
    expect(page.jobs).toHaveLength(2)
    const wire = JSON.stringify(page)
    expect(wire).not.toMatch(/amount|share|percent|billable|45000|4500000/i)
    expect(Object.keys(page.jobs[0]).sort()).toEqual(['client', 'createdAt', 'end', 'id', 'kind', 'note', 'start', 'status', 'title', 'unit', 'updatedAt', 'version'])
    expect(wire).not.toMatch(/memberIds|people/)
  })

  it('management sees the amount and the not-billable flag', async () => {
    const s = setup()
    await jobs.saveJob(s.ctx('approver'), { job: job(), money: { amount: 45000, notBillable: false } })
    await jobs.saveJob(s.ctx('approver'), { job: job({ title: 'İç iş', end: '2026-10-14' }), money: { amount: null, notBillable: true } })
    for (const w of ['manager', 'manager2', 'approver', 'owner'] as const) {
      const page = await jobs.listJobs(s.ctx(w), { from: '2026-10-01', to: '2026-10-31' })
      expect(page.money, w).toBe(true)
      if (!page.money) continue
      expect(page.jobs.map((j) => [j.title, j.amount, j.notBillable])).toEqual([
        ['Spring Campaign Video', 45000, false],
        ['İç iş', null, true],
      ])
    }
  })

  it('period: by end date; without one only in the month it was entered; opens on the current month', async () => {
    const s = setup()
    const c = s.ctx('manager')
    await jobs.saveJob(c, { job: job({ title: 'Ekim işi', end: '2026-10-10', start: '2026-10-01' }) })
    await jobs.saveJob(c, { job: job({ title: 'Eylül işi', end: '2026-09-10', start: '2026-09-01' }) })
    legacyJob(s, { id: 'L1', title: 'Süren', status: 'active' })
    const tarihsiz = await jobs.saveJob(c, { job: job({ title: 'Ekim tarihsiz', end: '' }) })
    if (!tarihsiz.ok) throw new Error('kayıt')
    s.db.raw.prepare(`UPDATE jobs SET created_at = '2026-09-15T09:00:00.000Z' WHERE title = 'Süren'`).run()
    s.db.raw.prepare(`UPDATE jobs SET created_at = '2026-09-30T22:30:00.000Z' WHERE id = ?`).run(tarihsiz.id)
    const now = await jobs.listJobs(c)
    expect(now.period).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(now.jobs.map((j) => j.title).sort()).toEqual(['Ekim işi', 'Ekim tarihsiz'])
    const sep = await jobs.listJobs(c, { from: '2026-09-01', to: '2026-09-30' })
    expect(sep.jobs.map((j) => j.title).sort()).toEqual(['Eylül işi', 'Süren'])
    await rejects(jobs.listJobs(c, { from: '2026-10-31', to: '2026-10-01' }), 400)
  })
})

describe('jobs: add and edit', () => {
  it('a flagged employee adds and edits jobs; sending an amount is refused', async () => {
    const s = withFlagged()
    const r = await jobs.saveJob(s.flagged(), { job: job() })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const e = await jobs.saveJob(s.flagged(), { job: job({ id: r.id, version: 1, title: 'Yeni ad' }) })
    expect(e).toEqual({ ok: true, id: r.id })
    await rejects(jobs.saveJob(s.flagged(), { job: job(), money: { amount: 1000, notBillable: false } }), 403)
    await rejects(jobs.saveJob(s.flagged(), { job: job(), money: { amount: null, notBillable: true } }), 403)
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM jobs`).get()).toEqual({ n: 1 })
    expect(s.db.raw.prepare(`SELECT action FROM audit_log WHERE entity_id = ? ORDER BY at`).all(r.id)).toEqual([{ action: 'job.create' }, { action: 'job.update' }])
  })

  it('a new job is always done; status and people sent by the client are ignored', async () => {
    const s = setup()
    const r = await jobs.saveJob(s.ctx('manager'), { job: job({ status: 'active', memberIds: [s.users.employeeA.id] }) })
    if (!r.ok) throw new Error(r.error)
    expect(s.db.raw.prepare(`SELECT status, not_billable FROM jobs WHERE id = ?`).get(r.id)).toEqual({ status: 'done', not_billable: 0 })
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM job_members`).get()).toEqual({ n: 0 })
  })

  it('editing an older job keeps its status, members and shares', async () => {
    const s = withFlagged()
    const a = s.users.employeeA.id
    const id = legacyJob(s, { id: 'L2', title: 'Süren', status: 'active', members: [{ userId: a, bp: 6000 }, { userId: s.users.employeeB.id, bp: 4000 }] })
    expect((await jobs.saveJob(s.flagged(), { job: job({ id, version: 1, title: 'Süren (ad düzeldi)', end: '' }) })).ok).toBe(true)
    expect((await jobs.saveJob(s.ctx('manager'), { job: job({ id, version: 2, title: 'Süren 2', end: '' }), money: { amount: 10, notBillable: false } })).ok).toBe(true)
    expect(s.db.raw.prepare(`SELECT title, status, amount_minor FROM jobs WHERE id = ?`).get(id)).toEqual({ title: 'Süren 2', status: 'active', amount_minor: 1000 })
    expect(s.db.raw.prepare(`SELECT user_id, share_bp, removed_at FROM job_members WHERE job_id = ? ORDER BY share_bp DESC`).all(id)).toEqual([
      { user_id: a, share_bp: 6000, removed_at: null },
      { user_id: s.users.employeeB.id, share_bp: 4000, removed_at: null },
    ])
  })

  it('marking not billable clears the amount; unmarking lets it be entered again', async () => {
    const s = setup()
    const c = s.ctx('manager')
    const r = await jobs.saveJob(c, { job: job(), money: { amount: 5000, notBillable: false } })
    if (!r.ok) throw new Error(r.error)
    expect((await jobs.saveJob(c, { job: job({ id: r.id, version: 1 }), money: { amount: 5000, notBillable: true } })).ok).toBe(true)
    expect(s.db.raw.prepare(`SELECT amount_minor, not_billable FROM jobs WHERE id = ?`).get(r.id)).toEqual({ amount_minor: null, not_billable: 1 })
    expect((await jobs.saveJob(c, { job: job({ id: r.id, version: 2 }), money: { amount: 700, notBillable: false } })).ok).toBe(true)
    expect(s.db.raw.prepare(`SELECT amount_minor, not_billable FROM jobs WHERE id = ?`).get(r.id)).toEqual({ amount_minor: 70000, not_billable: 0 })
    const audits = s.db.raw.prepare(`SELECT after_json FROM audit_log WHERE entity_id = ? ORDER BY at`).all(r.id) as { after_json: string }[]
    expect(JSON.parse(audits[1].after_json)).toMatchObject({ amountMinor: null, notBillable: true })
  })

  it('a flagged employee editing without money keeps the amount and flag intact', async () => {
    const s = withFlagged()
    const r = await jobs.saveJob(s.ctx('manager'), { job: job(), money: { amount: 900, notBillable: false } })
    const q = await jobs.saveJob(s.ctx('manager'), { job: job({ title: 'İç' }), money: { amount: null, notBillable: true } })
    if (!r.ok || !q.ok) throw new Error('kayıt')
    expect((await jobs.saveJob(s.flagged(), { job: job({ id: r.id, version: 1, title: 'Yeni' }) })).ok).toBe(true)
    expect((await jobs.saveJob(s.flagged(), { job: job({ id: q.id, version: 1, title: 'İç 2' }) })).ok).toBe(true)
    const p = await jobs.listJobs(s.ctx('manager'), { from: '2026-10-01', to: '2026-10-31' })
    if (!p.money) throw new Error('yönetici')
    expect(p.jobs.map((j) => [j.title, j.amount, j.notBillable]).sort()).toEqual([
      ['Yeni', 900, false],
      ['İç 2', null, true],
    ])
  })

  it('an edit based on an old version is refused', async () => {
    const s = setup()
    const c = s.ctx('manager')
    const r = await jobs.saveJob(c, { job: job() })
    if (!r.ok) throw new Error(r.error)
    expect((await jobs.saveJob(c, { job: job({ id: r.id, version: 1, title: 'A' }) })).ok).toBe(true)
    const stale = await jobs.saveJob(s.ctx('owner'), { job: job({ id: r.id, version: 1, title: 'B' }) })
    expect(stale.ok).toBe(false)
    expect(s.db.raw.prepare(`SELECT title, version FROM jobs WHERE id = ?`).get(r.id)).toEqual({ title: 'A', version: 2 })
  })

  it('rejects an unknown type and an end before the start', async () => {
    const s = setup()
    expect((await jobs.saveJob(s.ctx('manager'), { job: job({ kind: 'film' }) })).ok).toBe(false)
    expect(await jobs.saveJob(s.ctx('manager'), { job: job({ start: '2026-10-20', end: '2026-10-01' }) })).toMatchObject({ ok: false, fieldErrors: { end: 'Bitiş başlangıçtan önce olamaz' } })
  })
})

describe('jobs: archive', () => {
  it('flagged employees and managers archive; the record stays, leaves the list and is audited', async () => {
    const s = withFlagged()
    const r = await jobs.saveJob(s.ctx('manager'), { job: job() })
    if (!r.ok) throw new Error(r.error)
    expect(await jobs.archiveJob(s.flagged(), { id: r.id, version: 1 })).toEqual({ ok: true })
    expect(s.db.raw.prepare(`SELECT archived_at IS NOT NULL AS a, archived_by, version FROM jobs WHERE id = ?`).get(r.id)).toEqual({ a: 1, archived_by: s.flaggedUser.id, version: 2 })
    expect((await jobs.listJobs(s.ctx('manager'), { from: '2026-10-01', to: '2026-10-31' })).jobs).toHaveLength(0)
    expect((await jobs.listJobs(s.ctx('manager'))).clients).toEqual([])
    expect(s.db.raw.prepare(`SELECT action FROM audit_log WHERE entity_id = ? ORDER BY at`).all(r.id)).toEqual([{ action: 'job.create' }, { action: 'job.archive' }])
    expect(await jobs.archiveJob(s.ctx('manager'), { id: r.id, version: 2 })).toMatchObject({ ok: false })
    expect(await jobs.saveJob(s.ctx('manager'), { job: job({ id: r.id, version: 2 }) })).toMatchObject({ ok: false })
  })
  it('an employee without the flag cannot archive (403) and an old version is refused', async () => {
    const s = setup()
    const r = await jobs.saveJob(s.ctx('manager'), { job: job() })
    if (!r.ok) throw new Error(r.error)
    await rejects(jobs.archiveJob(s.ctx('employeeB'), { id: r.id, version: 1 }), 403)
    expect((await jobs.saveJob(s.ctx('manager'), { job: job({ id: r.id, version: 1, title: 'A' }) })).ok).toBe(true)
    expect(await jobs.archiveJob(s.ctx('owner'), { id: r.id, version: 1 })).toMatchObject({ ok: false })
    expect(s.db.raw.prepare(`SELECT archived_at FROM jobs WHERE id = ?`).get(r.id)).toEqual({ archived_at: null })
  })
})

describe('jobs: fields for the detail panel', () => {
  it('notes and timestamps reach employees without amounts; unflagged employees cannot write', async () => {
    const s = setup()
    const r = await jobs.saveJob(s.ctx('manager'), { job: job({ note: 'Seslendirme dahil' }), money: { amount: 100, notBillable: false } })
    if (!r.ok) throw new Error(r.error)
    const p = await jobs.listJobs(s.ctx('employeeB'), { from: '2026-10-01', to: '2026-10-31' })
    expect(p.canWrite).toBe(false)
    expect(p.jobs[0].note).toBe('Seslendirme dahil')
    expect(p.jobs[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.stringify(p)).not.toMatch(/amount|share|percent|billable/i)
  })
})

describe('jobs: database guards', () => {
  it('jobs and job members cannot be deleted', async () => {
    const s = setup()
    legacyJob(s, { id: 'L3', title: 'Eski', status: 'done', end: '2026-10-01', members: [{ userId: s.users.employeeA.id, bp: null }] })
    expect(() => s.db.raw.exec(`DELETE FROM jobs`)).toThrow(/no delete/)
    expect(() => s.db.raw.exec(`DELETE FROM job_members`)).toThrow(/no delete/)
    expect(s.db.raw.prepare(`SELECT count(*) AS n FROM jobs`).get()).toEqual({ n: 1 })
  })
  it('rejects unknown job types, bad statuses, negative amounts, out-of-range shares and flags', () => {
    const s = setup()
    const by = s.users.manager.id
    const ins = (kind: string, status: string, amount: number | null) =>
      s.db.raw.prepare(`INSERT INTO jobs (id, client, title, kind, status, amount_minor, created_by, updated_by) VALUES (?, 'X', 'Y', ?, ?, ?, ?, ?)`).run('J'.padEnd(26, '0'), kind, status, amount, by, by)
    expect(() => ins('film', 'done', null)).toThrow(/FOREIGN KEY/)
    expect(() => ins('project', 'paused', null)).toThrow(/CHECK/)
    expect(() => ins('project', 'done', -1)).toThrow(/CHECK/)
    ins('project', 'done', 0)
    expect(() => s.db.raw.prepare(`INSERT INTO job_members (job_id, user_id, share_bp, added_by) VALUES (?, ?, 10001, ?)`).run('J'.padEnd(26, '0'), by, by)).toThrow(/CHECK/)
    expect(() => s.db.raw.prepare(`UPDATE users SET can_manage_jobs = 2 WHERE id = ?`).run(by)).toThrow(/CHECK/)
    expect(() => s.db.raw.prepare(`UPDATE jobs SET not_billable = 2`).run()).toThrow(/CHECK/)
  })
})

describe('jobs: summary by client', () => {
  const sum = (c: Ctx, p = { from: '2026-10-01', to: '2026-10-31' }) => jobs.jobsSummary(c, p)

  it('employees, flagged employees, admin-only and inactive users get 403; management gets the summary', async () => {
    const s = withFlagged()
    await rejects(sum(s.ctx('employeeB')), 403)
    await rejects(sum(s.flagged()), 403)
    await rejects(jobs.jobsSummary({ ...s.ctx('employeeB'), user: { ...s.users.employeeB, isAdmin: true, canManageJobs: true } }, {}), 403)
    for (const w of ['manager', 'manager2', 'approver', 'owner'] as const) expect((await sum(s.ctx(w))).jobs, w).toBe(0)
  })

  it('no people or shares in the response; totals per client', async () => {
    const s = setup()
    const c = s.ctx('manager')
    legacyJob(s, { id: 'L4', title: 'Eski paylı', status: 'done', end: '2026-10-05', members: [{ userId: s.users.employeeA.id, bp: 10000 }] })
    s.db.raw.prepare(`UPDATE jobs SET amount_minor = 10000`).run()
    await jobs.saveJob(c, { job: job() , money: { amount: 100, notBillable: false } })
    const r = await sum(c)
    expect(JSON.stringify(r)).not.toMatch(/people|share|noTeam/)
    expect(r.firms).toEqual([{ client: 'Örnek Ltd.', jobs: 2, amount: 200, missing: 0, notBillable: 0 }])
  })

  it('jobs without an amount are counted but not summed; not-billable jobs are counted separately', async () => {
    const s = setup()
    const c = s.ctx('manager')
    await jobs.saveJob(c, { job: job({ title: 'Tutarlı' }), money: { amount: 1000, notBillable: false } })
    await jobs.saveJob(c, { job: job({ title: 'Tutarsız' }) })
    await jobs.saveJob(c, { job: job({ title: 'İç iş' }), money: { amount: null, notBillable: true } })
    await jobs.saveJob(c, { job: job({ title: 'Başka firma', client: 'Deneme A.Ş.' }), money: { amount: null, notBillable: true } })
    const r = await sum(c)
    expect(r).toMatchObject({ jobs: 4, amount: 1000, missing: 1, notBillable: 2 })
    expect(r.firms).toEqual([
      { client: 'Örnek Ltd.', jobs: 3, amount: 1000, missing: 1, notBillable: 1 },
      { client: 'Deneme A.Ş.', jobs: 1, amount: 0, missing: 0, notBillable: 1 },
    ])
  })

  it('period follows the list rule; ongoing older jobs count; undated jobs are counted separately', async () => {
    const s = setup()
    const c = s.ctx('manager')
    const m = { amount: 100, notBillable: false }
    await jobs.saveJob(c, { job: job({ title: 'Ekim', end: '2026-10-31' }), money: m })
    await jobs.saveJob(c, { job: job({ title: 'Eylül', start: '2026-09-01', end: '2026-09-30' }), money: m })
    legacyJob(s, { id: 'L5', title: 'Süren', status: 'active', end: '2026-10-20' })
    await jobs.saveJob(c, { job: job({ title: 'Tarihsiz', end: '' }), money: m })
    await jobs.saveJob(c, { job: job({ title: 'Eski tarihsiz', end: '' }), money: m })
    s.db.raw.prepare(`UPDATE jobs SET created_at = '2026-10-05T09:00:00.000Z' WHERE title = 'Tarihsiz'`).run()
    s.db.raw.prepare(`UPDATE jobs SET created_at = '2026-08-05T09:00:00.000Z' WHERE title = 'Eski tarihsiz'`).run()
    expect(await sum(c)).toMatchObject({ jobs: 3, amount: 200, missing: 1, undated: 1 })
    const list = await jobs.listJobs(c)
    expect(list.jobs.length).toBe(3)
    expect(await sum(c, { from: '2026-09-01', to: '2026-10-31' })).toMatchObject({ jobs: 4, amount: 300 })
    expect(await jobs.jobsSummary(c, {})).toMatchObject({ period: { from: '2026-10-01', to: '2026-10-31' }, jobs: 3 })
    await rejects(sum(c, { from: '2026-10-31', to: '2026-10-01' }), 400)
  })

  it('archived jobs are excluded', async () => {
    const s = setup()
    const c = s.ctx('manager')
    const x = await jobs.saveJob(c, { job: job({ title: 'Arşivlenecek' }), money: { amount: 900, notBillable: false } })
    await jobs.saveJob(c, { job: job({ title: 'Kalan' }), money: { amount: 100, notBillable: false } })
    const page = await jobs.listJobs(c, { from: '2026-10-01', to: '2026-10-31' })
    const target = page.jobs.find((j) => j.id === (x as { id: string }).id)!
    await jobs.archiveJob(c, { id: target.id, version: target.version })
    expect(await sum(c)).toMatchObject({ jobs: 1, amount: 100 })
  })

  it('splitMinor always adds up to the amount', () => {
    expect(splitMinor(10000, [null, null, null])).toEqual([3334, 3333, 3333])
    expect(splitMinor(10000, [3333, 3333, 3334]).reduce((t, x) => t + x, 0)).toBe(10000)
    expect(splitMinor(7, [5000, 5000])).toEqual([4, 3])
    expect(splitMinor(5, [])).toEqual([])
    expect(splitMinor(0, [null, null])).toEqual([0, 0])
  })
})

describe('job types', () => {
  it('ships the default set with translated labels', async () => {
    const s = setup()
    const types = await jobTypes.listJobTypes(s.db)
    expect(types.map((x) => x.id)).toEqual(['project', 'consulting', 'design', 'development', 'marketing', 'support', 'other'])
    expect(jobTypeLabel(types[0])).toBe('Proje')
    expect(types.every((x) => !x.archived)).toBe(true)
  })
  it('lets only admins add, rename, archive and restore types', async () => {
    const s = setup()
    await rejects(jobTypes.saveJobType(s.ctx('owner'), { label: 'Workshop' }), 403)
    expect(await jobTypes.saveJobType(s.ctx('manager'), { label: '  ' })).toMatchObject({ ok: false })
    const added = await jobTypes.saveJobType(s.ctx('manager'), { label: 'Workshop' })
    if (!added.ok) throw new Error(added.error)
    const custom = added.types.find((x) => x.label === 'Workshop')!
    expect(custom).toMatchObject({ key: null, archived: false })
    const renamed = await jobTypes.saveJobType(s.ctx('manager'), { id: custom.id, label: 'Training' })
    expect(renamed.ok && renamed.types.find((x) => x.id === custom.id)?.label).toBe('Training')
    const archived = await jobTypes.saveJobType(s.ctx('manager'), { id: 'design', archived: true })
    expect(archived.ok && archived.types.find((x) => x.id === 'design')?.archived).toBe(true)
    const restored = await jobTypes.saveJobType(s.ctx('manager'), { id: 'design', archived: false })
    expect(restored.ok && restored.types.find((x) => x.id === 'design')?.archived).toBe(false)
    expect(s.db.raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'jobType.%'`).get()).toEqual({ n: 4 })
    expect(() => s.db.raw.exec(`DELETE FROM job_types`)).toThrow(/no delete/)
  })
  it('keeps archived types on existing jobs but refuses them for new jobs', async () => {
    const s = setup()
    const created = await jobs.saveJob(s.ctx('manager'), { job: job({ kind: 'support' }) })
    if (!created.ok) throw new Error(created.error)
    await jobTypes.saveJobType(s.ctx('manager'), { id: 'support', archived: true })
    expect(await jobs.saveJob(s.ctx('manager'), { job: job({ kind: 'support' }) })).toMatchObject({ ok: false })
    expect(await jobs.saveJob(s.ctx('manager'), { job: job({ kind: 'unknown' }) })).toMatchObject({ ok: false })
    const page = await jobs.listJobs(s.ctx('manager'), { from: '2026-01-01', to: '2026-12-31' })
    expect(page.jobs.find((j) => j.id === created.id)?.kind).toBe('support')
    expect(page.types.find((x) => x.id === 'support')?.archived).toBe(true)
    const version = (s.db.raw.prepare(`SELECT version FROM jobs WHERE id = ?`).get(created.id) as { version: number }).version
    expect(await jobs.saveJob(s.ctx('manager'), { job: job({ id: created.id, version, kind: 'support', title: 'Renamed job' }) })).toMatchObject({ ok: true })
  })
})
