import { LEAVE_OVERDRAFT_DAYS } from '#/lib/leave'
import { t } from '#/i18n'
import type { ApproverRole, AuthUser, RequestKind, RequestState } from '../auth/authorize'
import { assertion, audit, nowIso, type Db, type Stmt } from './d1'

export interface RequestRow {
  id: string
  type: RequestKind
  requester_id: string
  status: RequestState
  title: string
  note: string | null
  project: string | null
  total_base_minor: number | null
  submitted_at: string | null
  decided_at: string | null
  decided_by: string | null
  decision_note: string | null
  auto_approved: number
  paid_at: string | null
  cancelled_at: string | null
  created_at: string
  version: number
  approver_role: ApproverRole | null
  requester_name: string
  requester_full_name: string
  requester_role: string
  requester_department: string | null
  requester_hue: number | null
  decider_name: string | null
  item_count: number
  travel_advance: number
  first_item: string | null
}

const SELECT_REQ = `SELECT r.id, r.type, r.requester_id, r.status, r.title, r.note, r.project, r.total_base_minor, r.submitted_at,
    r.decided_at, r.decided_by, r.decision_note, r.auto_approved, r.paid_at, r.cancelled_at, r.created_at, r.version,
    r.approver_role,
    u.display_name AS requester_name, u.full_name AS requester_full_name, u.role AS requester_role, u.department AS requester_department,
    u.avatar_hue AS requester_hue, d.display_name AS decider_name,
    EXISTS (SELECT 1 FROM advance_requests ar WHERE ar.request_id = r.id AND ar.travel_request_id IS NOT NULL) AS travel_advance,
    (SELECT COUNT(*) FROM request_items i WHERE i.request_id = r.id AND i.archived_at IS NULL) AS item_count,
    (SELECT COALESCE(NULLIF(trim(i.description), ''), i.category) FROM request_items i WHERE i.request_id = r.id AND i.archived_at IS NULL ORDER BY i.line_no LIMIT 1) AS first_item
  FROM requests r JOIN users u ON u.id = r.requester_id LEFT JOIN users d ON d.id = r.decided_by`

export const getRequest = (db: Db, id: string) => db.prepare(`${SELECT_REQ} WHERE r.id = ?`).bind(id).first<RequestRow>()

export const listAll = async (db: Db) =>
  (await db.prepare(`${SELECT_REQ} WHERE r.status <> 'draft' ORDER BY r.created_at DESC LIMIT 1000`).all<RequestRow>()).results

export const listMine = async (db: Db, userId: string) =>
  (await db.prepare(`${SELECT_REQ} WHERE r.requester_id = ? AND r.status <> 'draft' ORDER BY r.created_at DESC`).bind(userId).all<RequestRow>()).results

export async function listQueue(db: Db, user: AuthUser, status: 'pending' | 'decided', sinceIso?: string): Promise<RequestRow[]> {
  if (user.role === 'employee') return []
  if (status === 'pending') {
    return (await db.prepare(`${SELECT_REQ} WHERE r.status = 'pending' AND r.approver_role = ? AND r.requester_id <> ? ORDER BY r.submitted_at DESC`).bind(user.role, user.id).all<RequestRow>()).results
  }
  const payer = user.role === 'approver'
  const extra = payer ? `OR (r.status = 'approved' AND r.decided_at >= ? AND r.type IN ('expense','advance')) OR r.paid_at >= ?` : ''
  const stmt = db.prepare(
    `${SELECT_REQ} WHERE r.status <> 'draft' AND r.auto_approved = 0 AND (
       (r.decided_by = ? AND r.decided_at >= ?) ${extra}
     ) AND (r.requester_id <> ? OR r.status IN ('approved','paid'))
     ORDER BY COALESCE(r.paid_at, r.decided_at) DESC`,
  )
  const binds = [user.id, sinceIso, ...(payer ? [sinceIso, sinceIso] : []), user.id]
  return (await stmt.bind(...binds).all<RequestRow>()).results
}

export const pendingCounts = (db: Db) =>
  db
    .prepare(
      `SELECT SUM(type = 'leave') AS leave_n, SUM(type <> 'leave') AS other_n,
              COALESCE(SUM(CASE WHEN type <> 'leave' THEN total_base_minor END), 0) AS other_minor, MIN(submitted_at) AS oldest
       FROM requests WHERE status = 'pending'`,
    )
    .first<{ leave_n: number | null; other_n: number | null; other_minor: number; oldest: string | null }>()

