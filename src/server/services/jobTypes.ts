import { t } from '#/i18n'
import { DEFAULT_JOB_TYPE_KEYS, jobTypeSchema, type JobType, type JobTypeKey } from '#/lib/jobs'
import { must } from '../auth/authorize'
import type { Ctx } from '../ctx'
import { audit, nowIso, ulid, type Db } from '../db/d1'
import { commit, fail, type Fail } from '../submit'

interface JobTypeRow {
  id: string
  key: string | null
  label: string | null
  archived_at: string | null
}

const isKey = (v: string | null): v is JobTypeKey => !!v && (DEFAULT_JOB_TYPE_KEYS as readonly string[]).includes(v)

const toType = (r: JobTypeRow): JobType => ({ id: r.id, key: isKey(r.key) ? r.key : null, label: r.label, archived: !!r.archived_at })

export async function listJobTypes(db: Db): Promise<JobType[]> {
  return (await db.prepare(`SELECT id, key, label, archived_at FROM job_types ORDER BY archived_at IS NOT NULL, sort, created_at`).all<JobTypeRow>()).results.map(toType)
}

export async function jobTypeUsable(db: Db, id: string, current?: string | null): Promise<boolean> {
  if (current && current === id) return !!(await db.prepare(`SELECT 1 AS x FROM job_types WHERE id = ?`).bind(id).first<{ x: number }>())
  return !!(await db.prepare(`SELECT 1 AS x FROM job_types WHERE id = ? AND archived_at IS NULL`).bind(id).first<{ x: number }>())
}

export async function saveJobType(ctx: Ctx, input: unknown): Promise<{ ok: true; types: JobType[] } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'user.manage' })
  const p = jobTypeSchema.safeParse(input)
  if (!p.success) return fail(p.error.issues[0]?.message ?? t('server.invalidRecord'), 'label')
  const v = p.data
  const now = nowIso()
  if (!v.id) {
    if (!v.label) return fail(t('settings.jobTypes.labelRequired'), 'label')
    const id = ulid()
    const sort = ((await db.prepare(`SELECT MAX(sort) AS m FROM job_types`).first<{ m: number | null }>())?.m ?? 0) + 10
    const err = await commit(
      ctx,
      [
        db.prepare(`INSERT INTO job_types (id, label, sort, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, v.label, sort, now, user.id, now, user.id),
        audit(db, { actorId: user.id, action: 'jobType.create', entityType: 'settings', entityId: id, after: { label: v.label } }),
      ],
      [],
    )
    return err ?? { ok: true, types: await listJobTypes(db) }
  }
  const row = await db.prepare(`SELECT id, key, label, archived_at FROM job_types WHERE id = ?`).bind(v.id).first<JobTypeRow>()
  if (!row) return fail(t('settings.jobTypes.notFound'))
  const label = row.key ? row.label : (v.label ?? row.label)
  const err = await commit(
    ctx,
    [
      db
        .prepare(`UPDATE job_types SET label = ?, archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
        .bind(label, v.archived ? (row.archived_at ?? now) : null, now, user.id, v.id),
      audit(db, { actorId: user.id, action: 'jobType.update', entityType: 'settings', entityId: v.id, before: { label: row.label, archived: !!row.archived_at }, after: { label, archived: v.archived } }),
    ],
    [],
  )
  return err ?? { ok: true, types: await listJobTypes(db) }
}
