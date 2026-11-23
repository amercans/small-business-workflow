import type { Role } from '#/lib/permissions'
import type { Agreement } from '#/data/agreements'
import { runtimeConfig } from '#/config/runtime'
import { baseCurrency, currencyLabel, isBaseCurrency, round2, type Currency } from '#/lib/money'
import { formatDate } from '#/i18n/format'
import { t } from '#/i18n'
import type { Asset } from '#/data/inventory'
import type { Invoice } from '#/data/invoices'
import type { MonthData, OverviewData } from '#/data/finance'
import { breakdownTotal, monthLong } from '#/lib/finance'
import type { AppUser } from '#/data/users'
import { checkEmailDomain, normalizeEmail } from '#/lib/email'
import { describeInvoiceChange, normalizeFirm, receivablesOf, booksStart, isBeforeBooks, type InvoiceSnap } from '#/lib/invoice'
import { agreementSchema, assetEditSchema, assetSchema, assignSchema, digitalSchema, seatSchema, FIXED_KINDS, fixedCostSchema, fxSchema, invoiceEditSchema, invoiceSchema, settleSchema, monthlyBase, userSchema, type DigitalCurrency, type DigitalKind, type DigitalPeriod, type FixedKind, type FxRates } from '#/lib/manageSchemas'
import type { DigitalAsset } from '#/data/digital'
import { z } from 'zod'
import { authorize, HttpError, must } from '../auth/authorize'
import type { Ctx, FormInput } from '../ctx'
import { attachmentsOf, insertAttachment } from '../db/attachments'
import { assertion, audit, nowIso, toMinor, toBaseMinor, ulid, type Db, type Stmt } from '../db/d1'
import { rateOn, storedRates, storeRatesStmt } from '../fx'
import { linkedInvoices, linkStatements, mustLink, targetNames } from './invoiceLinks'
import { approvedInvoiceMail } from '../accounting'
import { consumeTokens, initialApproval, invoicePendingMails } from './invoiceApproval'
import { pendingCounts } from '../db/requests'
import { allUsers } from '../db/users'
import { dropUserSessions } from '../auth/accounts'
import type { PreparedFile } from '../files'
import { commit, fail, fileError, fileFrom, type Fail } from '../submit'
import { todayISO } from '../time'
import { writeSetting } from '../settings'
import { normalizeVatRates, VAT_SETTING, vatRateError } from '../vat'

const today = (ctx: Ctx) => ctx.today ?? todayISO()

function parsed<T extends z.ZodType>(schema: T, input: unknown): { ok: true; data: z.output<T> } | { ok: false; res: Fail } {
  const r = schema.safeParse(input)
  if (r.success) return { ok: true, data: r.data }
  const fe: Record<string, string> = {}
  for (const i of r.error.issues) fe[i.path.join('.')] ??= i.message
  return { ok: false, res: { ok: false, error: Object.values(fe)[0] ?? t('server.invalidRecord'), fieldErrors: fe } }
}

interface InvoiceRow {
  id: string
  direction: 'in' | 'out'
  invoice_no: string
  counterparty: string
  invoice_date: string
  due_on: string | null
  vat_rate_bp: number | null
  net_base_minor: number
  vat_base_minor: number
  settled_on: string | null
  uploaded_by: string
  currency: Currency
  fx_rate_micro: number
  net_minor: number
  vat_minor: number
  version: number
  cost_kind: 'direct' | 'overhead' | null
  file_id: string | null
  file_name: string | null
  approval_status: 'pending' | 'approved' | 'rejected'
  decision_note: string | null
}

const INVOICE_SELECT = `SELECT i.id, i.direction, i.invoice_no, i.counterparty, i.invoice_date, i.due_on, i.vat_rate_bp, i.net_base_minor, i.vat_base_minor,
    i.settled_on, i.uploaded_by, i.currency, i.fx_rate_micro, i.net_minor, i.vat_minor, i.version, i.cost_kind, i.approval_status, i.decision_note,
    (SELECT a.id FROM attachments a WHERE a.invoice_id = i.id AND a.archived_at IS NULL ORDER BY a.created_at LIMIT 1) AS file_id,
    (SELECT a.original_name FROM attachments a WHERE a.invoice_id = i.id AND a.archived_at IS NULL ORDER BY a.created_at LIMIT 1) AS file_name
  FROM invoices i`

async function invoiceItems(ctx: Ctx, scope: { id: string } | { uploadedBy: string } | 'all') {
  const where =
    scope === 'all' ? `invoice_id IN (SELECT id FROM invoices WHERE archived_at IS NULL)`
    : 'id' in scope ? `invoice_id = ?`
    : `invoice_id IN (SELECT id FROM invoices WHERE archived_at IS NULL AND uploaded_by = ?)`
  const params = scope === 'all' ? [] : ['id' in scope ? scope.id : scope.uploadedBy]
  const rows = (
    await ctx.db
      .prepare(`SELECT invoice_id, description, quantity, serial_no, to_inventory FROM invoice_items WHERE archived_at IS NULL AND ${where} ORDER BY line_no`)
      .bind(...params)
      .all<{ invoice_id: string; description: string; quantity: number; serial_no: string | null; to_inventory: number }>()
  ).results
  const m = new Map<string, Invoice['items']>()
  for (const r of rows) m.set(r.invoice_id, [...(m.get(r.invoice_id) ?? []), { name: r.description, qty: r.quantity, serial: r.serial_no ?? undefined, toInventory: r.to_inventory === 1 }])
  return m
}

const toInvoice = (r: InvoiceRow, items: Invoice['items'], links: Invoice['links'] = []): Invoice => ({
  id: r.id,
  direction: r.direction,
  no: r.invoice_no,
  firm: r.counterparty,
  date: r.invoice_date,
  net: r.net_base_minor / 100,
  vatRate: (r.vat_rate_bp ?? 0) / 100,
  vat: r.vat_base_minor / 100,
  total: (r.net_base_minor + r.vat_base_minor) / 100,
  due: r.due_on,
  settledOn: r.settled_on,
  uploadedBy: r.uploaded_by,
  currency: r.currency,
  fxRate: isBaseCurrency(r.currency) ? null : r.fx_rate_micro / 1e6,
  netOrig: r.net_minor / 100,
  vatOrig: r.vat_minor / 100,
  totalOrig: (r.net_minor + r.vat_minor) / 100,
  version: r.version,
  costKind: r.cost_kind,
  fileName: r.file_name ?? '',
  fileId: r.file_id ?? undefined,
  beforeBooks: isBeforeBooks(r.invoice_date),
  approval: r.approval_status,
  ...(r.approval_status === 'rejected' && r.decision_note ? { rejectNote: r.decision_note } : {}),
  items,
  links,
})

async function invoiceLinkNames(ctx: Ctx, scope: { id: string } | { uploadedBy: string } | 'all'): Promise<Map<string, Invoice['links']>> {
  const m = new Map<string, Invoice['links']>()
  const canAsset = authorize(ctx.user, { a: 'asset.read' }).ok
  const canJob = authorize(ctx.user, { a: 'jobs.read' }).ok
  if (!canAsset && !canJob) return m
  const where =
    scope === 'all' ? `l.invoice_id IN (SELECT id FROM invoices WHERE archived_at IS NULL)`
    : 'id' in scope ? `l.invoice_id = ?`
    : `l.invoice_id IN (SELECT id FROM invoices WHERE archived_at IS NULL AND uploaded_by = ?)`
  const params = scope === 'all' ? [] : ['id' in scope ? scope.id : scope.uploadedBy]
  const rows = (
    await ctx.db
      .prepare(
        `SELECT l.invoice_id, l.target_kind AS kind, l.target_id AS id, COALESCE(a.name, d.name, j.title) AS label
         FROM invoice_links l
         LEFT JOIN assets a ON l.target_kind = 'asset' AND a.id = l.target_id
         LEFT JOIN digital_assets d ON l.target_kind = 'digital' AND d.id = l.target_id
         LEFT JOIN jobs j ON l.target_kind = 'job' AND j.id = l.target_id
         WHERE ${where} ORDER BY l.created_at, l.target_id`,
      )
      .bind(...params)
      .all<{ invoice_id: string; kind: 'asset' | 'digital' | 'job'; id: string; label: string | null }>()
  ).results
  for (const r of rows) {
    if (r.kind === 'job' ? !canJob : !canAsset) continue
    m.set(r.invoice_id, [...(m.get(r.invoice_id) ?? []), { kind: r.kind, id: r.id, label: r.label ?? t('server.deletedRecord') }])
  }
  return m
}

export async function listInvoices(ctx: Ctx): Promise<Invoice[]> {
  must(ctx.user, { a: 'invoice.list' })
  const all = authorize(ctx.user, { a: 'invoice.read', uploadedBy: '' }).ok
  const stmt = all
    ? ctx.db.prepare(`${INVOICE_SELECT} WHERE i.archived_at IS NULL ORDER BY i.invoice_date DESC, i.created_at DESC`)
    : ctx.db.prepare(`${INVOICE_SELECT} WHERE i.archived_at IS NULL AND i.uploaded_by = ? ORDER BY i.invoice_date DESC, i.created_at DESC`).bind(ctx.user.id)
  const rows = (await stmt.all<InvoiceRow>()).results
  const scope = all ? 'all' : { uploadedBy: ctx.user.id }
  const [items, links] = await Promise.all([invoiceItems(ctx, scope), invoiceLinkNames(ctx, scope)])
  return rows.map((r) => toInvoice(r, items.get(r.id) ?? [], links.get(r.id) ?? []))
}

