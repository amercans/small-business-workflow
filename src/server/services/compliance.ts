import { z } from 'zod'
import { t, type MessageKey } from '#/i18n'
import { DOCS, LEGAL_VERSION, type PolicyDoc } from '#/lib/legal'
import { formatRange } from '#/lib/leave'
import { must } from '../auth/authorize'
import type { Ctx } from '../ctx'
import { assertion, audit, nowIso, ulid, type Db } from '../db/d1'
import { leaveBalance } from '../db/requests'
import { commit, fail, type Fail } from '../submit'
import { todayISO } from '../time'

const today = (ctx: Ctx) => ctx.today ?? todayISO()

export async function pendingPolicies(db: Db, userId: string): Promise<PolicyDoc[]> {
  const done = (await db.prepare(`SELECT doc FROM policy_acceptances WHERE user_id = ? AND version = ?`).bind(userId, LEGAL_VERSION).all<{ doc: PolicyDoc }>()).results
  return (Object.keys(DOCS) as PolicyDoc[]).filter((d) => !done.some((x) => x.doc === d))
}

export async function gateError(ctx: Ctx): Promise<Fail | null> {
  const { db, user } = ctx
  if ((await pendingPolicies(db, user.id)).length > 0) return fail(t('compliance.policiesPending'))
  if ((await pendingAssets(db, user.id)).length > 0) return fail(t('compliance.assetsPending'))
  return null
}

const acceptSchema = z.object({ version: z.string(), docs: z.array(z.enum(['policy', 'kvkk'])).min(1).max(2) })

