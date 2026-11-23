import { t } from '#/i18n'
import { formatMoney } from '#/lib/money'
import { roleLabel } from '#/lib/permissions'
import { isBeforeBooks } from '#/lib/invoice'
import { approvedInvoiceMail } from '../accounting'
import { authorize, HttpError, must, type AuthUser } from '../auth/authorize'
import type { Ctx } from '../ctx'
import { assertion, audit, failedAssertion, nowIso, type Db, type Stmt } from '../db/d1'
import { enqueue, mails } from '../notify'
import { todayISO } from '../time'

const today = (ctx: Ctx) => ctx.today ?? todayISO()

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export function initialApproval(user: AuthUser, direction: 'in' | 'out', invoiceDate: string, now: string): { status: ApprovalStatus; auto: 0 | 1; decidedBy: string | null; decidedAt: string | null } {
  if (direction !== 'in' || isBeforeBooks(invoiceDate)) return { status: 'approved', auto: 0, decidedBy: null, decidedAt: null }
  if (user.role === 'approver') return { status: 'approved', auto: 1, decidedBy: user.id, decidedAt: now }
  return { status: 'pending', auto: 0, decidedBy: null, decidedAt: null }
}

export async function invoicePendingMails(db: Db, inv: { id: string; uploadedBy: string; firm: string; no: string; totalMinor: number }): Promise<Stmt[]> {
  const who = (await db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(inv.uploadedBy).first<{ display_name: string }>())?.display_name ?? t('views.someone')
  const to = (await db.prepare(`SELECT id FROM users WHERE status = 'active' AND role = 'approver' AND id <> ?`).bind(inv.uploadedBy).all<{ id: string }>()).results
  return enqueue(db, to.map((u) => mails.invoiceSubmitted(u.id, inv.id, who, inv.firm, inv.no, inv.totalMinor)))
}

interface DecideRow {
  id: string
  direction: 'in' | 'out'
  invoice_no: string
  counterparty: string
  approval_status: ApprovalStatus
  uploaded_by: string
  version: number
}

export const consumeTokens = (db: Db, entityType: 'request' | 'invoice', entityId: string, now: string): Stmt =>
  db.prepare(`UPDATE action_tokens SET used_at = ? WHERE entity_type = ? AND entity_id = ? AND used_at IS NULL`).bind(now, entityType, entityId)

export async function decideInvoice(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined, opts: { expectedVersion: number; via?: 'email'; client?: { ip?: string; ua?: string } }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db, user } = ctx
  const r = await db
    .prepare(`SELECT id, direction, invoice_no, counterparty, approval_status, uploaded_by, version FROM invoices WHERE id = ? AND archived_at IS NULL`)
    .bind(id)
    .first<DecideRow>()
  if (!r) throw new HttpError(404, t('views.errors.notFound'))
  must(user, { a: 'invoice.decide', uploadedBy: r.uploaded_by, status: r.approval_status })
  if (r.version !== opts.expectedVersion) return { ok: false, error: t('views.errors.invoiceChanged') }
  const reason = note?.trim()
  if (decision === 'rejected' && !reason) return { ok: false, error: t('views.errors.reasonRequired') }
  const now = nowIso()
  const stmts: Stmt[] = [
    db
      .prepare(
        `UPDATE invoices SET approval_status = ?, decided_at = ?, decided_by = ?, decision_note = ?, auto_approved = 0, updated_at = ?, updated_by = ?, version = version + 1
         WHERE id = ? AND approval_status = 'pending' AND archived_at IS NULL AND version = ? AND uploaded_by <> ?`,
      )
      .bind(decision, now, user.id, decision === 'rejected' ? reason!.slice(0, 1000) : null, now, user.id, r.id, r.version, user.id),
    assertion(db, 'conflict', 'changes() = 0'),
    audit(db, {
      actorId: user.id, action: decision === 'approved' ? 'invoice.approve' : 'invoice.reject', entityType: 'invoice', entityId: r.id,
      before: { status: 'pending' }, after: { status: decision, note: decision === 'rejected' ? reason : null }, meta: opts.via ? { via: opts.via, ...(opts.client ?? {}) } : undefined,
    }),
    consumeTokens(db, 'invoice', r.id, now),
  ]
  if (decision === 'approved') {
    const name = (await db.prepare(`SELECT full_name FROM users WHERE id = ?`).bind(user.id).first<{ full_name: string }>())?.full_name ?? roleLabel('approver')
    const acct = await approvedInvoiceMail(db, r.id, name, today(ctx))
    if (acct) stmts.push(acct)
  } else {
    stmts.push(...enqueue(db, [mails.invoiceRejected(r.uploaded_by, r.id, r.counterparty, r.invoice_no, reason!)]))
  }
  try {
    await db.batch(stmts)
    return { ok: true }
  } catch (e) {
    if (failedAssertion(e, ['conflict'])) return { ok: false, error: t('views.errors.invoiceDecided') }
    throw e
  }
}

export interface PendingInvoice {
  id: string
  firm: string
  no: string
  date: string
  total: string
  who: string
  hue: number
  fileId?: string
  version: number
}

export async function pendingInvoices(ctx: Ctx): Promise<PendingInvoice[]> {
  if (ctx.user.role !== 'approver') return []
  const rows = (
    await ctx.db
      .prepare(
        `SELECT i.id, i.counterparty, i.invoice_no, i.invoice_date, i.net_base_minor, i.vat_base_minor, i.uploaded_by, u.display_name AS who, u.avatar_hue AS hue, i.approval_status, i.version,
           (SELECT a.id FROM attachments a WHERE a.invoice_id = i.id AND a.archived_at IS NULL ORDER BY a.created_at LIMIT 1) AS file_id
         FROM invoices i JOIN users u ON u.id = i.uploaded_by
         WHERE i.archived_at IS NULL AND i.approval_status = 'pending' AND i.uploaded_by <> ? ORDER BY i.created_at`,
      )
      .bind(ctx.user.id)
      .all<{ id: string; counterparty: string; invoice_no: string; invoice_date: string; net_base_minor: number; vat_base_minor: number; uploaded_by: string; who: string; hue: number | null; approval_status: ApprovalStatus; version: number; file_id: string | null }>()
  ).results
  return rows
    .filter((r) => authorize(ctx.user, { a: 'invoice.decide', uploadedBy: r.uploaded_by, status: r.approval_status }).ok)
    .map((r) => ({
      id: r.id,
      firm: r.counterparty,
      no: r.invoice_no,
      date: r.invoice_date,
      total: formatMoney((r.net_base_minor + r.vat_base_minor) / 100),
      who: r.who,
      hue: r.hue ?? 220,
      version: r.version,
      ...(r.file_id ? { fileId: r.file_id } : {}),
    }))
}