export interface LeaveRow {
  kind: 'annual' | 'excuse' | 'sick' | 'unpaid' | 'other'
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  work_days: number
  return_date: string | null
  substitute_name: string | null
}
export interface ItemRow { id: string; line_no: number; expense_date: string; category: string; description: string | null; currency: string; amount_minor: number; fx_rate_micro: number; amount_base_minor: number; doc_no: string | null; vat_minor: number | null }
export interface ClosureRow { paid_minor: number; spent_minor: number; refund_minor: number; note: string | null; closed_at: string; refund_received_at: string | null; receiver_name: string | null }
export interface AdvanceRow { amount_minor: number; needed_on: string; travel_request_id: string | null; travel_title: string | null; payment_method: 'bank' | 'cash' | null; iban: string | null }
export interface PurchaseRow { category: 'equipment' | 'software' | 'other'; item_name: string; quantity: number; unit_estimated_minor: number; estimated_minor: number; license_period: 'monthly' | 'yearly' | 'one_time' | null; url: string | null }
export interface TravelRow { destination: string; start_date: string; end_date: string; purpose: string; transport: 'plane' | 'bus' | 'car' | 'train' | 'other'; accommodation: 'none' | 'hotel'; estimated_budget_minor: number | null }

export interface RequestDetailRows {
  leave?: LeaveRow | null
  items?: ItemRow[]
  iban?: string | null
  allocatedMinor?: number
  advance?: AdvanceRow | null
  advanceSpent?: { settled_minor: number; settling_minor: number }
  closure?: ClosureRow | null
  purchase?: PurchaseRow | null
  travel?: TravelRow | null
  linkedAdvances?: { id: string; amount_minor: number; status: RequestState }[]
}

export async function detailRows(db: Db, r: Pick<RequestRow, 'id' | 'type'>): Promise<RequestDetailRows> {
  switch (r.type) {
    case 'leave':
      return {
        leave: await db
          .prepare(
            `SELECT l.kind, l.start_date, l.end_date, l.start_time, l.end_time, l.work_days, l.return_date, s.full_name AS substitute_name
             FROM leave_requests l LEFT JOIN users s ON s.id = l.substitute_id WHERE l.request_id = ?`,
          )
          .bind(r.id)
          .first<LeaveRow>(),
      }
    case 'expense': {
      const [items, iban, alloc] = await Promise.all([
        db
          .prepare(`SELECT id, line_no, expense_date, category, description, currency, amount_minor, fx_rate_micro, amount_base_minor, doc_no, vat_minor FROM request_items WHERE request_id = ? AND archived_at IS NULL ORDER BY line_no`)
          .bind(r.id)
          .all<ItemRow>(),
        db.prepare(`SELECT iban FROM expense_requests WHERE request_id = ?`).bind(r.id).first<{ iban: string }>(),
        allocationsOf(db, r.id),
      ])
      return { items: items.results, iban: iban?.iban ?? null, allocatedMinor: alloc }
    }
    case 'advance': {
      const [advance, spent, closure] = await Promise.all([
        db
          .prepare(`SELECT a.amount_minor, a.needed_on, a.travel_request_id, t.title AS travel_title, a.payment_method, a.iban FROM advance_requests a LEFT JOIN requests t ON t.id = a.travel_request_id WHERE a.request_id = ?`)
          .bind(r.id)
          .first<AdvanceRow>(),
        advanceSpent(db, r.id),
        db
          .prepare(
            `SELECT c.paid_minor, c.spent_minor, c.refund_minor, c.note, c.closed_at, c.refund_received_at, u.display_name AS receiver_name
             FROM advance_closures c LEFT JOIN users u ON u.id = c.refund_received_by WHERE c.advance_request_id = ?`,
          )
          .bind(r.id)
          .first<ClosureRow>(),
      ])
      return { advance, advanceSpent: spent, closure }
    }
    case 'purchase':
      return { purchase: await db.prepare(`SELECT category, item_name, quantity, unit_estimated_minor, estimated_minor, license_period, url FROM purchase_requests WHERE request_id = ?`).bind(r.id).first<PurchaseRow>() }
    case 'travel':
      return {
        travel: await db.prepare(`SELECT destination, start_date, end_date, purpose, transport, accommodation, estimated_budget_minor FROM travel_requests WHERE request_id = ?`).bind(r.id).first<TravelRow>(),
        linkedAdvances: (
          await db.prepare(`SELECT r.id, a.amount_minor, r.status FROM advance_requests a JOIN requests r ON r.id = a.request_id WHERE a.travel_request_id = ? AND r.status <> 'draft'`).bind(r.id).all<{ id: string; amount_minor: number; status: RequestState }>()
        ).results,
      }
  }
}