export async function settleInvoice(ctx: Ctx, input: unknown): Promise<{ ok: true; settledOn: string | null } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'invoice.update' })
  const p = parsed(settleSchema, input)
  if (!p.ok) return p.res
  const { id, settledOn } = p.data
  const inv = await db.prepare(`SELECT invoice_date, settled_on FROM invoices WHERE id = ? AND archived_at IS NULL`).bind(id).first<{ invoice_date: string; settled_on: string | null }>()
  if (!inv) return fail(t('server.invoices.notFound'))
  if (settledOn && settledOn < inv.invoice_date) return fail(t('server.invoices.beforeInvoice'), 'settledOn')
  if (settledOn && settledOn > today(ctx)) return fail(t('server.invoices.noFuture'), 'settledOn')
  const err = await commit(ctx, [
    db.prepare(`UPDATE invoices SET settled_on = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND archived_at IS NULL`).bind(settledOn, nowIso(), user.id, id),
    audit(db, { actorId: user.id, action: 'invoice.settle', entityType: 'invoice', entityId: id, before: { settledOn: inv.settled_on }, after: { settledOn } }),
  ], [])
  return err ?? { ok: true, settledOn }
}

export async function createInvoice(ctx: Ctx, input: FormInput): Promise<{ ok: true; invoice: Invoice; assets: number } | Fail> {
  const { db, user } = ctx
  const p = parsed(invoiceSchema, input.json)
  if (!p.ok) return p.res
  const v = p.data
  must(user, { a: 'invoice.create', direction: v.direction })
  if (v.links?.length) mustLink(user, v.links.map((l) => l.kind))
  if (v.date > today(ctx)) return fail(t('server.invoices.futureInvoice'), 'date')

  let file: PreparedFile
  try {
    file = (await fileFrom((input.json as { file?: unknown }).file, input.files, 'fileName', { required: true }))!
  } catch (e) {
    return fileError(e)
  }

  const id = ulid()
  const currency = v.currency ?? baseCurrency()
  if (v.links?.length && v.direction !== 'in') return fail(t('server.invoices.incomingLinkOnly'), 'links')
  const vatErr = await vatRateError(db, v.vatRate)
  if (vatErr) return vatErr
  let fxMicro = 1_000_000
  let fxSource: 'tcmb' | 'ecb' | 'manual' | null = null
  if (!isBaseCurrency(currency)) {
    if (v.fxRate) {
      fxMicro = Math.round(v.fxRate * 1e6)
      fxSource = 'manual'
    } else {
      const r = await rateOn(v.date, currency, ctx.fetcher ?? fetch)
      if (!r) return fail(t('server.invoices.fxMissing', { currency: currencyLabel(runtimeConfig().baseCurrency) }), 'fxRate')
      fxMicro = Math.round(r.rate * 1e6)
      fxSource = r.source
    }
  }
  const net = toMinor(round2(v.net))
  const vat = Math.round((net * v.vatRate) / 100)
  const netTry = isBaseCurrency(currency) ? net : toBaseMinor(net, fxMicro)
  const vatTry = isBaseCurrency(currency) ? vat : toBaseMinor(vat, fxMicro)
  const firm = v.firm.trim().replace(/\s+/g, ' ')
  const ap = initialApproval(user, v.direction, v.date, nowIso())
  const stmts: Stmt[] = [
    assertion(
      db,
      'invoice_duplicate',
      `EXISTS (SELECT 1 FROM invoices WHERE direction = ? AND archived_at IS NULL AND invoice_no = ? AND lower(counterparty) = lower(?))`,
      v.direction, v.no.trim(), firm,
    ),
    db
      .prepare(
        `INSERT INTO invoices (id, direction, invoice_no, counterparty, invoice_date, due_on, currency, fx_rate_micro, vat_rate_bp, net_minor, vat_minor, net_base_minor, vat_base_minor, cost_kind, uploaded_by, created_by, updated_by,
           approval_status, auto_approved, decided_by, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, v.direction, v.no.trim(), firm, v.date, v.direction === 'out' ? (v.due ?? null) : null, currency, fxMicro, v.vatRate * 100, net, vat, netTry, vatTry, v.direction === 'in' ? (v.costKind ?? null) : null, user.id, user.id, user.id,
        ap.status, ap.auto, ap.decidedBy, ap.decidedAt),
    insertAttachment(db, file, 'invoice_file', { invoiceId: id }, user.id),
    audit(db, { actorId: user.id, action: 'invoice.create', entityType: 'invoice', entityId: id, after: { direction: v.direction, no: v.no.trim(), firm, date: v.date, net, costKind: v.costKind ?? null, ...(!isBaseCurrency(currency) ? { currency, fxRateMicro: fxMicro, fxSource, netBaseMinor: netTry } : {}) } }),
  ]
  let assets = 0
  const toCreate = v.direction === 'in' && v.toInventory ? v.items.reduce((s, it) => s + it.qty, 0) : 0
  if (toCreate > 200) return fail(t('server.invoices.tooManyAssets'), 'items')
  if (v.direction === 'in') {
    v.items.forEach((it, i) => {
      const itemId = ulid()
      stmts.push(
        db
          .prepare(`INSERT INTO invoice_items (id, invoice_id, line_no, description, quantity, serial_no, to_inventory, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(itemId, id, i + 1, it.name, it.qty, it.qty === 1 ? (it.serial ?? null) : null, v.toInventory ? 1 : 0, user.id, user.id),
      )
      if (v.toInventory && authorize(user, { a: 'asset.write' }).ok) {
        for (let n = 0; n < it.qty; n++) {
          stmts.push(
            db
              .prepare(`INSERT INTO assets (id, name, serial_no, condition, invoice_item_id, acquired_on, created_by, updated_by) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`)
              .bind(ulid(), it.name, it.qty === 1 ? (it.serial ?? null) : null, itemId, v.date, user.id, user.id),
          )
          assets++
        }
      }
    })
  }
  if (v.links?.length) stmts.push(...linkStatements(db, user.id, id, v.links, false, await targetNames(db, user, v.links)))
  if (ap.status === 'pending') stmts.push(...(await invoicePendingMails(db, { id, uploadedBy: user.id, firm, no: v.no.trim(), totalMinor: netTry + vatTry })))
  const same = (await db.prepare(`SELECT counterparty FROM invoices WHERE direction = ? AND invoice_no = ? AND archived_at IS NULL`).bind(v.direction, v.no.trim()).all<{ counterparty: string }>()).results
  if (same.some((s) => normalizeFirm(s.counterparty) === normalizeFirm(firm))) return fail(t('server.invoices.duplicate'), 'no')

  const err = await commit(ctx, stmts, [file], {
    invoice_duplicate: fail(t('server.invoices.duplicate'), 'no'),
    unique: fail(t('server.invoices.serialExists'), 'items'),
    link_target: fail(t('server.invoices.linkTarget'), 'links'),
  })
  if (err) return err
  if (ap.auto) {
    try {
      const acct = await approvedInvoiceMail(db, id, null, today(ctx))
      if (acct) await db.batch([acct])
    } catch (e) {
      console.error(JSON.stringify({ at: 'accounting-enqueue', invoice: id, error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }))
    }
  }
  const row = await db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).bind(id).first<InvoiceRow>()
  const items = await invoiceItems(ctx, { id })
  return { ok: true, invoice: toInvoice(row!, items.get(id) ?? [], (await invoiceLinkNames(ctx, { id })).get(id) ?? []), assets }
}

interface EditRow {
  id: string
  approval_status: 'pending' | 'approved' | 'rejected'
  decided_by: string | null
  direction: 'in' | 'out'
  invoice_no: string
  counterparty: string
  invoice_date: string
  due_on: string | null
  currency: Currency
  fx_rate_micro: number
  vat_rate_bp: number | null
  net_minor: number
  vat_minor: number
  net_base_minor: number
  vat_base_minor: number
  cost_kind: 'direct' | 'overhead' | null
  settled_on: string | null
  uploaded_by: string
  version: number
  archived_at: string | null
}

const snapOf = (r: { firm: string; no: string; date: string; currency: Currency; netMinor: number; vatRate: number; fxMicro: number; due: string | null; costKind: 'direct' | 'overhead' | null }): Required<InvoiceSnap> => ({
  firm: r.firm, no: r.no, date: r.date, currency: r.currency, net: r.netMinor / 100, vatRate: r.vatRate, fxRate: r.fxMicro / 1e6, due: r.due, costKind: r.costKind,
})

