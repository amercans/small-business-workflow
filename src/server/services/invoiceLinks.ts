import { isBaseCurrency, type Currency } from '#/lib/money'
import type { LinkedInvoice, LinkKind, LinkTarget } from '#/data/invoices'
import { t } from '#/i18n'
import { z } from 'zod'
import { authorize, must, type Action, type AuthUser } from '../auth/authorize'
import type { Ctx } from '../ctx'
import { assertion, audit, type Db, type Stmt } from '../db/d1'
import { commit, fail, type Fail } from '../submit'

export type { LinkKind }
const KINDS = ['asset', 'digital', 'job'] as const
const linkInput = z.object({ invoiceId: z.string().length(26), kind: z.enum(KINDS), id: z.string().length(26) })

const readAction = (k: LinkKind): Action => (k === 'job' ? { a: 'jobs.read' } : { a: 'asset.read' })

export function mustLink(user: AuthUser, kinds: Iterable<LinkKind>): void {
  must(user, { a: 'invoice.update' })
  for (const k of new Set(kinds)) must(user, readAction(k))
}

const TARGET_SQL: Record<LinkKind, string> = {
  asset: `NOT EXISTS (SELECT 1 FROM assets WHERE id = ? AND archived_at IS NULL)`,
  digital: `NOT EXISTS (SELECT 1 FROM digital_assets WHERE id = ?)`,
  job: `NOT EXISTS (SELECT 1 FROM jobs WHERE id = ? AND archived_at IS NULL)`,
}

export const LINK_ERRORS: Record<string, Fail> = {
  link_invoice: fail(t('server.links.invoice')),
  link_target: fail(t('server.links.target')),
  link_dup: fail(t('server.links.duplicate')),
  unique: fail(t('server.links.duplicate')),
}

