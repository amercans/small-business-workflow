import type { Job, JobsPage, JobsSummary, PricedJob } from '#/data/jobs'
import { t } from '#/i18n'
import { jobMoneySchema, jobPeriodSchema, jobSchema, type JobKind, type JobStatus } from '#/lib/jobs'
import { round2 } from '#/lib/money'
import { z } from 'zod'
import { authorize, HttpError, must } from '../auth/authorize'
import type { Ctx } from '../ctx'
import { assertion, audit, nowIso, toMinor, ulid, type Stmt } from '../db/d1'
import { commit, fail, type Fail } from '../submit'
import { linkedInvoices } from './invoiceLinks'
import { todayISO } from '../time'
import { jobTypeUsable, listJobTypes } from './jobTypes'

function parsed<T extends z.ZodType>(schema: T, input: unknown): { ok: true; data: z.output<T> } | { ok: false; res: Fail } {
  const r = schema.safeParse(input)
  if (r.success) return { ok: true, data: r.data }
  const fe: Record<string, string> = {}
  for (const i of r.error.issues) fe[i.path.join('.')] ??= i.message
  return { ok: false, res: { ok: false, error: Object.values(fe)[0] ?? t('server.invalidRecord'), fieldErrors: fe } }
}

export function monthPeriod(day: string): { from: string; to: string } {
  const [y, m] = day.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

interface JobRow {
  id: string
  client: string
  title: string
  unit: string | null
  kind: JobKind
  status: JobStatus
  start_date: string | null
  end_date: string | null
  note: string | null
  created_at: string
  updated_at: string
  version: number
}

const PERIOD_DAY = `COALESCE(end_date, date(created_at, '+3 hours'))`
const IN_PERIOD = `archived_at IS NULL AND ${PERIOD_DAY} BETWEEN ? AND ?`
const BASE_COLS = 'id, client, title, unit, kind, status, start_date, end_date, note, created_at, updated_at, version'

const toJob = (r: JobRow): Job => ({
  id: r.id,
  client: r.client,
  title: r.title,
  unit: r.unit,
  kind: r.kind,
  status: r.status,
  start: r.start_date,
  end: r.end_date,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  version: r.version,
})

export async function listJobs(ctx: Ctx, input: unknown = {}): Promise<JobsPage> {
  const { db, user } = ctx
  must(user, { a: 'jobs.read' })
  const raw = (input ?? {}) as { from?: unknown; to?: unknown }
  const p = raw.from || raw.to ? jobPeriodSchema.safeParse(raw) : null
  if (p && !p.success) throw new HttpError(400, t('server.invalidPeriod'))
  const period = p?.success ? p.data : monthPeriod(ctx.today ?? todayISO())
  const money = authorize(user, { a: 'jobs.money' }).ok
  const canWrite = authorize(user, { a: 'jobs.write' }).ok

  const order = `ORDER BY end_date IS NULL, end_date DESC, start_date IS NULL, start_date DESC, created_at DESC`
  const [rows, clients, types] = await Promise.all([
    db.prepare(`SELECT ${BASE_COLS}${money ? ', amount_minor, not_billable' : ''} FROM jobs WHERE ${IN_PERIOD} ${order}`).bind(period.from, period.to).all<JobRow & { amount_minor?: number | null; not_billable?: number }>(),
    db.prepare(`SELECT DISTINCT client FROM jobs WHERE archived_at IS NULL`).all<{ client: string }>(),
    listJobTypes(db),
  ])
  const links = await linkedInvoices(ctx, 'job')
  const withLinks = <T extends Job>(j: T): T => (links ? { ...j, invoices: links.get(j.id) ?? [], hasInvoice: links.has(j.id) } : j)
  const base = { period, canWrite, types, clients: clients.results.map((c) => c.client).sort((a, b) => a.localeCompare(b, 'tr')) }
  if (!money) return { ...base, money: false, jobs: rows.results.map((r) => withLinks(toJob(r))) }
  return {
    ...base,
    money: true,
    jobs: rows.results.map((r): PricedJob => withLinks({ ...toJob(r), amount: r.amount_minor == null ? null : r.amount_minor / 100, notBillable: r.not_billable === 1 })),
  }
}

export async function jobsSummary(ctx: Ctx, input: unknown = {}): Promise<JobsSummary> {
  const { db, user } = ctx
  must(user, { a: 'jobs.money' })
  const raw = (input ?? {}) as { from?: unknown; to?: unknown }
  const p = raw.from || raw.to ? jobPeriodSchema.safeParse(raw) : null
  if (p && !p.success) throw new HttpError(400, t('server.invalidPeriod'))
  const period = p?.success ? p.data : monthPeriod(ctx.today ?? todayISO())
  const rows = await db
    .prepare(`SELECT client, amount_minor, not_billable, end_date FROM jobs WHERE ${IN_PERIOD}`)
    .bind(period.from, period.to)
    .all<{ client: string; amount_minor: number | null; not_billable: number; end_date: string | null }>()

  const firms = new Map<string, { client: string; jobs: number; minor: number; missing: number; notBillable: number }>()
  let totalMinor = 0
  let missing = 0
  let notBillable = 0
  for (const r of rows.results) {
    const f = firms.get(r.client) ?? { client: r.client, jobs: 0, minor: 0, missing: 0, notBillable: 0 }
    f.jobs++
    if (r.not_billable === 1) {
      f.notBillable++
      notBillable++
    } else if (r.amount_minor == null) {
      f.missing++
      missing++
    } else {
      f.minor += r.amount_minor
      totalMinor += r.amount_minor
    }
    firms.set(r.client, f)
  }
  return {
    period,
    jobs: rows.results.length,
    amount: totalMinor / 100,
    missing,
    notBillable,
    undated: rows.results.filter((r) => r.end_date == null).length,
    firms: [...firms.values()]
      .map((f) => ({ client: f.client, jobs: f.jobs, amount: f.minor / 100, missing: f.missing, notBillable: f.notBillable }))
      .sort((a, b) => b.amount - a.amount || a.client.localeCompare(b.client, 'tr')),
  }
}

const saveSchema = z.object({ job: z.unknown(), money: z.unknown().optional() })

export async function saveJob(ctx: Ctx, input: unknown): Promise<{ ok: true; id: string } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'jobs.write' })
  const outer = saveSchema.safeParse(input)
  if (!outer.success) return fail(t('server.invalidRecord'))
  const sentMoney = outer.data.money !== undefined
  if (sentMoney) must(user, { a: 'jobs.money' })
  const pj = parsed(jobSchema, outer.data.job)
  if (!pj.ok) return pj.res
  const v = pj.data
  const pm = sentMoney ? parsed(jobMoneySchema, outer.data.money) : null
  if (pm && !pm.ok) return pm.res
  const m = pm?.ok ? pm.data : null

  const now = nowIso()
  const id = v.id ?? ulid()
  const before = v.id
    ? await db.prepare(`SELECT client, title, unit, kind, status, start_date, end_date, note, amount_minor, not_billable, version FROM jobs WHERE id = ? AND archived_at IS NULL`).bind(v.id).first<Record<string, unknown>>()
    : null
  if (v.id && !before) return fail(t('server.jobs.notFound'))
  if (!(await jobTypeUsable(db, v.kind, before ? (before.kind as string) : null))) return fail(t('schemas.job.kindRequired'), 'job.kind')
  const notBillable = m ? (m.notBillable ? 1 : 0) : undefined
  const amount = m ? (m.notBillable || m.amount == null ? null : toMinor(round2(m.amount))) : undefined

  const fields = [v.client.replace(/\s+/g, ' '), v.title.replace(/\s+/g, ' '), v.unit || null, v.kind, v.start || null, v.end || null, v.note || null]
  const stmts: Stmt[] = []
  if (v.id) {
    stmts.push(
      assertion(db, 'job_stale', `NOT EXISTS (SELECT 1 FROM jobs WHERE id = ? AND version = ? AND archived_at IS NULL)`, id, v.version),
      db
        .prepare(
          `UPDATE jobs SET client = ?, title = ?, unit = ?, kind = ?, start_date = ?, end_date = ?, note = ?,
           ${m ? 'amount_minor = ?, not_billable = ?,' : ''} updated_at = ?, updated_by = ?, version = version + 1
           WHERE id = ? AND version = ? AND archived_at IS NULL`,
        )
        .bind(...fields, ...(m ? [amount, notBillable] : []), now, user.id, id, v.version),
    )
  } else {
    stmts.push(
      db
        .prepare(
          `INSERT INTO jobs (id, client, title, unit, kind, status, start_date, end_date, note, amount_minor, not_billable, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, ...fields, amount ?? null, notBillable ?? 0, now, user.id, now, user.id),
    )
  }
  stmts.push(
    audit(db, {
      actorId: user.id, action: v.id ? 'job.update' : 'job.create', entityType: 'invoice', entityId: id,
      before: before ?? undefined,
      after: {
        client: fields[0], title: fields[1], unit: fields[2], kind: v.kind, start: fields[4], end: fields[5],
        ...(m ? { amountMinor: amount, notBillable: notBillable === 1 } : {}),
      },
    }),
  )

  const err = await commit(ctx, stmts, [], {
    job_stale: fail(t('server.jobs.stale')),
  })
  return err ?? { ok: true, id }
}

const archiveSchema = z.object({ id: z.string().length(26), version: z.number().int().min(1) })

export async function archiveJob(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'jobs.write' })
  const p = archiveSchema.safeParse(input)
  if (!p.success) return fail(t('server.invalidRecord'))
  const { id, version } = p.data
  const before = await db.prepare(`SELECT client, title, status, version FROM jobs WHERE id = ? AND archived_at IS NULL`).bind(id).first<Record<string, unknown>>()
  if (!before) return fail(t('server.jobs.notFound'))
  const now = nowIso()
  const err = await commit(
    ctx,
    [
      assertion(db, 'job_stale', `NOT EXISTS (SELECT 1 FROM jobs WHERE id = ? AND version = ? AND archived_at IS NULL)`, id, version),
      db.prepare(`UPDATE jobs SET archived_at = ?, archived_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ? AND archived_at IS NULL`).bind(now, user.id, now, user.id, id, version),
      audit(db, { actorId: user.id, action: 'job.archive', entityType: 'invoice', entityId: id, before, after: { archived: true } }),
    ],
    [],
    { job_stale: fail(t('server.jobs.stale')) },
  )
  return err ?? { ok: true }
}