export async function updateInvoice(ctx: Ctx, input: unknown): Promise<{ ok: true; invoice: Invoice } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'invoice.update' })
  const p = parsed(invoiceEditSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  const row = await db
    .prepare(`SELECT id, direction, invoice_no, counterparty, invoice_date, due_on, currency, fx_rate_micro, vat_rate_bp, net_minor, vat_minor, net_base_minor, vat_base_minor, cost_kind, settled_on, uploaded_by, version, archived_at, approval_status, decided_by FROM invoices WHERE id = ?`)
    .bind(v.id)
    .first<EditRow>()
  if (!row) return fail(t('server.invoices.notFound'))
  if (row.archived_at) return fail(t('server.invoices.archived'))
  if (row.direction === 'in' && row.approval_status === 'approved' && row.decided_by && user.role !== 'approver') return fail(t('server.invoices.approvedCoordOnly'))
  const STALE = t('server.invoices.stale')
  if (row.version !== v.version) return fail(STALE)
  if (v.date > today(ctx)) return fail(t('server.invoices.futureInvoice'), 'date')
  if (row.direction === 'out') {
    if (!v.due) return fail(t('server.invoices.dueRequired'), 'due')
    if (v.due < v.date) return fail(t('server.invoices.dueBeforeDate'), 'due')
  } else if (!v.costKind) return fail(t('server.invoices.costKind'), 'costKind')
  if (row.settled_on && v.date > row.settled_on) return fail(t('server.invoices.afterSettled'), 'date')

  const firm = v.firm.trim().replace(/\s+/g, ' ')
  const no = v.no.trim()
  const net = toMinor(round2(v.net))
  const vat = Math.round((net * v.vatRate) / 100)
  const due = row.direction === 'out' ? (v.due ?? null) : null
  const costKind = row.direction === 'in' ? (v.costKind ?? null) : null
  const dateChanged = v.date !== row.invoice_date
  const currencyChanged = v.currency !== row.currency
  const amountChanged = net !== row.net_minor || vat !== row.vat_minor
  let fxMicro = row.fx_rate_micro
  let fxSource: 'tcmb' | 'ecb' | 'manual' | null = null
  if ((v.vatRate !== (row.vat_rate_bp ?? 0) / 100)) {
    const vatErr = await vatRateError(db, v.vatRate)
    if (vatErr) return vatErr
  }
  if (isBaseCurrency(v.currency)) fxMicro = 1_000_000
  else if (v.fxRate) {
    fxMicro = Math.round(v.fxRate * 1e6)
    fxSource = 'manual'
  } else if (dateChanged || currencyChanged || amountChanged) {
    const r = await rateOn(v.date, v.currency, ctx.fetcher ?? fetch)
    if (!r) return fail(t('server.invoices.fxMissing', { currency: currencyLabel(runtimeConfig().baseCurrency) }), 'fxRate')
    fxMicro = Math.round(r.rate * 1e6)
    fxSource = r.source
  }
  const rateChanged = fxMicro !== row.fx_rate_micro
  const recompute = currencyChanged || amountChanged || rateChanged
  const netTry = !recompute ? row.net_base_minor : isBaseCurrency(v.currency) ? net : toBaseMinor(net, fxMicro)
  const vatTry = !recompute ? row.vat_base_minor : isBaseCurrency(v.currency) ? vat : toBaseMinor(vat, fxMicro)

  const was = snapOf({ firm: row.counterparty, no: row.invoice_no, date: row.invoice_date, currency: row.currency, netMinor: row.net_minor, vatRate: (row.vat_rate_bp ?? 0) / 100, fxMicro: row.fx_rate_micro, due: row.due_on, costKind: row.cost_kind })
  const now = snapOf({ firm, no, date: v.date, currency: v.currency, netMinor: net, vatRate: v.vatRate, fxMicro, due, costKind })
  const changed = (Object.keys(now) as (keyof typeof now)[]).filter((k) => was[k] !== now[k])
  if (changed.length === 0) {
    const same = await db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).bind(v.id).first<InvoiceRow>()
    return { ok: true, invoice: toInvoice(same!, (await invoiceItems(ctx, { id: v.id })).get(v.id) ?? [], (await invoiceLinkNames(ctx, { id: v.id })).get(v.id) ?? []) }
  }
  const before: InvoiceSnap = {}
  const after: InvoiceSnap = {}
  for (const k of changed) {
    ;(before as Record<string, unknown>)[k] = was[k]
    ;(after as Record<string, unknown>)[k] = now[k]
  }
  if (changed.some((k) => k === 'net' || k === 'currency')) {
    before.currency = was.currency
    after.currency = now.currency
  }

  const same = (await db.prepare(`SELECT counterparty FROM invoices WHERE id <> ? AND direction = ? AND invoice_no = ? AND archived_at IS NULL`).bind(v.id, row.direction, no).all<{ counterparty: string }>()).results
  if (same.some((s) => normalizeFirm(s.counterparty) === normalizeFirm(firm))) return fail(t('server.invoices.duplicate'), 'no')

  const nowIso_ = nowIso()
  const crosses = row.direction === 'in' && dateChanged && isBeforeBooks(row.invoice_date) !== isBeforeBooks(v.date)
  if (crosses && user.role !== 'approver') return fail(t('server.invoices.crossBooks', { date: formatDate(booksStart()) }), 'date')
  if (crosses && row.approval_status === 'rejected') return fail(t('server.invoices.rejectedPeriod'), 'date')
  const ap = crosses ? { status: 'approved' as const, auto: (!isBeforeBooks(v.date) ? 1 : 0) as 0 | 1, decidedBy: user.id, decidedAt: nowIso_ } : null
  const extra: Stmt[] = ap ? [consumeTokens(db, 'invoice', v.id, nowIso_)] : []
  const err = await commit(
    ctx,
    [
      assertion(db, 'invoice_stale', `NOT EXISTS (SELECT 1 FROM invoices WHERE id = ? AND version = ? AND archived_at IS NULL)`, v.id, v.version),
      assertion(db, 'invoice_duplicate', `EXISTS (SELECT 1 FROM invoices WHERE id <> ? AND direction = ? AND archived_at IS NULL AND invoice_no = ? AND lower(counterparty) = lower(?))`, v.id, row.direction, no, firm),
      db
        .prepare(
          `UPDATE invoices SET invoice_no = ?, counterparty = ?, invoice_date = ?, due_on = ?, currency = ?, fx_rate_micro = ?, vat_rate_bp = ?, net_minor = ?, vat_minor = ?, net_base_minor = ?, vat_base_minor = ?, cost_kind = ?,
           updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ? AND archived_at IS NULL`,
        )
        .bind(no, firm, v.date, due, v.currency, fxMicro, v.vatRate * 100, net, vat, netTry, vatTry, costKind, nowIso_, user.id, v.id, v.version),
      ...(ap
        ? [
            db
              .prepare(`UPDATE invoices SET approval_status = ?, auto_approved = ?, decided_by = ?, decided_at = ?, decision_note = NULL WHERE id = ?`)
              .bind(ap.status, ap.auto, ap.decidedBy, ap.decidedAt, v.id),
          ]
        : []),
      audit(db, { actorId: user.id, action: 'invoice.update', entityType: 'invoice', entityId: v.id, before, after, meta: { ...(fxSource ? { fxSource } : {}), ...(ap ? { approval: { from: row.approval_status, to: ap.status } } : {}) } }),
      ...extra,
    ],
    [],
    {
      invoice_stale: fail(STALE),
      invoice_duplicate: fail(t('server.invoices.duplicate'), 'no'),
      unique: fail(t('server.invoices.duplicate'), 'no'),
    },
  )
  if (err) return err
  if (ap?.auto) {
    try {
      const acct = await approvedInvoiceMail(db, v.id, null, today(ctx))
      if (acct) await db.batch([acct])
    } catch (e) {
      console.error(JSON.stringify({ at: 'accounting-enqueue', invoice: v.id, error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }))
    }
  }
  const out = await db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).bind(v.id).first<InvoiceRow>()
  return { ok: true, invoice: toInvoice(out!, (await invoiceItems(ctx, { id: v.id })).get(v.id) ?? [], (await invoiceLinkNames(ctx, { id: v.id })).get(v.id) ?? []) }
}

export interface InvoiceHistory {
  entries: { at: string; who: string; text: string }[]
  mailed: { month: string; state: 'sent' | 'queued' } | null
}