export async function targetNames(db: Db, user: AuthUser, links: { kind: LinkKind; id: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const sql: Record<LinkKind, string> = { asset: `SELECT name AS n FROM assets WHERE id = ?`, digital: `SELECT name AS n FROM digital_assets WHERE id = ?`, job: `SELECT title AS n FROM jobs WHERE id = ?` }
  for (const l of links) {
    const key = `${l.kind}:${l.id}`
    if (out.has(key)) continue
    if (!authorize(user, readAction(l.kind)).ok) continue
    const r = await db.prepare(sql[l.kind]).bind(l.id).first<{ n: string }>()
    if (r) out.set(key, r.n)
  }
  return out
}

export function linkStatements(db: Db, userId: string, invoiceId: string, links: { kind: LinkKind; id: string }[], checkInvoice: boolean, names: Map<string, string> = new Map()): Stmt[] {
  const seen = new Set<string>()
  const stmts: Stmt[] = []
  for (const l of links) {
    const key = `${l.kind}:${l.id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (checkInvoice) stmts.push(assertion(db, 'link_invoice', `NOT EXISTS (SELECT 1 FROM invoices WHERE id = ? AND archived_at IS NULL AND direction = 'in')`, invoiceId))
    stmts.push(
      assertion(db, 'link_target', TARGET_SQL[l.kind], l.id),
      assertion(db, 'link_dup', `EXISTS (SELECT 1 FROM invoice_links WHERE invoice_id = ? AND target_kind = ? AND target_id = ?)`, invoiceId, l.kind, l.id),
      db.prepare(`INSERT INTO invoice_links (invoice_id, target_kind, target_id, created_by) VALUES (?, ?, ?, ?)`).bind(invoiceId, l.kind, l.id, userId),
      audit(db, { actorId: userId, action: 'invoice.link', entityType: 'invoice', entityId: invoiceId, after: { kind: l.kind, id: l.id, ...(names.has(key) ? { name: names.get(key) } : {}) } }),
    )
  }
  return stmts
}

export async function linkInvoice(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  const p = linkInput.safeParse(input)
  if (!p.success) return fail(t('server.invalidRecord'))
  const { invoiceId, kind, id } = p.data
  mustLink(user, [kind])
  const inv = await db.prepare(`SELECT direction FROM invoices WHERE id = ? AND archived_at IS NULL`).bind(invoiceId).first<{ direction: 'in' | 'out' }>()
  if (!inv) return fail(t('server.links.invoiceNotFound'))
  if (inv.direction !== 'in') return fail(t('server.links.incomingOnly'))
  const names = await targetNames(db, user, [{ kind, id }])
  const err = await commit(ctx, linkStatements(db, user.id, invoiceId, [{ kind, id }], true, names), [], LINK_ERRORS)
  return err ?? { ok: true }
}

export async function unlinkInvoice(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  const p = linkInput.safeParse(input)
  if (!p.success) return fail(t('server.invalidRecord'))
  const { invoiceId, kind, id } = p.data
  mustLink(user, [kind])
  const has = await db.prepare(`SELECT 1 AS x FROM invoice_links WHERE invoice_id = ? AND target_kind = ? AND target_id = ?`).bind(invoiceId, kind, id).first()
  if (!has) return fail(t('server.links.noLink'))
  const name = (await targetNames(db, user, [{ kind, id }])).get(`${kind}:${id}`)
  const err = await commit(ctx, [
    db.prepare(`DELETE FROM invoice_links WHERE invoice_id = ? AND target_kind = ? AND target_id = ?`).bind(invoiceId, kind, id),
    audit(db, { actorId: user.id, action: 'invoice.unlink', entityType: 'invoice', entityId: invoiceId, before: { kind, id, ...(name ? { name } : {}) } }),
  ], [])
  return err ?? { ok: true }
}

interface LinkRow {
  target_id: string
  id: string
  invoice_no: string
  counterparty: string
  invoice_date: string
  direction: 'in' | 'out'
  currency: Currency
  fx_rate_micro: number
  net_minor: number
  vat_minor: number
  net_base_minor: number
  vat_base_minor: number
  file_id: string | null
}

export async function linkedInvoices(ctx: Ctx, kind: LinkKind, targetId?: string): Promise<Map<string, LinkedInvoice[]> | null> {
  const { user, db } = ctx
  if (!authorize(user, { a: 'invoice.list' }).ok) return null
  const all = authorize(user, { a: 'invoice.read', uploadedBy: '' }).ok
  const rows = (
    await db
      .prepare(
        `SELECT l.target_id, i.id, i.invoice_no, i.counterparty, i.invoice_date, i.direction, i.currency, i.fx_rate_micro, i.net_minor, i.vat_minor, i.net_base_minor, i.vat_base_minor,
           (SELECT a.id FROM attachments a WHERE a.invoice_id = i.id AND a.archived_at IS NULL ORDER BY a.created_at LIMIT 1) AS file_id
         FROM invoice_links l JOIN invoices i ON i.id = l.invoice_id
         WHERE l.target_kind = ? AND i.archived_at IS NULL ${targetId ? 'AND l.target_id = ?' : ''} ${all ? '' : 'AND i.uploaded_by = ?'}
         ORDER BY i.invoice_date DESC, i.created_at DESC`,
      )
      .bind(...[kind, ...(targetId ? [targetId] : []), ...(all ? [] : [user.id])])
      .all<LinkRow>()
  ).results
  const m = new Map<string, LinkedInvoice[]>()
  for (const r of rows) {
    const li: LinkedInvoice = {
      id: r.id,
      no: r.invoice_no,
      counterparty: r.counterparty,
      date: r.invoice_date,
      direction: r.direction,
      totalTry: (r.net_base_minor + r.vat_base_minor) / 100,
      currency: r.currency,
      ...(!isBaseCurrency(r.currency) ? { fxRate: r.fx_rate_micro / 1e6, totalOrig: (r.net_minor + r.vat_minor) / 100 } : {}),
      hasPdf: r.file_id != null,
      fileUrl: r.file_id ? `/files/${r.file_id}` : null,
    }
    m.set(r.target_id, [...(m.get(r.target_id) ?? []), li])
  }
  return m
}

export async function linkTargets(ctx: Ctx): Promise<LinkTarget[]> {
  const { user, db } = ctx
  if (!authorize(user, { a: 'invoice.update' }).ok || !authorize(user, { a: 'asset.read' }).ok || !authorize(user, { a: 'jobs.read' }).ok) return []
  const [a, d, j] = await Promise.all([
    db.prepare(`SELECT id, name, category, serial_no FROM assets WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1000`).all<{ id: string; name: string; category: string | null; serial_no: string | null }>(),
    db.prepare(`SELECT id, name, vendor, plan FROM digital_assets ORDER BY name LIMIT 1000`).all<{ id: string; name: string; vendor: string | null; plan: string | null }>(),
    db.prepare(`SELECT id, title, client FROM jobs WHERE archived_at IS NULL ORDER BY COALESCE(end_date, date(created_at)) DESC, created_at DESC LIMIT 1000`).all<{ id: string; title: string; client: string }>(),
  ])
  return [
    ...a.results.map((r): LinkTarget => ({ kind: 'asset', id: r.id, label: r.name, sub: [r.category, r.serial_no].filter(Boolean).join(' · ') })),
    ...d.results.map((r): LinkTarget => ({ kind: 'digital', id: r.id, label: r.name, sub: [r.vendor, r.plan].filter(Boolean).join(' · ') })),
    ...j.results.map((r): LinkTarget => ({ kind: 'job', id: r.id, label: r.title, sub: r.client })),
  ]
}