export interface LeaveBalance {
  entitled: number | null
  usedBefore: number
  used: number
  pending: number
}

export async function leaveBalance(db: Db, userId: string, year: number): Promise<LeaveBalance> {
  const e = await db.prepare(`SELECT entitled_days, used_before_days FROM leave_entitlements WHERE user_id = ? AND year = ?`).bind(userId, year).first<{ entitled_days: number; used_before_days: number }>()
  const s = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN r.status = 'approved' THEN l.work_days END), 0) AS used,
              COALESCE(SUM(CASE WHEN r.status = 'pending' THEN l.work_days END), 0) AS pending
       FROM leave_requests l JOIN requests r ON r.id = l.request_id
       WHERE r.requester_id = ? AND l.kind = 'annual' AND l.year = ? AND r.status IN ('approved','pending')`,
    )
    .bind(userId, year)
    .first<{ used: number; pending: number }>()
  return { entitled: e?.entitled_days ?? null, usedBefore: e?.used_before_days ?? 0, used: s?.used ?? 0, pending: s?.pending ?? 0 }
}

export const leaveRanges = async (db: Db, userId: string) =>
  (
    await db
      .prepare(
        `SELECT l.start_date AS "from", l.end_date AS "to", r.status FROM leave_requests l JOIN requests r ON r.id = l.request_id
         WHERE r.requester_id = ? AND r.status IN ('approved','pending') AND l.start_time IS NULL ORDER BY l.start_date`,
      )
      .bind(userId)
      .all<{ from: string; to: string; status: 'approved' | 'pending' }>()
  ).results

export const partialLeaves = async (db: Db, userId: string, sinceDay: string) =>
  (
    await db
      .prepare(
        `SELECT l.start_date AS "date", l.start_time AS "from", l.end_time AS "to", r.status FROM leave_requests l JOIN requests r ON r.id = l.request_id
         WHERE r.requester_id = ? AND r.status IN ('approved','pending') AND l.start_time IS NOT NULL AND l.start_date >= ? ORDER BY l.start_date, l.start_time`,
      )
      .bind(userId, sinceDay)
      .all<{ date: string; from: string; to: string; status: 'approved' | 'pending' }>()
  ).results

export interface OpenAdvance {
  id: string
  title: string
  amount_minor: number
  open_minor: number
  settling_minor: number
  paid_at: string
}

export const openAdvances = async (db: Db, userId: string) =>
  (
    await db
      .prepare(
        `SELECT r.id, r.title, a.amount_minor,
                a.amount_minor - COALESCE(SUM(CASE WHEN e.status IN ('approved','paid') THEN al.amount_minor END), 0) AS open_minor,
                COALESCE(SUM(CASE WHEN e.status = 'pending' THEN al.amount_minor END), 0) AS settling_minor,
                r.paid_at
         FROM requests r
         JOIN advance_requests a ON a.request_id = r.id
         LEFT JOIN advance_allocations al ON al.advance_request_id = r.id
         LEFT JOIN requests e ON e.id = al.expense_request_id
         WHERE r.requester_id = ? AND r.type = 'advance' AND r.status = 'paid'
           AND a.travel_request_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM advance_closures c WHERE c.advance_request_id = r.id)
         GROUP BY r.id
         HAVING open_minor > 0
         ORDER BY r.paid_at`,
      )
      .bind(userId)
      .all<OpenAdvance>()
  ).results

export const advanceSpent = async (db: Db, advanceId: string) =>
  (await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN e.status IN ('approved','paid') THEN al.amount_minor END), 0) AS settled_minor,
              COALESCE(SUM(CASE WHEN e.status = 'pending' THEN al.amount_minor END), 0) AS settling_minor
       FROM advance_allocations al JOIN requests e ON e.id = al.expense_request_id WHERE al.advance_request_id = ?`,
    )
    .bind(advanceId)
    .first<{ settled_minor: number; settling_minor: number }>()) ?? { settled_minor: 0, settling_minor: 0 }