export async function invoiceHistory(ctx: Ctx, id: string): Promise<InvoiceHistory> {
  const { db, user } = ctx
  const inv = await db.prepare(`SELECT uploaded_by, direction, invoice_no, counterparty FROM invoices WHERE id = ?`).bind(id).first<{ uploaded_by: string; direction: 'in' | 'out'; invoice_no: string; counterparty: string }>()
  if (!inv) throw new HttpError(404, t('server.notFound'))
  must(user, { a: 'invoice.read', uploadedBy: inv.uploaded_by })
  const rows = (
    await db
      .prepare(
        `SELECT a.at, a.action, a.before_json, a.after_json, COALESCE(u.full_name, a.actor_email, ?) AS who
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.entity_type = 'invoice' AND a.entity_id = ? AND a.action IN ('invoice.create','invoice.update','invoice.settle','invoice.link','invoice.unlink')
         ORDER BY a.at, a.rowid`,
      )
      .bind(t('server.system'), id)
      .all<{ at: string; action: string; before_json: string | null; after_json: string | null; who: string }>()
  ).results
  const kindName = (k: unknown) => t(k === 'asset' || k === 'digital' || k === 'job' ? `server.invoices.history.kinds.${k}` : 'server.invoices.history.kinds.record')
  const entries: InvoiceHistory['entries'] = []
  const linkName = async (snap: Record<string, unknown>): Promise<string | null> => {
    if (!(snap.kind === 'asset' || snap.kind === 'digital' || snap.kind === 'job')) return null
    if (!authorize(user, snap.kind === 'job' ? { a: 'jobs.read' } : { a: 'asset.read' }).ok) return null
    if (typeof snap.name === 'string' && snap.name) return snap.name
    if (typeof snap.id !== 'string') return null
    return (await targetNames(db, user, [{ kind: snap.kind, id: snap.id }])).get(`${snap.kind}:${snap.id}`) ?? null
  }
  let state = { firm: inv.counterparty, no: inv.invoice_no }
  const states: { firm: string; no: string }[] = []
  for (const r of rows) {
    const b = (r.before_json ? JSON.parse(r.before_json) : {}) as Record<string, unknown>
    const a = (r.after_json ? JSON.parse(r.after_json) : {}) as Record<string, unknown>
    let text = ''
    if (r.action === 'invoice.create') {
      text = t('server.invoices.history.uploaded')
      state = { firm: String(a.firm ?? state.firm), no: String(a.no ?? state.no) }
      states.push({ ...state })
    } else if (r.action === 'invoice.update') {
      text = describeInvoiceChange(b as InvoiceSnap, a as InvoiceSnap)
      state = { firm: String(a.firm ?? state.firm), no: String(a.no ?? state.no) }
      states.push({ ...state })
    } else if (r.action === 'invoice.settle') {
      text = a.settledOn ? t('server.invoices.history.settled', { date: formatDayLong(String(a.settledOn)) }) : t('server.invoices.history.unsettled')
    } else if (r.action === 'invoice.link') {
      const n = await linkName(a)
      text = n ? t('server.invoices.history.linked', { name: n, kind: kindName(a.kind) }) : t('server.invoices.history.linkedAnon', { kind: kindName(a.kind) })
    } else {
      const n = await linkName(b)
      text = n ? t('server.invoices.history.unlinked', { name: n, kind: kindName(b.kind) }) : t('server.invoices.history.unlinkedAnon', { kind: kindName(b.kind) })
    }
    if (text) entries.push({ at: r.at, who: r.who, text })
  }
  entries.reverse()

  let mailed: InvoiceHistory['mailed'] = null
  if (inv.direction === 'in') {
    const direct = await db
      .prepare(`SELECT status, created_at FROM accounting_outbox WHERE dedupe_key = ? AND status IN ('sent','queued')`)
      .bind(`acct:invoice:${id}`)
      .first<{ status: 'sent' | 'queued'; created_at: string }>()
    if (direct) mailed = { month: direct.created_at.slice(0, 7), state: direct.status }
    const cands = mailed ? [] : states.length ? states : [{ firm: inv.counterparty, no: inv.invoice_no }]
    for (const c of cands) {
      const hit = await db
        .prepare(
          `SELECT dedupe_key, status FROM accounting_outbox
           WHERE kind = 'invoice_uploaded' AND (dedupe_key LIKE 'acct:invoices_month:%' OR dedupe_key LIKE 'acct:invoices_monthend:%') AND status IN ('sent','queued') AND instr(body_text, ?) > 0
           ORDER BY (status = 'sent') DESC, created_at LIMIT 1`,
        )
        .bind(`Firma: ${c.firm}\nFatura No: ${c.no}\n`)
        .first<{ dedupe_key: string; status: 'sent' | 'queued' }>()
      if (hit) {
        mailed = { month: hit.dedupe_key.split(':')[2], state: hit.status }
        break
      }
    }
  }
  return { entries, mailed }
}

const formatDayLong = (iso: string) => `${Number(iso.slice(8))} ${monthLong(Number(iso.slice(5, 7)))} ${iso.slice(0, 4)}`

interface AgreementRow {
  id: string
  counterparty: string
  title: string
  start_date: string
  end_date: string | null
  amount_minor: number | null
  amount_period: Agreement['period'] | null
  tag: string | null
  note: string | null
}

const AG_COLS = 'id, counterparty, title, start_date, end_date, amount_minor, amount_period, tag, note'

const toAgreement = (r: AgreementRow, pdf?: { id: string; name: string }): Agreement => ({
  id: r.id,
  counterparty: r.counterparty,
  title: r.title,
  start: r.start_date,
  end: r.end_date,
  amount: (r.amount_minor ?? 0) / 100,
  period: r.amount_period ?? 'yearly',
  tag: r.tag ?? '',
  note: r.note ?? '',
  pdfName: pdf?.name ?? '',
  pdfId: pdf?.id,
})

export async function listAgreements(ctx: Ctx): Promise<Agreement[]> {
  must(ctx.user, { a: 'agreement.read' })
  const rows = (await ctx.db.prepare(`SELECT ${AG_COLS} FROM agreements WHERE archived_at IS NULL ORDER BY end_date IS NULL, end_date`).all<AgreementRow>()).results
  return rows.map((r) => toAgreement(r))
}

export async function getAgreement(ctx: Ctx, id: string): Promise<Agreement | null> {
  must(ctx.user, { a: 'agreement.read' })
  const r = await ctx.db.prepare(`SELECT ${AG_COLS} FROM agreements WHERE id = ? AND archived_at IS NULL`).bind(id).first<AgreementRow>()
  if (!r) return null
  const [pdf] = await attachmentsOf(ctx.db, 'agreement_id', id)
  return toAgreement(r, pdf)
}

export async function createAgreement(ctx: Ctx, input: FormInput): Promise<{ ok: true; agreement: Agreement } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'agreement.write' })
  const p = parsed(agreementSchema, input.json)
  if (!p.ok) return p.res
  const v = p.data
  let file: PreparedFile
  try {
    file = (await fileFrom((input.json as { file?: unknown }).file, input.files, 'pdfName', { required: true, pdfOnly: true }))!
  } catch (e) {
    return fileError(e)
  }
  const id = ulid()
  const amount = toMinor(round2(v.amount))
  const err = await commit(
    ctx,
    [
      db
        .prepare(`INSERT INTO agreements (id, title, counterparty, start_date, end_date, amount_minor, currency, amount_period, tag, note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, v.title, v.counterparty, v.start, v.end, amount, baseCurrency(), v.period, v.tag || null, v.note || null, user.id, user.id),
      insertAttachment(db, file, 'agreement_file', { agreementId: id }, user.id),
      audit(db, { actorId: user.id, action: 'agreement.create', entityType: 'agreement', entityId: id, after: { counterparty: v.counterparty, title: v.title, start: v.start, end: v.end, amount } }),
    ],
    [file],
  )
  if (err) return err
  return { ok: true, agreement: (await getAgreement(ctx, id))! }
}

interface AssetRow {
  id: string
  name: string
  serial_no: string | null
  condition: Asset['condition']
  acquired_on: string | null
  note: string | null
  category: string | null
  quantity: number
  source: string | null
  invoice_id: string | null
  invoice_no: string | null
  invoice_firm: string | null
  invoice_date: string | null
  holder_other: string | null
  holder_other_on: string | null
}

const ASSET_SELECT = `SELECT s.id, s.name, s.serial_no, s.condition, s.acquired_on, s.note, s.category, s.quantity, s.source, s.holder_other, s.holder_other_on,
    i.id AS invoice_id, i.invoice_no, i.counterparty AS invoice_firm, i.invoice_date
  FROM assets s LEFT JOIN invoice_items ii ON ii.id = s.invoice_item_id LEFT JOIN invoices i ON i.id = ii.invoice_id`

async function assetsWithHistory(ctx: Ctx, rows: AssetRow[], one?: string): Promise<Asset[]> {
  if (!rows.length) return []
  const hist = (
    await ctx.db
      .prepare(
        `SELECT g.asset_id, g.user_id, u.display_name, g.assigned_on, g.returned_on, g.return_confirmed_at, g.disputed_at, g.dispute_note, g.note FROM assignments g JOIN users u ON u.id = g.user_id
         WHERE ${one ? 'g.asset_id = ?' : 'g.asset_id IN (SELECT id FROM assets WHERE archived_at IS NULL)'} ORDER BY g.assigned_on, g.created_at`,
      )
      .bind(...(one ? [one] : []))
      .all<{ asset_id: string; user_id: string; display_name: string; assigned_on: string; returned_on: string | null; return_confirmed_at: string | null; disputed_at: string | null; dispute_note: string | null; note: string | null }>()
  ).results
  const office = (await ctx.db.prepare(`SELECT display_name FROM users WHERE is_admin = 1 AND status = 'active' ORDER BY created_at LIMIT 1`).first<{ display_name: string }>())?.display_name ?? ''
  return rows.map((r) => {
    const history = hist.filter((h) => h.asset_id === r.id).map((h) => ({ userId: h.user_id, userName: h.display_name, from: h.assigned_on, to: h.returned_on, returnConfirmedAt: h.return_confirmed_at, disputedAt: h.disputed_at, disputeNote: h.dispute_note ?? '', note: h.note ?? '' }))
    return {
      id: r.id,
      name: r.name,
      serial: r.serial_no ?? '',
      condition: r.condition,
      acquiredOn: r.acquired_on ?? '',
      invoiceId: r.invoice_id ?? undefined,
      invoice: r.invoice_id ? { id: r.invoice_id, no: r.invoice_no ?? '', firm: r.invoice_firm ?? '', date: r.invoice_date ?? '' } : undefined,
      note: r.note ?? '',
      category: r.category ?? '',
      quantity: r.quantity,
      source: r.source ?? '',
      history,
      holderOther: r.holder_other ?? '',
      holderOtherOn: r.holder_other_on ?? '',
      officeHolder: office,
      officeOn: r.holder_other ? '' : (r.holder_other_on ?? history.filter((h) => h.to).map((h) => h.to as string).sort().pop() ?? ''),
      holderName: history.find((h) => h.to === null)?.userName ?? r.holder_other ?? '—',
    }
  })
}

export async function listAssets(ctx: Ctx): Promise<Asset[]> {
  must(ctx.user, { a: 'asset.read' })
  const [list, links] = await Promise.all([
    assetsWithHistory(ctx, (await ctx.db.prepare(`${ASSET_SELECT} WHERE s.archived_at IS NULL ORDER BY s.created_at DESC`).all<AssetRow>()).results),
    linkedInvoices(ctx, 'asset'),
  ])
  return links ? list.map((a) => ({ ...a, hasInvoice: links.has(a.id) })) : list
}

export async function getAsset(ctx: Ctx, id: string): Promise<Asset | null> {
  must(ctx.user, { a: 'asset.read' })
  const r = await ctx.db.prepare(`${ASSET_SELECT} WHERE s.id = ? AND s.archived_at IS NULL`).bind(id).first<AssetRow>()
  if (!r) return null
  const a = (await assetsWithHistory(ctx, [r], id))[0]
  const links = await linkedInvoices(ctx, 'asset', id)
  return links ? { ...a, invoices: links.get(id) ?? [], hasInvoice: links.has(id) } : a
}

export async function assignableUsers(ctx: Ctx) {
  must(ctx.user, { a: 'asset.write' })
  return (await allUsers(ctx.db)).filter((u) => u.status === 'active').map((u) => ({ id: u.id, displayName: u.display_name }))
}

export async function createAsset(ctx: Ctx, input: unknown): Promise<{ ok: true; asset: Asset } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'asset.write' })
  const p = parsed(assetSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  if (v.serial) {
    const taken = (await db.prepare(`SELECT serial_no FROM assets WHERE serial_no IS NOT NULL AND archived_at IS NULL`).all<{ serial_no: string }>()).results
    if (taken.some((t) => t.serial_no.toLocaleLowerCase('tr') === v.serial!.toLocaleLowerCase('tr'))) return fail(t('server.assets.serialExists'), 'serial')
  }
  const id = ulid()
  const err = await commit(
    ctx,
    [
      db
        .prepare(`INSERT INTO assets (id, name, serial_no, condition, acquired_on, note, category, quantity, source, created_by, updated_by) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, v.name, v.serial || null, v.acquiredOn, v.note || null, v.category || null, v.serial ? 1 : v.quantity, v.source || null, user.id, user.id),
      audit(db, { actorId: user.id, action: 'asset.create', entityType: 'asset', entityId: id, after: { name: v.name, serial: v.serial ?? null, category: v.category ?? null, quantity: v.serial ? 1 : v.quantity, source: v.source ?? null } }),
    ],
    [],
    { unique: fail(t('server.assets.serialExists'), 'serial') },
  )
  if (err) return err
  return { ok: true, asset: (await getAsset(ctx, id))! }
}