export async function acceptPolicies(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const p = acceptSchema.safeParse(input)
  if (!p.success) return fail(t('compliance.invalidRequest'))
  if (p.data.version !== LEGAL_VERSION) return fail(t('compliance.textUpdated'))
  const { db, user } = ctx
  const err = await commit(
    ctx,
    [
      ...p.data.docs.map((doc) =>
        db
          .prepare(`INSERT OR IGNORE INTO policy_acceptances (id, user_id, doc, version, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(ulid(), user.id, doc, LEGAL_VERSION, ctx.client?.ip ?? null, ctx.client?.ua ?? null),
      ),
      audit(db, { actorId: user.id, action: 'policy.accept', entityType: 'user', entityId: user.id, after: { docs: p.data.docs, version: LEGAL_VERSION } }),
    ],
    [],
  )
  return err ?? { ok: true }
}

export async function acknowledgeAssignment(ctx: Ctx, assignmentId: string): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  const err = await commit(
    ctx,
    [
      db
        .prepare(`UPDATE assignments SET acknowledged_at = ?, acknowledged_ip = ? WHERE id = ? AND user_id = ? AND returned_on IS NULL AND acknowledged_at IS NULL AND disputed_at IS NULL AND asset_id NOT IN (SELECT id FROM assets WHERE archived_at IS NOT NULL)`)
        .bind(nowIso(), ctx.client?.ip ?? null, assignmentId, user.id),
      assertion(db, 'not_found', 'changes() = 0'),
      audit(db, { actorId: user.id, action: 'assignment.acknowledge', entityType: 'assignment', entityId: assignmentId }),
    ],
    [],
    { not_found: fail(t('compliance.assignmentNotFound')) },
  )
  return err ?? { ok: true }
}

export async function disputeAssignment(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  const p = z.object({ id: z.string().length(26), note: z.string().trim().max(300).optional() }).safeParse(input)
  if (!p.success) return fail(t('compliance.invalidRequest'))
  const err = await commit(
    ctx,
    [
      db
        .prepare(`UPDATE assignments SET disputed_at = ?, dispute_note = ? WHERE id = ? AND user_id = ? AND returned_on IS NULL AND acknowledged_at IS NULL AND disputed_at IS NULL AND asset_id NOT IN (SELECT id FROM assets WHERE archived_at IS NOT NULL)`)
        .bind(nowIso(), p.data.note || null, p.data.id, user.id),
      assertion(db, 'not_found', 'changes() = 0'),
      audit(db, { actorId: user.id, action: 'assignment.dispute', entityType: 'assignment', entityId: p.data.id }),
    ],
    [],
    { not_found: fail(t('compliance.assignmentAnswered')) },
  )
  return err ?? { ok: true }
}

export async function pendingAssets(db: Db, userId: string): Promise<{ id: string; name: string; category: string; serial: string; quantity: number; since: string }[]> {
  const r = await db
    .prepare(
      `SELECT g.id, s.name, s.category, s.serial_no, s.quantity, g.assigned_on FROM assignments g JOIN assets s ON s.id = g.asset_id
       WHERE g.user_id = ? AND g.returned_on IS NULL AND g.acknowledged_at IS NULL AND g.disputed_at IS NULL AND s.archived_at IS NULL ORDER BY s.name`,
    )
    .bind(userId)
    .all<{ id: string; name: string; category: string | null; serial_no: string | null; quantity: number; assigned_on: string }>()
  return r.results.map((a) => ({ id: a.id, name: a.name, category: a.category ?? '', serial: a.serial_no ?? '', quantity: a.quantity, since: a.assigned_on }))
}

export async function confirmReturn(ctx: Ctx, assignmentId: string): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  const err = await commit(
    ctx,
    [
      db
        .prepare(`UPDATE assignments SET return_confirmed_at = ?, return_confirmed_ip = ? WHERE id = ? AND user_id = ? AND returned_on IS NOT NULL AND return_confirmed_at IS NULL`)
        .bind(nowIso(), ctx.client?.ip ?? null, assignmentId, user.id),
      assertion(db, 'not_found', 'changes() = 0'),
      audit(db, { actorId: user.id, action: 'assignment.confirmReturn', entityType: 'assignment', entityId: assignmentId }),
    ],
    [],
    { not_found: fail(t('compliance.returnNotFound')) },
  )
  return err ?? { ok: true }
}

const RETURNS_SHOWN_DAYS = 90

export interface LeaveStatement {
  year: number
  person: string
  entitled: number | null
  usedBefore: number
  annual: { range: string; days: number }[]
  other: { range: string; days: number; kind: string }[]
  used: number
  remaining: number | null
  confirmedAt: string | null
}

const otherKind = (k: string) => t((['excuse', 'sick', 'unpaid'].includes(k) ? `compliance.otherKinds.${k}` : 'compliance.otherKinds.other') as MessageKey)

export async function leaveStatement(ctx: Ctx, year: number, userId = ctx.user.id): Promise<LeaveStatement> {
  if (userId !== ctx.user.id) must(ctx.user, { a: 'report.read' })
  const { db } = ctx
  const [person, bal, rows, conf] = await Promise.all([
    db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(userId).first<{ display_name: string }>(),
    leaveBalance(db, userId, year),
    db
      .prepare(
        `SELECT l.kind, l.start_date, l.end_date, l.work_days FROM leave_requests l JOIN requests r ON r.id = l.request_id
         WHERE r.requester_id = ? AND l.year = ? AND r.status = 'approved' ORDER BY l.start_date`,
      )
      .bind(userId, year)
      .all<{ kind: string; start_date: string; end_date: string; work_days: number }>(),
    db.prepare(`SELECT confirmed_at FROM leave_statements WHERE user_id = ? AND year = ?`).bind(userId, year).first<{ confirmed_at: string }>(),
  ])
  const annual = rows.results.filter((r) => r.kind === 'annual').map((r) => ({ range: formatRange(r.start_date, r.end_date), days: r.work_days }))
  const other = rows.results.filter((r) => r.kind !== 'annual').map((r) => ({ range: formatRange(r.start_date, r.end_date), days: r.work_days, kind: otherKind(r.kind) }))
  const used = bal.usedBefore + annual.reduce((t, a) => t + a.days, 0)
  return {
    year,
    person: person?.display_name ?? '',
    entitled: bal.entitled,
    usedBefore: bal.usedBefore,
    annual,
    other,
    used,
    remaining: bal.entitled == null ? null : bal.entitled - used,
    confirmedAt: conf?.confirmed_at ?? null,
  }
}

export async function confirmLeaveStatement(ctx: Ctx, year: number): Promise<{ ok: true } | Fail> {
  if (!Number.isInteger(year) || year > Number(today(ctx).slice(0, 4))) return fail(t('compliance.yearNotConfirmable'))
  const st = await leaveStatement(ctx, year)
  if (st.entitled == null) return fail(t('compliance.noEntitlement', { year }))
  const { db, user } = ctx
  const err = await commit(
    ctx,
    [
      db
        .prepare(`INSERT INTO leave_statements (id, user_id, year, snapshot_json, ip) VALUES (?, ?, ?, ?, ?)`)
        .bind(ulid(), user.id, year, JSON.stringify({ ...st, confirmedAt: undefined }), ctx.client?.ip ?? null),
      audit(db, { actorId: user.id, action: 'leaveStatement.confirm', entityType: 'leave_entitlement', entityId: user.id, after: { year, remaining: st.remaining } }),
    ],
    [],
    { unique: fail(t('compliance.alreadyConfirmed')) },
  )
  return err ?? { ok: true }
}

export async function myRecords(ctx: Ctx) {
  const { db, user } = ctx
  const since = new Date(Date.now() - RETURNS_SHOWN_DAYS * 86_400_000).toISOString()
  const [assets, seats, accepted, returned] = await Promise.all([
    db
      .prepare(
        `SELECT g.id AS assignment_id, s.id, s.name, s.category, s.serial_no, s.quantity, g.assigned_on, g.acknowledged_at, g.disputed_at
         FROM assignments g JOIN assets s ON s.id = g.asset_id WHERE g.user_id = ? AND g.returned_on IS NULL AND s.archived_at IS NULL ORDER BY g.assigned_on DESC`,
      )
      .bind(user.id)
      .all<{ assignment_id: string; id: string; name: string; category: string | null; serial_no: string | null; quantity: number; assigned_on: string; acknowledged_at: string | null; disputed_at: string | null }>(),
    db
      .prepare(
        `SELECT d.id, d.name, d.plan, d.account_email FROM digital_asset_users du JOIN digital_assets d ON d.id = du.asset_id
         WHERE du.user_id = ? AND du.removed_at IS NULL AND d.status = 'active' ORDER BY d.name`,
      )
      .bind(user.id)
      .all<{ id: string; name: string; plan: string | null; account_email: string | null }>(),
    db.prepare(`SELECT doc, version, accepted_at FROM policy_acceptances WHERE user_id = ? ORDER BY accepted_at DESC`).bind(user.id).all<{ doc: PolicyDoc; version: string; accepted_at: string }>(),
    db
      .prepare(
        `SELECT g.id AS assignment_id, s.name, s.serial_no, s.quantity, g.returned_on, g.return_confirmed_at
         FROM assignments g JOIN assets s ON s.id = g.asset_id
         WHERE g.user_id = ? AND g.returned_on IS NOT NULL AND (g.return_confirmed_at IS NULL OR g.return_confirmed_at > ?) ORDER BY g.returned_on DESC`,
      )
      .bind(user.id, since)
      .all<{ assignment_id: string; name: string; serial_no: string | null; quantity: number; returned_on: string; return_confirmed_at: string | null }>(),
  ])
  return {
    assets: assets.results.map((a) => ({
      assignmentId: a.assignment_id, id: a.id, name: a.name, category: a.category ?? '', serial: a.serial_no ?? '', quantity: a.quantity, since: a.assigned_on, acknowledgedAt: a.acknowledged_at, disputedAt: a.disputed_at,
    })),
    returned: returned.results.map((a) => ({ assignmentId: a.assignment_id, name: a.name, serial: a.serial_no ?? '', quantity: a.quantity, returnedOn: a.returned_on, confirmedAt: a.return_confirmed_at })),
    seats: seats.results.map((d) => ({ id: d.id, name: d.name, plan: d.plan ?? '', account: d.account_email ?? '' })),
    accepted: accepted.results.map((a) => ({ doc: a.doc, version: a.version, at: a.accepted_at })),
  }
}

export async function myPending(ctx: Ctx): Promise<{ assets: number; statementYear: number | null }> {
  const { db, user } = ctx
  const day = today(ctx)
  const a = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM assignments WHERE user_id = ? AND returned_on IS NULL AND acknowledged_at IS NULL AND disputed_at IS NULL) AS n`)
    .bind(user.id)
    .first<{ n: number }>()
  let statementYear: number | null = null
  if (Number(day.slice(5, 7)) <= 3) {
    const prev = Number(day.slice(0, 4)) - 1
    const r = await db
      .prepare(`SELECT (SELECT COUNT(*) FROM leave_entitlements WHERE user_id = ? AND year = ?) AS ent, (SELECT COUNT(*) FROM leave_statements WHERE user_id = ? AND year = ?) AS conf`)
      .bind(user.id, prev, user.id, prev)
      .first<{ ent: number; conf: number }>()
    if (r && r.ent > 0 && r.conf === 0) statementYear = prev
  }
  return { assets: a?.n ?? 0, statementYear }
}

export async function allLeaveStatements(ctx: Ctx, year: number) {
  must(ctx.user, { a: 'report.read' })
  const people = (await ctx.db.prepare(`SELECT id FROM users WHERE status = 'active' AND can_login = 1 ORDER BY full_name`).all<{ id: string }>()).results
  return Promise.all(people.map((p) => leaveStatement(ctx, year, p.id)))
}

export async function undertakingPeople(ctx: Ctx) {
  must(ctx.user, { a: 'user.manage' })
  return (await ctx.db.prepare(`SELECT id, full_name FROM users WHERE status = 'active' AND can_login = 1 ORDER BY full_name`).all<{ id: string; full_name: string }>()).results.map((u) => ({ id: u.id, name: u.full_name }))
}