export const refundsDue = async (db: Db) =>
  (
    await db
      .prepare(
        `SELECT r.id, r.title, u.display_name AS who, u.avatar_hue AS hue, c.refund_minor, c.closed_at
         FROM advance_closures c JOIN requests r ON r.id = c.advance_request_id JOIN users u ON u.id = r.requester_id
         WHERE c.refund_minor > 0 AND c.refund_received_at IS NULL ORDER BY c.closed_at`,
      )
      .all<{ id: string; title: string; who: string; hue: number | null; refund_minor: number; closed_at: string }>()
  ).results

export const allocationsOf = async (db: Db, expenseId: string) =>
  (await db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) AS k FROM advance_allocations WHERE expense_request_id = ?`).bind(expenseId).first<{ k: number }>())?.k ?? 0

export interface DraftInput {
  id: string
  type: RequestKind
  title: string
  note?: string | null
  project?: string | null
  totalMinor?: number | null
}

export function insertDraft(db: Db, user: AuthUser, d: DraftInput, now: string): Stmt {
  return db
    .prepare(
      `INSERT INTO requests (id, type, requester_id, status, title, note, project, total_base_minor, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(d.id, d.type, user.id, d.title, d.note ?? null, d.project ?? null, d.type === 'leave' ? null : (d.totalMinor ?? null), now, user.id, now, user.id)
}

export function submitDraft(db: Db, user: AuthUser, id: string, now: string, stage: ApproverRole | 'auto'): Stmt[] {
  const auto = stage === 'auto'
  return [
    auto
      ? db
          .prepare(`UPDATE requests SET status = 'approved', auto_approved = 1, submitted_at = ?, decided_at = ?, decided_by = ?, updated_at = ?, updated_by = ? WHERE id = ? AND requester_id = ? AND status = 'draft'`)
          .bind(now, now, user.id, now, user.id, id, user.id)
      : db.prepare(`UPDATE requests SET status = 'pending', approver_role = ?, submitted_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND requester_id = ? AND status = 'draft'`).bind(stage, now, now, user.id, id, user.id),
    assertion(db, 'submit_failed', 'changes() = 0'),
    audit(db, { actorId: user.id, action: 'request.submit', entityType: 'request', entityId: id, meta: auto ? { auto: true } : { approverRole: stage } }),
  ]
}

export const LEAVE_ERRORS = ['leave_overlap', 'leave_no_entitlement', 'leave_balance'] as const

export function leaveChecks(
  db: Db, userId: string, requestId: string,
  l: { kind: string; start: string; end: string; days: number; year: number; startTime?: string | null; endTime?: string | null; unlimited?: boolean },
): Stmt[] {
  const st = l.startTime ?? null
  const et = l.endTime ?? null
  const out = [
    assertion(
      db,
      'leave_overlap',
      `EXISTS (SELECT 1 FROM leave_requests l JOIN requests r ON r.id = l.request_id
               WHERE r.requester_id = ? AND r.id <> ? AND r.status IN ('pending','approved') AND l.start_date <= ? AND l.end_date >= ?
                 AND (l.start_time IS NULL OR ? IS NULL OR (l.start_time < ? AND l.end_time > ?)))`,
      userId, requestId, l.end, l.start, st, et, st,
    ),
  ]
  if (l.kind === 'annual' && !l.unlimited) {
    out.push(assertion(db, 'leave_no_entitlement', `NOT EXISTS (SELECT 1 FROM leave_entitlements WHERE user_id = ? AND year = ?)`, userId, l.year))
    out.push(
      assertion(
        db,
        'leave_balance',
        `? > ? + (SELECT e.entitled_days - e.used_before_days - COALESCE((
                SELECT SUM(lr.work_days) FROM leave_requests lr JOIN requests r ON r.id = lr.request_id
                WHERE r.requester_id = e.user_id AND r.status IN ('approved','pending') AND lr.kind = 'annual' AND lr.year = e.year AND r.id <> ?), 0)
              FROM leave_entitlements e WHERE e.user_id = ? AND e.year = ?)`,
        l.days, LEAVE_OVERDRAFT_DAYS, requestId, userId, l.year,
      ),
    )
  }
  return out
}