export async function assignAsset(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'asset.write' })
  const p = parsed(assignSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  if (v.date > today(ctx)) return fail(t('server.assets.futureHandover'), 'date')
  const id = ulid()
  const notStock = assertion(db, 'asset_not_stock', `EXISTS (SELECT 1 FROM assets WHERE id = ? AND (condition <> 'active' OR holder_other IS NOT NULL)) OR EXISTS (SELECT 1 FROM assignments WHERE asset_id = ? AND returned_on IS NULL)`, v.assetId, v.assetId)
  if (!v.userId && v.other) {
    const e = await commit(
      ctx,
      [
        assertion(db, 'asset_missing', `NOT EXISTS (SELECT 1 FROM assets WHERE id = ? AND archived_at IS NULL)`, v.assetId),
        notStock,
        db.prepare(`UPDATE assets SET holder_other = ?, holder_other_on = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(v.other, v.date, nowIso(), user.id, v.assetId),
        audit(db, { actorId: user.id, action: 'asset.holder_other', entityType: 'asset', entityId: v.assetId, after: { other: v.other, date: v.date, note: v.note } }),
      ],
      [],
      { asset_missing: fail(t('server.assets.notFound')), asset_not_stock: fail(t('server.assets.officeOnlyGive')) },
    )
    return e ?? { ok: true }
  }
  const err = await commit(
    ctx,
    [
      assertion(db, 'asset_missing', `NOT EXISTS (SELECT 1 FROM assets WHERE id = ? AND archived_at IS NULL)`, v.assetId),
      notStock,
      assertion(db, 'user_inactive', `NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`, v.userId!),
      assertion(db, 'before_last', `EXISTS (SELECT 1 FROM assignments WHERE asset_id = ? AND returned_on > ?)`, v.assetId, v.date),
      db.prepare(`INSERT INTO assignments (id, asset_id, user_id, assigned_on, note, assigned_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, v.assetId, v.userId, v.date, v.note || null, user.id, user.id),
      audit(db, { actorId: user.id, action: 'assignment.create', entityType: 'assignment', entityId: id, after: { asset: v.assetId, user: v.userId, date: v.date } }),
    ],
    [],
    {
      asset_missing: fail(t('server.assets.notFound')),
      asset_not_stock: fail(t('server.assets.officeOnlyAssign')),
      user_inactive: fail(t('server.assets.personInactive'), 'userId'),
      before_last: fail(t('server.assets.beforePrevious'), 'date'),
      unique: fail(t('server.assets.justAssigned')),
    },
  )
  return err ?? { ok: true }
}

export async function returnAsset(ctx: Ctx, assetId: string): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'asset.write' })
  const day = today(ctx)
  const err = await commit(ctx, [
    assertion(db, 'not_assigned', `NOT EXISTS (SELECT 1 FROM assignments WHERE asset_id = ? AND returned_on IS NULL) AND NOT EXISTS (SELECT 1 FROM assets WHERE id = ? AND holder_other IS NOT NULL)`, assetId, assetId),
    db
      .prepare(`UPDATE assignments SET returned_on = MAX(assigned_on, ?), returned_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE asset_id = ? AND returned_on IS NULL`)
      .bind(day, user.id, nowIso(), user.id, assetId),
    db.prepare(`UPDATE assets SET holder_other = NULL, holder_other_on = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(day, nowIso(), user.id, assetId),
    audit(db, { actorId: user.id, action: 'assignment.return', entityType: 'asset', entityId: assetId, after: { returnedOn: day } }),
  ], [], { not_assigned: fail(t('server.assets.notAssigned')) })
  return err ?? { ok: true }
}

export async function toOffice(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'asset.write' })
  const p = z.object({ id: z.string().length(26), date: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), t('server.assets.pickDate')) }).safeParse(input)
  if (!p.success) return fail(t('server.assets.pickDate'), 'date')
  const { id, date } = p.data
  if (date > today(ctx)) return fail(t('server.assets.noFutureDate'), 'date')
  const now = nowIso()
  const err = await commit(ctx, [
    assertion(db, 'missing', `NOT EXISTS (SELECT 1 FROM assets WHERE id = ? AND archived_at IS NULL)`, id),
    assertion(db, 'before', `EXISTS (SELECT 1 FROM assignments WHERE asset_id = ? AND assigned_on > ?)`, id, date),
    db.prepare(`UPDATE assignments SET returned_on = ?, returned_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE asset_id = ? AND returned_on IS NULL`).bind(date, user.id, now, user.id, id),
    db
      .prepare(
        `UPDATE assignments SET returned_on = ?, updated_at = ?, updated_by = ?, version = version + 1
         WHERE id = (SELECT id FROM assignments WHERE asset_id = ? ORDER BY assigned_on DESC, created_at DESC LIMIT 1) AND returned_on IS NOT NULL AND returned_on <> ?
           AND NOT EXISTS (SELECT 1 FROM assets WHERE id = ? AND holder_other IS NOT NULL)`,
      )
      .bind(date, now, user.id, id, date, id),
    db.prepare(`UPDATE assets SET holder_other = NULL, holder_other_on = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(date, now, user.id, id),
    audit(db, { actorId: user.id, action: 'asset.to_office', entityType: 'asset', entityId: id, after: { date } }),
  ], [], { missing: fail(t('server.assets.notFound')), before: fail(t('server.assets.beforeHandover'), 'date') })
  return err ?? { ok: true }
}

export async function updateAsset(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'asset.write' })
  const p = parsed(assetEditSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  const before = await db.prepare(`SELECT name, category, serial_no, quantity, source, condition, note, acquired_on FROM assets WHERE id = ? AND archived_at IS NULL`).bind(v.id).first()
  if (!before) throw new HttpError(404, t('server.recordNotFound'))
  if (v.serial) {
    const taken = (await db.prepare(`SELECT serial_no FROM assets WHERE serial_no IS NOT NULL AND archived_at IS NULL AND id <> ?`).bind(v.id).all<{ serial_no: string }>()).results
    if (taken.some((t) => t.serial_no.toLocaleLowerCase('tr') === v.serial!.toLocaleLowerCase('tr'))) return fail(t('server.assets.serialExists'), 'serial')
  }
  const qty = v.serial ? 1 : v.quantity
  const err = await commit(
    ctx,
    [
      ...(v.condition !== 'active'
        ? [assertion(db, 'assigned', `EXISTS (SELECT 1 FROM assignments WHERE asset_id = ? AND returned_on IS NULL)`, v.id)]
        : []),
      db
        .prepare(
          `UPDATE assets SET name = ?, category = ?, serial_no = ?, quantity = ?, source = ?, condition = ?, note = ?, acquired_on = ?, updated_at = ?, updated_by = ?, version = version + 1
           WHERE id = ? AND archived_at IS NULL`,
        )
        .bind(v.name, v.category || null, v.serial || null, qty, v.source || null, v.condition, v.note || null, v.acquiredOn || null, nowIso(), user.id, v.id),
      audit(db, { actorId: user.id, action: 'asset.update', entityType: 'asset', entityId: v.id, before, after: { name: v.name, category: v.category ?? null, serial: v.serial ?? null, quantity: qty, source: v.source ?? null, condition: v.condition } }),
    ],
    [],
    { assigned: fail(t('server.assets.assignedNoRetire'), 'condition'), unique: fail(t('server.assets.serialExists'), 'serial') },
  )
  return err ?? { ok: true }
}

export async function personInventory(ctx: Ctx, userId: string) {
  must(ctx.user, { a: 'asset.read' })
  const person = await ctx.db.prepare(`SELECT id, display_name, role, can_login, status FROM users WHERE id = ?`).bind(userId).first<{ id: string; display_name: string; role: Role; can_login: number; status: string }>()
  if (!person) return null
  const [assets, digital, fx] = await Promise.all([listAssets(ctx), listDigital(ctx), fxRates(ctx.db)])
  const share = (d: DigitalAsset) => {
    if (d.period === 'free' || d.period === 'one_time' || d.cost == null) return null
    const m = monthlyBase(d.period, d.cost, d.currency, fx)
    return m == null ? null : m / Math.max(1, d.users.length)
  }
  const seats = digital.filter((d) => d.users.some((u) => u.id === userId)).map((d) => ({ ...d, monthlyShare: share(d) }))
  const live = seats.filter((d) => d.status === 'active' && d.monthlyShare != null)
  return {
    person: { id: person.id, displayName: person.display_name, role: person.role, canLogin: person.can_login === 1, active: person.status === 'active' },
    holding: assets.filter((a) => a.history.some((h) => h.userId === userId && h.to === null)),
    past: assets.flatMap((a) => a.history.filter((h) => h.userId === userId && h.to !== null).map((h) => ({ assetId: a.id, name: a.name, from: h.from, to: h.to as string }))).sort((x, y) => y.to.localeCompare(x.to)),
    seats,
    seatTotal: { monthly: live.reduce((t, d) => t + (d.monthlyShare ?? 0), 0), missingFx: seats.filter((d) => d.status === 'active' && d.cost != null && d.period !== 'free' && d.period !== 'one_time' && d.monthlyShare == null).length },
    owned: digital.filter((d) => d.ownerId === userId),
    stock: assets.filter((a) => a.condition === 'active' && !a.history.some((h) => h.to === null)).map((a) => ({ id: a.id, name: a.name, category: a.category, quantity: a.quantity, serial: a.serial })),
    openSeats: digital
      .filter((d) => d.status === 'active' && !d.users.some((u) => u.id === userId))
      .map((d) => ({ id: d.id, name: d.name, plan: d.plan, free: d.seats == null ? null : Math.max(0, d.seats - d.users.length) })),
  }
}

export async function setDigitalSeat(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'asset.write' })
  const p = parsed(seatSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  const now = nowIso()
  const err = await commit(
    ctx,
    v.on
      ? [
          assertion(db, 'missing', `NOT EXISTS (SELECT 1 FROM digital_assets WHERE id = ? AND status = 'active')`, v.assetId),
          assertion(db, 'user_inactive', `NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`, v.userId),
          db
            .prepare(`INSERT INTO digital_asset_users (asset_id, user_id) VALUES (?, ?) ON CONFLICT (asset_id, user_id) DO UPDATE SET removed_at = NULL, added_at = CASE WHEN removed_at IS NULL THEN added_at ELSE ? END`)
            .bind(v.assetId, v.userId, now),
          audit(db, { actorId: user.id, action: 'digital.seat.add', entityType: 'asset', entityId: v.assetId, after: { user: v.userId } }),
        ]
      : [
          db.prepare(`UPDATE digital_asset_users SET removed_at = ? WHERE asset_id = ? AND user_id = ? AND removed_at IS NULL`).bind(now, v.assetId, v.userId),
          audit(db, { actorId: user.id, action: 'digital.seat.remove', entityType: 'asset', entityId: v.assetId, after: { user: v.userId } }),
        ],
    [],
    { missing: fail(t('server.recordNotFound')), user_inactive: fail(t('server.assets.personNotActive')) },
  )
  return err ?? { ok: true }
}

interface UserListRow {
  id: string
  email: string
  display_name: string
  role: Role
  is_admin: number
  can_upload_invoices: number
  can_manage_jobs: number
  avatar_hue: number | null
  status: 'pending' | 'active' | 'inactive'
  can_login: number
  department: string | null
  entitled_days: number | null
  email_verified_at: string | null
}

const toAppUser = (r: UserListRow): AppUser => ({
  id: r.id,
  displayName: r.display_name,
  email: r.email,
  role: r.role,
  isAdmin: r.is_admin === 1,
  canUploadInvoices: r.can_upload_invoices === 1,
  canManageJobs: r.can_manage_jobs === 1,
  avatarHue: r.avatar_hue ?? 220,
  status: r.status,
  leaveEntitlement: r.entitled_days ?? 0,
  canLogin: r.can_login === 1,
  department: r.department ?? '',
  emailVerified: !!r.email_verified_at,
})

const USER_LIST = `SELECT u.id, u.email, u.display_name, u.role, u.is_admin, u.can_upload_invoices, u.can_manage_jobs, u.avatar_hue, u.status, u.can_login, u.department, u.email_verified_at, e.entitled_days
  FROM users u LEFT JOIN leave_entitlements e ON e.user_id = u.id AND e.year = ?`

export async function listUsers(ctx: Ctx): Promise<AppUser[]> {
  must(ctx.user, { a: 'user.manage' })
  const year = Number(today(ctx).slice(0, 4))
  return (await ctx.db.prepare(`${USER_LIST} ORDER BY CASE u.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, u.display_name`).bind(year).all<UserListRow>()).results.map(toAppUser)
}

const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