export function cancelStmts(db: Db, user: AuthUser, r: RequestRow, reason: string | null): Stmt[] {
  const now = nowIso()
  const out = [
    db
      .prepare(`UPDATE requests SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?, updated_by = ?, version = version + 1
                WHERE id = ? AND requester_id = ? AND (status IN ('draft','pending') OR (status = 'approved' AND type = 'leave')) AND version = ?`)
      .bind(now, user.id, reason, now, user.id, r.id, user.id, r.version),
    assertion(db, 'conflict', 'changes() = 0'),
    audit(db, { actorId: user.id, action: 'request.cancel', entityType: 'request', entityId: r.id, before: { status: r.status }, after: { status: 'cancelled' } }),
  ]
  if (r.type === 'travel') {
    out.push(
      db
        .prepare(`UPDATE requests SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?, updated_by = ?, version = version + 1
                  WHERE requester_id = ? AND status = 'pending' AND id IN (SELECT request_id FROM advance_requests WHERE travel_request_id = ?)`)
        .bind(now, user.id, t('server.requests.travelCancelled'), now, user.id, user.id, r.id),
    )
  }
  return out
}

export function decideStmts(db: Db, user: AuthUser, r: RequestRow, decision: 'approved' | 'rejected', note: string | null, meta?: Record<string, unknown>): Stmt[] {
  const now = nowIso()
  return [
    db
      .prepare(`UPDATE requests SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?, updated_at = ?, updated_by = ?, version = version + 1
                WHERE id = ? AND status = 'pending' AND approver_role IS ? AND version = ? AND requester_id <> ?`)
      .bind(decision, now, user.id, note, now, user.id, r.id, r.approver_role, r.version, user.id),
    assertion(db, 'conflict', 'changes() = 0'),
    audit(db, { actorId: user.id, action: decision === 'approved' ? 'request.approve' : 'request.reject', entityType: 'request', entityId: r.id, before: { status: 'pending', approverRole: r.approver_role }, after: { status: decision, note }, meta }),
  ]
}

export function markPaidStmts(db: Db, user: AuthUser, r: RequestRow): Stmt[] {
  const now = nowIso()
  return [
    db
      .prepare(`UPDATE requests SET status = 'paid', paid_at = ?, paid_by = ?, updated_at = ?, updated_by = ?, version = version + 1
                WHERE id = ? AND status = 'approved' AND type IN ('expense','advance') AND version = ?`)
      .bind(now, user.id, now, user.id, r.id, r.version),
    assertion(db, 'conflict', 'changes() = 0'),
    audit(db, { actorId: user.id, action: 'request.markPaid', entityType: 'request', entityId: r.id, before: { status: 'approved' }, after: { status: 'paid' } }),
  ]
}

export function closeAdvanceStmts(db: Db, user: AuthUser, advanceId: string, note: string | null): Stmt[] {
  const now = nowIso()
  return [
    db
      .prepare(
        `INSERT INTO advance_closures (advance_request_id, paid_minor, spent_minor, refund_minor, note, closed_at, closed_by)
         SELECT a.request_id, a.amount_minor, s.settled, a.amount_minor - s.settled, ?, ?, ?
         FROM advance_requests a JOIN requests r ON r.id = a.request_id,
              (SELECT COALESCE(SUM(CASE WHEN e.status IN ('approved','paid') THEN al.amount_minor END), 0) AS settled,
                      COALESCE(SUM(CASE WHEN e.status = 'pending' THEN al.amount_minor END), 0) AS settling
               FROM advance_allocations al JOIN requests e ON e.id = al.expense_request_id WHERE al.advance_request_id = ?) s
         WHERE a.request_id = ? AND r.requester_id = ? AND r.status = 'paid' AND s.settling = 0 AND a.travel_request_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM advance_closures c WHERE c.advance_request_id = a.request_id)`,
      )
      .bind(note, now, user.id, advanceId, advanceId, user.id),
    assertion(db, 'advance_close', 'changes() = 0'),
    audit(db, { actorId: user.id, action: 'advance.close', entityType: 'request', entityId: advanceId }),
  ]
}

export function refundReceivedStmts(db: Db, user: AuthUser, advanceId: string): Stmt[] {
  const now = nowIso()
  return [
    db
      .prepare(`UPDATE advance_closures SET refund_received_at = ?, refund_received_by = ? WHERE advance_request_id = ? AND refund_minor > 0 AND refund_received_at IS NULL
                AND (SELECT requester_id FROM requests WHERE id = ?) <> ?`)
      .bind(now, user.id, advanceId, advanceId, user.id),
    assertion(db, 'conflict', 'changes() = 0'),
    audit(db, { actorId: user.id, action: 'advance.refundReceived', entityType: 'request', entityId: advanceId }),
  ]
}