export async function saveUser(ctx: Ctx, input: unknown, emailDomain: string, opts: { mailDelivers?: boolean } = {}): Promise<{ ok: true; user: AppUser; warning?: string } | Fail> {
  const { db, user: actor } = ctx
  must(actor, { a: 'user.manage' })
  const p = parsed(userSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  const mail = v.canLogin ? checkEmailDomain(v.email, emailDomain) : { ok: true as const, warning: undefined }
  if (!mail.ok) return fail(mail.error ?? t('server.users.invalidEmail'), 'email')
  if (!v.canLogin && v.id === actor.id) return fail(t('server.users.ownLogin'), 'canLogin')
  if (v.id === actor.id) {
    if (!v.isAdmin) return fail(t('server.users.ownAdmin'), 'isAdmin')
    if (v.status === 'inactive') return fail(t('server.users.ownDeactivate'), 'status')
  }
  const year = Number(today(ctx).slice(0, 4))
  const now = nowIso()
  const role = v.role
  const canUpload = v.role === 'employee' && v.canUploadInvoices ? 1 : 0
  const canJobs = v.role === 'employee' && v.canManageJobs ? 1 : 0
  const prev = v.id ? await db.prepare(`${USER_LIST} WHERE u.id = ?`).bind(year, v.id).first<UserListRow>() : null
  if (v.id && !prev) throw new HttpError(404, t('server.recordNotFound'))
  if (prev && v.id === actor.id && prev.role !== role) return fail(t('server.users.ownRole'), 'role')
  const id = prev?.id ?? ulid()
  const email = v.canLogin ? normalizeEmail(v.email) : v.email ? normalizeEmail(v.email) : (prev && prev.can_login === 0 ? prev.email : `${id.toLowerCase()}@no-login.invalid`)
  const isAdmin = v.canLogin && v.isAdmin
  if (prev && prev.status === 'pending' && v.status === 'active' && !prev.email_verified_at) {
    if (opts.mailDelivers) return fail(t('users.approve.unverified'), 'status')
    if (!v.approveUnverified) return fail(t('users.approve.confirmUnverified'), 'status')
  }

  const stmts: Stmt[] = []
  if (prev) {
    const goingInactive = v.status === 'inactive' && prev.status !== 'inactive'
    const action = prev.status === 'pending' ? (v.status === 'active' ? 'user.approve' : 'user.reject') : goingInactive ? 'user.deactivate' : 'user.update'
    stmts.push(
      db
        .prepare(
          `UPDATE users SET email_verified_at = CASE WHEN email = ? THEN email_verified_at ELSE NULL END, email = ?, display_name = ?, department = ?, role = ?, is_admin = ?, can_upload_invoices = ?, can_manage_jobs = ?, status = ?, can_login = ?,
             deactivated_at = CASE WHEN ? = 'inactive' THEN COALESCE(deactivated_at, ?) ELSE NULL END,
             deactivated_by = CASE WHEN ? = 'inactive' THEN COALESCE(deactivated_by, ?) ELSE NULL END,
             updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`,
        )
        .bind(email, email, v.displayName, v.department || null, role, isAdmin ? 1 : 0, canUpload, canJobs, v.status, v.canLogin ? 1 : 0, v.status, now, v.status, actor.id, now, actor.id, id),
      audit(db, {
        actorId: actor.id, action, entityType: 'user', entityId: id,
        before: { email: prev.email, role: prev.role, isAdmin: prev.is_admin === 1, canUpload: prev.can_upload_invoices === 1, canJobs: prev.can_manage_jobs === 1, status: prev.status, canLogin: prev.can_login === 1 },
        after: { email, role, isAdmin, canUpload: canUpload === 1, canJobs: canJobs === 1, status: v.status, canLogin: v.canLogin },
      }),
    )
  } else {
    stmts.push(
      db
        .prepare(`INSERT INTO users (id, email, full_name, display_name, department, role, is_admin, can_upload_invoices, can_manage_jobs, avatar_hue, status, deactivated_at, deactivated_by, created_by, updated_by, can_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, email, v.displayName, v.displayName, v.department || null, role, isAdmin ? 1 : 0, canUpload, canJobs, hueOf(v.displayName), v.status, v.status === 'inactive' ? now : null, v.status === 'inactive' ? actor.id : null, actor.id, actor.id, v.canLogin ? 1 : 0),
      audit(db, { actorId: actor.id, action: 'user.create', entityType: 'user', entityId: id, after: { email, role, isAdmin, canUpload: canUpload === 1, canJobs: canJobs === 1, canLogin: v.canLogin } }),
    )
  }
  if (prev && (v.status === 'inactive' || !v.canLogin)) stmts.push(dropUserSessions(db, id))
  if (v.canLogin && (!prev || prev.entitled_days !== v.leaveEntitlement)) {
    must(actor, { a: 'leaveEntitlement.write' })
    stmts.push(
      db
        .prepare(
          `INSERT INTO leave_entitlements (id, user_id, year, entitled_days, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, year) DO UPDATE SET entitled_days = excluded.entitled_days, updated_at = ?, updated_by = ?, version = version + 1`,
        )
        .bind(ulid(), id, year, v.leaveEntitlement, actor.id, actor.id, now, actor.id),
      audit(db, { actorId: actor.id, action: 'leaveEntitlement.set', entityType: 'leave_entitlement', entityId: id, before: { days: prev?.entitled_days ?? null }, after: { year, days: v.leaveEntitlement } }),
    )
  }
  const err = await commit(ctx, stmts, [], { unique: fail(t('server.users.emailExists'), 'email') })
  if (err) return err
  const row = await db.prepare(`${USER_LIST} WHERE u.id = ?`).bind(year, id).first<UserListRow>()
  return { ok: true, user: toAppUser(row!), warning: mail.warning }
}

interface DigitalRow {
  id: string; kind: DigitalKind; name: string; vendor: string | null; plan: string | null; seats: number | null; account_email: string | null
  owner_id: string | null; owner_name: string | null; renews_on: string | null; period: DigitalPeriod; cost_minor: number | null; currency: DigitalCurrency
  status: 'active' | 'cancelled'; note: string | null; purpose: string | null; verified: number; source: string | null; last_paid_on: string | null; last_paid_minor: number | null; paid_by: string | null
}

export async function listDigital(ctx: Ctx): Promise<DigitalAsset[]> {
  must(ctx.user, { a: 'asset.read' })
  const [rows, seats] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT d.id, d.kind, d.name, d.vendor, d.plan, d.seats, d.account_email, d.owner_id, o.display_name AS owner_name, d.renews_on, d.period, d.cost_minor, d.currency,
                d.status, d.note, d.purpose, d.verified, d.source, d.last_paid_on, d.last_paid_minor, d.paid_by
         FROM digital_assets d LEFT JOIN users o ON o.id = d.owner_id
         ORDER BY d.status, CASE WHEN d.renews_on IS NULL THEN 1 ELSE 0 END, d.renews_on, d.name`,
      )
      .all<DigitalRow>(),
    ctx.db.prepare(`SELECT du.asset_id, u.id, u.display_name FROM digital_asset_users du JOIN users u ON u.id = du.user_id WHERE du.removed_at IS NULL ORDER BY u.display_name`).all<{ asset_id: string; id: string; display_name: string }>(),
  ])
  const links = await linkedInvoices(ctx, 'digital')
  return rows.results.map((r) => ({
    ...(links ? { invoices: links.get(r.id) ?? [], hasInvoice: links.has(r.id) } : {}),
    id: r.id, kind: r.kind, name: r.name, vendor: r.vendor ?? '', plan: r.plan ?? '', seats: r.seats, accountEmail: r.account_email ?? '',
    ownerId: r.owner_id, ownerName: r.owner_name ?? '—', renewsOn: r.renews_on, period: r.period, cost: r.cost_minor == null ? null : r.cost_minor / 100,
    currency: r.currency, verified: r.verified === 1, source: r.source ?? '', lastPaidOn: r.last_paid_on, lastPaid: r.last_paid_minor == null ? null : r.last_paid_minor / 100, paidBy: r.paid_by ?? '',
    status: r.status, note: r.note ?? '', purpose: r.purpose ?? '',
    users: seats.results.filter((x) => x.asset_id === r.id).map((x) => ({ id: x.id, name: x.display_name })),
  }))
}

export async function saveDigital(ctx: Ctx, input: unknown): Promise<{ ok: true; id: string } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'asset.write' })
  const p = parsed(digitalSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  const id = v.id ?? ulid()
  const now = nowIso()
  const cost = v.cost == null ? null : toMinor(round2(v.cost))
  const extra = [v.verified ? 1 : 0, v.source || null, v.lastPaidOn || null, v.lastPaid == null ? null : toMinor(round2(v.lastPaid)), v.paidBy || null]
  const before = v.id ? await db.prepare(`SELECT * FROM digital_assets WHERE id = ?`).bind(v.id).first() : null
  if (v.id && !before) return fail(t('server.recordNotFound'))
  const people = [...new Set(v.userIds)]
  const stmts: Stmt[] = [
    ...people.map((uid) => assertion(db, 'user_inactive', `NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`, uid)),
    ...(v.ownerId ? [assertion(db, 'user_inactive', `NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`, v.ownerId)] : []),
    v.id
      ? db
          .prepare(
            `UPDATE digital_assets SET kind = ?, name = ?, vendor = ?, plan = ?, seats = ?, account_email = ?, owner_id = ?, renews_on = ?, period = ?, cost_minor = ?, currency = ?, status = ?, note = ?, purpose = ?,
             verified = ?, source = ?, last_paid_on = ?, last_paid_minor = ?, paid_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`,
          )
          .bind(v.kind, v.name, v.vendor || null, v.plan || null, v.seats ?? null, v.accountEmail || null, v.ownerId ?? null, v.renewsOn || null, v.period, cost, v.currency, v.status, v.note || null, v.purpose || null, ...extra, now, user.id, id)
      : db
          .prepare(
            `INSERT INTO digital_assets (id, kind, name, vendor, plan, seats, account_email, owner_id, renews_on, period, cost_minor, currency, status, note, purpose, verified, source, last_paid_on, last_paid_minor, paid_by, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, v.kind, v.name, v.vendor || null, v.plan || null, v.seats ?? null, v.accountEmail || null, v.ownerId ?? null, v.renewsOn || null, v.period, cost, v.currency, v.status, v.note || null, v.purpose || null, ...extra, user.id, user.id),
    db
      .prepare(`UPDATE digital_asset_users SET removed_at = ? WHERE asset_id = ? AND removed_at IS NULL AND user_id NOT IN (SELECT value FROM json_each(?))`)
      .bind(now, id, JSON.stringify(people)),
    ...people.map((uid) =>
      db
        .prepare(`INSERT INTO digital_asset_users (asset_id, user_id) VALUES (?, ?) ON CONFLICT (asset_id, user_id) DO UPDATE SET removed_at = NULL, added_at = CASE WHEN removed_at IS NULL THEN added_at ELSE ? END`)
        .bind(id, uid, now),
    ),
    audit(db, {
      actorId: user.id, action: v.id ? 'digital.update' : 'digital.create', entityType: 'asset', entityId: id,
      before: before ?? undefined,
      after: { kind: v.kind, name: v.name, renewsOn: v.renewsOn || null, period: v.period, cost, currency: v.currency, verified: v.verified, status: v.status, users: people },
    }),
  ]
  const err = await commit(ctx, stmts, [], { user_inactive: fail(t('server.assets.selectedNotActive'), 'userIds') })
  return err ?? { ok: true, id }
}

export async function fxRates(db: Db): Promise<FxRates & { updatedOn: string | null }> {
  return storedRates(db)
}

export async function saveFx(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'fixedCost.write' })
  must(user, { a: 'user.manage' })
  const p = parsed(fxSchema, input)
  if (!p.ok) return p.res
  const before = await fxRates(db)
  const stmts: Stmt[] = [storeRatesStmt(db, p.data.rates, today(ctx), user.id), audit(db, { actorId: user.id, action: 'fx.set', entityType: 'fixed_cost', entityId: 'fx', before, after: p.data })]
  if (p.data.vatRates) stmts.push(writeSetting(db, VAT_SETTING, normalizeVatRates(p.data.vatRates), user.id))
  return (await commit(ctx, stmts, [])) ?? { ok: true }
}

export async function digitalMonthlyTotal(db: Db): Promise<{ total: number; missingFx: number }> {
  const fx = await fxRates(db)
  const rows = (await db.prepare(`SELECT period, cost_minor, currency FROM digital_assets WHERE status = 'active'`).all<{ period: DigitalPeriod; cost_minor: number | null; currency: DigitalCurrency }>()).results
  let total = 0
  let missingFx = 0
  for (const r of rows) {
    const m = monthlyBase(r.period, r.cost_minor == null ? null : r.cost_minor / 100, r.currency, fx)
    if (m == null) missingFx++
    else total += m
  }
  return { total: round2(total), missingFx }
}

export async function saveFixedCosts(ctx: Ctx, input: unknown): Promise<{ ok: true } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'fixedCost.write' })
  const p = parsed(fixedCostSchema, input)
  if (!p.ok) return p.res
  const v = p.data
  if (v.month > today(ctx).slice(0, 7)) return fail(t('server.finance.futureMonth'), 'month')
  const now = nowIso()
  const before = (await db.prepare(`SELECT kind, amount_minor FROM fixed_costs WHERE month = ?`).bind(v.month).all<{ kind: string; amount_minor: number }>()).results
  const settingsBefore = await db.prepare(`SELECT billable_people, hours_per_person, utilization_pct, target_margin_pct FROM finance_settings WHERE id = 1`).first()
  const stmts: Stmt[] = FIXED_KINDS.map((kind) =>
    db
      .prepare(
        `INSERT INTO fixed_costs (id, month, kind, amount_minor, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (month, kind) DO UPDATE SET amount_minor = excluded.amount_minor, updated_at = ?, updated_by = ?, version = version + 1`,
      )
      .bind(ulid(), v.month, kind, toMinor(round2(v[kind])), user.id, user.id, now, user.id),
  )
  stmts.push(
    db
      .prepare(`UPDATE finance_settings SET billable_people = ?, hours_per_person = ?, utilization_pct = ?, target_margin_pct = ?, updated_at = ?, updated_by = ? WHERE id = 1`)
      .bind(v.people, v.hours, v.utilization, v.margin, now, user.id),
    audit(db, {
      actorId: user.id, action: 'fixedCost.set', entityType: 'fixed_cost', entityId: v.month,
      before: { ...Object.fromEntries(before.map((b) => [b.kind, b.amount_minor])), settings: settingsBefore },
      after: { ...Object.fromEntries(FIXED_KINDS.map((k) => [k, toMinor(round2(v[k]))])), settings: { people: v.people, hours: v.hours, utilization: v.utilization, margin: v.margin } },
    }),
  )
  return (await commit(ctx, stmts, [])) ?? { ok: true }
}

const monthKeyOf = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

export async function overview(ctx: Ctx): Promise<OverviewData> {
  const { db } = ctx
  must(ctx.user, { a: 'dashboard.read' })
  const day = today(ctx)
  const [cy, cm] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))]
  const keys: string[] = []
  for (let i = 11; i >= 0; i--) {
    const idx = cy * 12 + (cm - 1) - i
    keys.push(monthKeyOf(Math.floor(idx / 12), (idx % 12) + 1))
  }
  const from = `${keys[0]}-01`
  const nextIdx = cy * 12 + cm
  const to = `${monthKeyOf(Math.floor(nextIdx / 12), (nextIdx % 12) + 1)}-01`

  const [inv, fixed, emp, open, ags, pend, agCount, rs, ren, digMonthly] = await Promise.all([
    db
      .prepare(
        `SELECT substr(invoice_date, 1, 7) AS m, direction, COALESCE(cost_kind, 'overhead') AS ck, SUM(net_base_minor) AS net, COUNT(*) AS n, COUNT(DISTINCT lower(counterparty)) AS firms
         FROM invoices WHERE archived_at IS NULL AND approval_status = 'approved' AND invoice_date >= ? AND invoice_date < ? AND invoice_date >= ? GROUP BY m, direction, ck`,
      )
      .bind(from, to, booksStart())
      .all<{ m: string; direction: 'in' | 'out'; ck: 'direct' | 'overhead'; net: number; n: number; firms: number }>(),
    db.prepare(`SELECT month AS m, kind, amount_minor FROM fixed_costs WHERE month >= ? AND month <= ?`).bind(keys[0], keys[11]).all<{ m: string; kind: FixedKind; amount_minor: number }>(),
    db
      .prepare(
        `SELECT substr(it.expense_date, 1, 7) AS m, SUM(it.amount_base_minor) AS k FROM request_items it JOIN requests r ON r.id = it.request_id
         WHERE it.archived_at IS NULL AND r.status IN ('approved','paid') AND it.expense_date >= ? AND it.expense_date < ? GROUP BY m`,
      )
      .bind(from, to)
      .all<{ m: string; k: number }>(),
    db.prepare(`SELECT net_base_minor, invoice_date, due_on FROM invoices WHERE direction = 'out' AND archived_at IS NULL AND settled_on IS NULL AND invoice_date >= ?`).bind(booksStart()).all<{ net_base_minor: number; invoice_date: string; due_on: string | null }>(),
    db
      .prepare(`SELECT ${AG_COLS} FROM agreements WHERE archived_at IS NULL AND end_date >= ? AND end_date <= date(?, '+60 days') ORDER BY end_date LIMIT 3`)
      .bind(day, day)
      .all<AgreementRow>(),
    pendingCounts(db),
    db.prepare(`SELECT COUNT(*) AS n FROM agreements WHERE archived_at IS NULL`).first<{ n: number }>(),
    db
      .prepare(
        `SELECT s.billable_people AS people, s.hours_per_person AS hours, s.utilization_pct AS util, s.target_margin_pct AS margin,
                (SELECT COUNT(*) FROM users WHERE status = 'active' AND can_login = 1 AND role <> 'owner') AS active
         FROM finance_settings s WHERE s.id = 1`,
      )
      .first<{ people: number | null; hours: number; util: number; margin: number; active: number }>(),
    db
      .prepare(`SELECT id, name, vendor, plan, renews_on FROM digital_assets WHERE status = 'active' AND renews_on BETWEEN ? AND date(?, '+60 days') ORDER BY renews_on LIMIT 3`)
      .bind(day, day)
      .all<{ id: string; name: string; vendor: string | null; plan: string | null; renews_on: string }>(),
    digitalMonthlyTotal(db),
  ])

  const months: MonthData[] = keys.map((key) => {
    const rows = inv.results.filter((r) => r.m === key)
    const sum = (f: (r: (typeof rows)[number]) => boolean, k: 'net' | 'n' | 'firms') => rows.filter(f).reduce((t, r) => t + r[k], 0)
    const fx = (k: FixedKind) => fixed.results.find((r) => r.m === key && r.kind === k)?.amount_minor
    const b = {
      personnel: (fx('personnel') ?? 0) / 100,
      office: (fx('office') ?? 0) / 100,
      software: (fx('software') ?? 0) / 100,
      equipment: (fx('equipment') ?? 0) / 100,
      professional: (fx('professional') ?? 0) / 100,
      otherFixed: (fx('other') ?? 0) / 100,
      invoicesDirect: sum((r) => r.direction === 'in' && r.ck === 'direct', 'net') / 100,
      invoicesOverhead: sum((r) => r.direction === 'in' && r.ck === 'overhead', 'net') / 100,
      employeeExpenses: (emp.results.find((r) => r.m === key)?.k ?? 0) / 100,
    }
    const out = (r: (typeof rows)[number]) => r.direction === 'out'
    return {
      key,
      year: Number(key.slice(0, 4)),
      month: Number(key.slice(5, 7)),
      income: sum(out, 'net') / 100,
      expense: breakdownTotal(b),
      invoiceCount: sum(out, 'n'),
      customerCount: sum(out, 'firms'),
      breakdown: b,
      fixedMissing: fx('personnel') === undefined || fx('office') === undefined,
    }
  })

  const oldest = pend?.oldest ? Math.round((Date.parse(day) - Date.parse(pend.oldest.slice(0, 10))) / 86_400_000) : 0
  return {
    todayISO: day,
    currentKey: keys[11],
    months,
    receivables: receivablesOf(
      open.results.map((r) => ({ direction: 'out' as const, net: r.net_base_minor / 100, date: r.invoice_date, due: r.due_on, settledOn: null })),
      day,
    ),
    expiring: ags.results.map((r) => toAgreement(r)),
    agreementCount: agCount?.n ?? 0,
    pending: { leave: pend?.leave_n ?? 0, other: pend?.other_n ?? 0, otherSum: (pend?.other_minor ?? 0) / 100, oldestDays: oldest },
    renewals: ren.results.map((r) => ({ id: r.id, name: r.name, sub: [r.vendor, r.plan].filter(Boolean).join(' · '), renewsOn: r.renews_on })),
    digitalMonthly: digMonthly.total,
    digitalMissingFx: digMonthly.missingFx,
    rate: {
      people: rs?.people ?? Math.max(rs?.active ?? 1, 1),
      peopleAuto: rs?.people == null,
      hours: rs?.hours ?? 160,
      utilization: rs?.util ?? 65,
      margin: rs?.margin ?? 25,
    },
  }
}
