import { booksStart, isBeforeBooks } from '#/lib/invoice'
import type { Currency } from '#/lib/money'
import { forLocale, type MessageKey } from '#/i18n'
import { monthName } from '#/i18n/format'
import { isLocale, type Locale } from '#/i18n/locales'
import { runtimeConfig } from '#/config/runtime'
import { appNameOr } from '#/config/brand'
import { zipSync } from 'fflate'
import { audit, ulid, type Db, type Stmt } from './db/d1'
import type { Mailer } from './notify'
import { mailDay, mailLeaveDays, mailMoney } from './mailFormat'

export const GREETING = '{GREETING}'
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024

export const accountingLocale = (): Locale => {
  const l = runtimeConfig().accountingLocale
  return isLocale(l) ? l : 'en'
}
const L = () => forLocale(accountingLocale())
const app = () => appNameOr(runtimeConfig().appName)

export const longDay = (iso: string, locale: Locale = accountingLocale()) => mailDay(locale, iso, true)
const money = (minor: number, currency?: string) => mailMoney(accountingLocale(), minor, currency as Currency | undefined)

export const greetingLine = (salutation: string, locale: Locale = accountingLocale()) => {
  const name = salutation.replace(/[\r\n]+/g, ' ').trim()
  return name ? forLocale(locale).t('accounting.greetingNamed', { name }) : forLocale(locale).t('accounting.greeting')
}

const LEAVE_KINDS = ['annual', 'excuse', 'sick', 'unpaid'] as const
const leaveLabel = (kind: string) => ((LEAVE_KINDS as readonly string[]).includes(kind) ? L().t(`accounting.leave.${kind}` as MessageKey) : L().t('accounting.leave.other'))
const REQUEST_KINDS = ['leave', 'expense', 'advance'] as const
type AcctKind = (typeof REQUEST_KINDS)[number]
const isAcctKind = (k: string): k is AcctKind => (REQUEST_KINDS as readonly string[]).includes(k)

const healthName = (contentType: string) => `${L().t('accounting.healthFile')}.${contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'heic'}`

interface Att {
  id: string
  original_name: string
  content_type: string
  size_bytes: number
  is_sensitive: number
}

export function attachLines(atts: Att[]): { line: string | null; ids: string[] } {
  if (atts.length === 0) return { line: null, ids: [] }
  const l = L()
  const name = (a: Att) => (a.is_sensitive ? l.t('accounting.healthReport') : a.original_name)
  const fit: Att[] = []
  const rest: Att[] = []
  let total = 0
  for (const a of atts) {
    if (total + a.size_bytes <= MAX_ATTACH_BYTES) {
      fit.push(a)
      total += a.size_bytes
    } else rest.push(a)
  }
  if (fit.length === 0) return { line: l.t('accounting.attach.inPanel'), ids: [] }
  const line = rest.length ? l.t('accounting.attach.partial', { files: fit.map(name).join(', '), rest: rest.map(name).join(', ') }) : l.t('accounting.attach.files', { files: fit.map(name).join(', ') })
  return { line, ids: fit.map((a) => a.id) }
}

const compose = (opening: string, lines: string[], ek: string | null) => [GREETING, '', opening, '', ...lines, ...(ek ? ['', ek] : []), '', L().t('mail.foot', { app: app() })].join('\n')

function insert(
  db: Db,
  m: {
    kind: 'request_approved' | 'invoice_uploaded'; entityType: 'request' | 'invoice'; entityId: string; dedupe: string; subject: string; text: string; attachmentIds: string[]
    fromName?: string | null; ccExtra?: string | null; zipName?: string | null; zipPaths?: Record<string, string> | null
  },
): Stmt {
  return db
    .prepare(
      `INSERT OR IGNORE INTO accounting_outbox (id, kind, entity_type, entity_id, dedupe_key, subject, body_text, attachment_ids, from_name, cc_extra, zip_name, zip_paths) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ulid(), m.kind, m.entityType, m.entityId, m.dedupe, m.subject.slice(0, 300), m.text.slice(0, 6000), JSON.stringify(m.attachmentIds),
      m.fromName ?? null, m.ccExtra ?? null, m.zipName ?? null, m.zipPaths ? JSON.stringify(m.zipPaths) : null,
    )
}

export function senderName(fullName: string): string | null {
  const n = fullName.replace(/[\r\n"<>\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return n ? `${n} (${app().replace(/[\r\n"<>\\()]+/g, ' ').trim()})` : null
}

export function requesterCc(u: { email: string; can_login: number }): string | null {
  const e = u.email.trim().toLowerCase()
  if (!u.can_login || e.endsWith('.invalid') || !/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/.test(e) || e.length > 200) return null
  return e
}

const field = (key: MessageKey, value: string) => `${L().t(key)}: ${value}`

export async function approvedRequestMail(db: Db, requestId: string, approver: string | null, dayISO: string): Promise<Stmt | null> {
  const r = await db
    .prepare(`SELECT r.id, r.type, r.note, r.total_base_minor, u.full_name, u.email, u.can_login FROM requests r JOIN users u ON u.id = r.requester_id WHERE r.id = ?`)
    .bind(requestId)
    .first<{ id: string; type: string; note: string | null; total_base_minor: number | null; full_name: string; email: string; can_login: number }>()
  if (!r || !isAcctKind(r.type)) return null
  const l = L()
  const kind = r.type
  const atts = (
    await db
      .prepare(
        `SELECT a.id, a.original_name, a.content_type, a.size_bytes, a.is_sensitive, a.kind FROM attachments a
         LEFT JOIN request_items it ON it.id = a.request_item_id
         WHERE (a.request_id = ? OR it.request_id = ?) AND a.archived_at IS NULL AND (it.id IS NULL OR it.archived_at IS NULL)
         ORDER BY it.line_no, a.created_at, a.id`,
      )
      .bind(r.id, r.id)
      .all<Att & { kind: string }>()
  ).results
  const kindWord = l.t(`accounting.kind.${kind}` as MessageKey)
  let opening = approver ? l.t('accounting.opening.approvedBy', { kind: kindWord, approver }) : l.t('accounting.opening.auto', { kind: kindWord })
  const approvedOn = field('accounting.label.approvedOn', longDay(dayISO))
  const vat = (amount: string) => l.t('accounting.vatIncluded', { amount })
  let lines: string[]
  let ek: { line: string | null; ids: string[] }
  if (kind === 'leave') {
    const lv = await db
      .prepare(`SELECT kind, start_date, end_date, start_time, end_time, work_days FROM leave_requests WHERE request_id = ?`)
      .bind(r.id)
      .first<{ kind: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; work_days: number }>()
    if (!lv) return null
    const span = lv.start_time && lv.end_time ? `${longDay(lv.start_date)} ${lv.start_time}–${lv.end_time}` : lv.start_date === lv.end_date ? longDay(lv.start_date) : `${longDay(lv.start_date)} – ${longDay(lv.end_date)}`
    lines = [field('accounting.label.employee', r.full_name), field('accounting.label.leave', leaveLabel(lv.kind)), field('accounting.label.dates', `${span} (${mailLeaveDays(l, lv.work_days, true)})`), approvedOn]
    ek = { line: null, ids: [] }
  } else if (kind === 'expense') {
    const items = (
      await db.prepare(`SELECT expense_date, description FROM request_items WHERE request_id = ? AND archived_at IS NULL ORDER BY line_no`).bind(r.id).all<{ expense_date: string; description: string | null }>()
    ).results
    const dates = items.map((i) => i.expense_date).sort()
    const when = dates.length === 0 ? '—' : dates[0] === dates[dates.length - 1] ? longDay(dates[0]) : `${longDay(dates[0])} – ${longDay(dates[dates.length - 1])}`
    const desc = items.map((i) => i.description?.trim()).filter(Boolean).join('; ')
    lines = [
      field('accounting.label.employee', r.full_name),
      field('accounting.label.type', l.t('accounting.kindTitle.expense')),
      field('accounting.label.amount', vat(money(r.total_base_minor ?? 0))),
      field('accounting.label.spentOn', when),
      ...(desc ? [field('accounting.label.description', desc)] : []),
      approvedOn,
      field('accounting.label.payment', l.t('accounting.salaryAccount')),
    ]
    ek = attachLines(atts.filter((a) => !a.is_sensitive))
  } else {
    const a = await db.prepare(`SELECT amount_minor, needed_on FROM advance_requests WHERE request_id = ?`).bind(r.id).first<{ amount_minor: number; needed_on: string }>()
    if (!a) return null
    opening += ` ${l.t('accounting.opening.advancePay', { amount: money(a.amount_minor) })}`
    lines = [
      field('accounting.label.employee', r.full_name),
      field('accounting.label.type', l.t('accounting.kindTitle.advance')),
      field('accounting.label.amount', money(a.amount_minor)),
      field('accounting.label.neededOn', longDay(a.needed_on)),
      ...(r.note?.trim() ? [field('accounting.label.description', r.note.trim())] : []),
      approvedOn,
      field('accounting.label.payment', l.t('accounting.salaryAccount')),
    ]
    ek = attachLines(atts.filter((x) => !x.is_sensitive))
  }
  return insert(db, {
    kind: 'request_approved',
    entityType: 'request',
    entityId: r.id,
    dedupe: `acct:request_approved:${r.id}`,
    subject: l.t('accounting.subject.request', { app: app(), kind: kindWord, title: l.t(`accounting.kindTitle.${kind}` as MessageKey), name: r.full_name }),
    text: compose(opening, lines, ek.line),
    attachmentIds: ek.ids,
    fromName: senderName(r.full_name),
    ccExtra: requesterCc(r),
  })
}

function invoiceAmount(i: { currency: string; fx_rate_micro: number; net_minor: number; vat_minor: number; net_base_minor: number; vat_base_minor: number }): string {
  const l = L()
  const base = money(i.net_base_minor + i.vat_base_minor)
  if (i.currency === runtimeConfig().baseCurrency) return l.t('accounting.vatIncluded', { amount: base })
  const rate = new Intl.NumberFormat(accountingLocale() === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: 4 }).format(i.fx_rate_micro / 1e6)
  return l.t('accounting.vatIncludedFx', { amount: money(i.net_minor + i.vat_minor, i.currency), rate, base })
}

const INVOICE_COLS = `i.id, i.invoice_no, i.counterparty, i.invoice_date, i.net_base_minor, i.vat_base_minor, i.currency, i.fx_rate_micro, i.net_minor, i.vat_minor,
  i.auto_approved, i.decided_at, i.created_at, up.full_name AS uploader, dec.full_name AS approver`
interface InvoiceMailRow {
  id: string
  invoice_no: string
  counterparty: string
  invoice_date: string
  net_base_minor: number
  vat_base_minor: number
  currency: string
  fx_rate_micro: number
  net_minor: number
  vat_minor: number
  auto_approved: number
  decided_at: string | null
  created_at: string
  uploader: string
  approver: string | null
}
const approverLabel = (i: InvoiceMailRow) => (i.auto_approved ? `${i.approver ?? L().t('accounting.coordinator')} ${L().t('accounting.autoSuffix')}` : (i.approver ?? '—'))

export async function approvedInvoiceMail(db: Db, invoiceId: string, approverName: string | null, dayISO: string): Promise<Stmt | null> {
  const i = await db
    .prepare(
      `SELECT ${INVOICE_COLS}, i.direction, i.approval_status FROM invoices i JOIN users up ON up.id = i.uploaded_by LEFT JOIN users dec ON dec.id = i.decided_by
       WHERE i.id = ? AND i.archived_at IS NULL`,
    )
    .bind(invoiceId)
    .first<InvoiceMailRow & { direction: string; approval_status: string }>()
  if (!i || i.direction !== 'in' || isBeforeBooks(i.invoice_date)) return null
  if (!approverName && i.approval_status !== 'approved') return null
  const l = L()
  const atts = (
    await db
      .prepare(`SELECT id, original_name, content_type, size_bytes, is_sensitive FROM attachments WHERE invoice_id = ? AND archived_at IS NULL ORDER BY created_at, id`)
      .bind(i.id)
      .all<Att>()
  ).results
  const ek = attachLines(atts.filter((a) => !a.is_sensitive))
  const by = approverName ?? approverLabel(i)
  const opening = approverName ? l.t('accounting.invoiceOpening.approvedBy', { approver: approverName }) : i.auto_approved ? l.t('accounting.invoiceOpening.auto') : l.t('accounting.invoiceOpening.plain')
  const lines = [
    field('accounting.label.supplier', i.counterparty),
    field('accounting.label.invoiceNo', i.invoice_no),
    field('accounting.label.invoiceDate', longDay(i.invoice_date)),
    field('accounting.label.amount', invoiceAmount(i)),
    field('accounting.label.uploadedBy', i.uploader),
    field('accounting.label.approvedBy', by),
    field('accounting.label.approvedOn', longDay(dayISO)),
  ]
  return insert(db, {
    kind: 'invoice_uploaded',
    entityType: 'invoice',
    entityId: i.id,
    dedupe: `acct:invoice:${i.id}`,
    subject: l.t('accounting.subject.invoice', { app: app(), firm: i.counterparty, no: i.invoice_no }),
    text: compose(opening, lines, ek.line),
    attachmentIds: ek.ids,
  })
}

const MAIL_BODY_MAX = 5500
export const ZIP_MAX_BYTES = 15 * 1024 * 1024

function zoneOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: runtimeConfig().timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  )
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - utcMs
}

const localMidnight = (y: number, m0: number) => {
  const guess = Date.UTC(y, m0, 1)
  return new Date(guess - zoneOffsetMs(guess)).toISOString()
}

function monthBounds(y: number, m: number): { from: string; to: string } {
  return { from: localMidnight(y, m - 1), to: localMidnight(y, m) }
}

export function isLastDayOfMonth(day: string): boolean {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  return Number(day.slice(8, 10)) === new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function zipSafe(name: string, fallback: string): string {
  const s = name
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 80)
    .trim()
  return s || fallback
}

const asciiName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

export async function monthEndInvoiceMails(db: Db, today: string): Promise<Stmt[]> {
  if (!isLastDayOfMonth(today)) return []
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const key = `${y}-${String(m).padStart(2, '0')}`
  const { from, to } = monthBounds(y, m)
  const done = await db.prepare(`SELECT 1 AS x FROM accounting_outbox WHERE dedupe_key LIKE ? LIMIT 1`).bind(`acct:invoices_monthend:${key}:%`).first()
  if (done) return []
  const where = `i.direction = 'in' AND i.archived_at IS NULL AND i.approval_status = 'approved' AND i.invoice_date >= ? AND COALESCE(i.decided_at, i.created_at) >= ? AND COALESCE(i.decided_at, i.created_at) < ?`
  const rows = (
    await db
      .prepare(
        `SELECT ${INVOICE_COLS} FROM invoices i JOIN users up ON up.id = i.uploaded_by LEFT JOIN users dec ON dec.id = i.decided_by
         WHERE ${where} ORDER BY lower(i.counterparty), i.invoice_date, i.invoice_no, i.id`,
      )
      .bind(booksStart(), from, to)
      .all<InvoiceMailRow>()
  ).results
  if (rows.length === 0) return []
  const l = L()
  const atts = (
    await db
      .prepare(
        `SELECT a.id, a.invoice_id, a.original_name, a.content_type, a.size_bytes, a.is_sensitive FROM attachments a
         WHERE a.archived_at IS NULL AND a.is_sensitive = 0 AND a.invoice_id IN (SELECT i.id FROM invoices i WHERE ${where})
         ORDER BY a.created_at, a.original_name, a.id`,
      )
      .bind(booksStart(), from, to)
      .all<Att & { invoice_id: string }>()
  ).results
  const line = (i: InvoiceMailRow) =>
    [
      field('accounting.label.supplier', i.counterparty),
      field('accounting.label.invoiceNo', i.invoice_no),
      field('accounting.label.invoiceDate', longDay(i.invoice_date)),
      field('accounting.label.amount', invoiceAmount(i)),
      field('accounting.label.uploadedBy', i.uploader),
      field('accounting.label.approvedBy', approverLabel(i)),
    ].join('\n')

  const firmFallback = l.t('accounting.zip.firm')
  const fileFallback = l.t('accounting.zip.file')
  const paths = new Map<string, string>()
  const taken = new Set<string>()
  for (const r of rows) {
    const folder = zipSafe(r.counterparty, firmFallback)
    for (const a of atts.filter((x) => x.invoice_id === r.id)) {
      let p = `${folder}/${zipSafe(a.original_name, fileFallback)}`
      if (taken.has(p.toLowerCase())) p = `${folder}/${zipSafe(`${r.invoice_no} ${a.original_name}`, fileFallback)}`
      for (let n = 2; taken.has(p.toLowerCase()); n++) p = `${folder}/${n} ${zipSafe(a.original_name, fileFallback)}`
      taken.add(p.toLowerCase())
      paths.set(a.id, p)
    }
  }

  const groups: { rows: InvoiceMailRow[]; atts: Att[]; size: number; len: number }[] = []
  for (const r of rows) {
    const mine = atts.filter((a) => a.invoice_id === r.id)
    const size = mine.reduce((t, a) => t + a.size_bytes, 0)
    const len = line(r).length + 2
    let g = groups[groups.length - 1]
    if (!g || g.size + size > ZIP_MAX_BYTES || g.len + len > MAIL_BODY_MAX) {
      g = { rows: [], atts: [], size: 0, len: 0 }
      groups.push(g)
    }
    g.rows.push(r)
    g.atts.push(...mine)
    g.size += size
    g.len += len
  }
  const month = `${monthName(m, 'long', accountingLocale())} ${y}`
  const totalMinor = rows.reduce((t, i) => t + i.net_base_minor + i.vat_base_minor, 0)
  const asciiMonth = asciiName(month)
  return groups.map((g, n) => {
    const part = groups.length > 1 ? ` · ${n + 1}/${groups.length}` : ''
    const zipName = `${asciiName(l.t('accounting.zip.prefix'))}-${asciiMonth}${groups.length > 1 ? `-${n + 1}` : ''}.zip`
    const zipPaths = Object.fromEntries(g.atts.map((a) => [a.id, paths.get(a.id)!]))
    const opening = l.t('accounting.monthEnd.opening', {
      month,
      count: rows.length,
      total: money(totalMinor),
      part: groups.length > 1 ? l.t('accounting.monthEnd.part', { n: n + 1, of: groups.length }) : '',
    })
    const ek = g.atts.length ? l.tn('accounting.monthEnd.zip', g.atts.length, { zip: zipName }) : l.t('accounting.attach.inPanel')
    return insert(db, {
      kind: 'invoice_uploaded',
      entityType: 'invoice',
      entityId: g.rows[0].id,
      dedupe: `acct:invoices_monthend:${key}:p${n + 1}`,
      subject: l.t('accounting.monthEnd.subject', { app: app(), month, count: rows.length, part }),
      text: compose(opening, [g.rows.map(line).join('\n\n')], ek),
      attachmentIds: g.atts.map((a) => a.id),
      zipName: g.atts.length ? zipName : null,
      zipPaths: g.atts.length ? zipPaths : null,
    })
  })
}

export interface AccountingConfig {
  to: string[]
  cc: string[]
  replyTo?: string
  salutation: string
  only?: string[]
}

export function parseAddresses(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => /^(?:[^<>@,;\r\n]*<)?[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}>?$/i.test(a) && !/[\r\n]/.test(a))
}

export interface FileStore {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
}

export function mergeCc(to: string[], cc: string[], extra: string | null): string[] {
  const bare = (a: string) => (a.match(/<([^<>]+)>\s*$/)?.[1] ?? a).trim().toLowerCase()
  const seen = new Set(to.map(bare))
  const out: string[] = []
  for (const a of [...cc, ...(extra ? [extra] : [])]) {
    const b = bare(a)
    if (seen.has(b)) continue
    seen.add(b)
    out.push(a)
  }
  return out
}

const MAX_ATTEMPTS = 5
const MAX_AGE_MS = 48 * 3600_000
const CLAIM_MS = 5 * 60_000

export async function deliverAccounting(db: Db, files: FileStore, mailer: Mailer, cfg: AccountingConfig, limit = 10): Promise<{ sent: number; failed: number }> {
  if (cfg.to.length === 0) return { sent: 0, failed: 0 }
  await db
    .prepare(`UPDATE accounting_outbox SET status = 'failed', last_error = 'expired' WHERE status = 'queued' AND created_at < ?`)
    .bind(new Date(Date.now() - MAX_AGE_MS).toISOString())
    .run()
  await db
    .prepare(`UPDATE accounting_outbox SET status = 'failed', last_error = COALESCE(last_error, 'max attempts') WHERE status = 'queued' AND attempts >= ? AND (claimed_at IS NULL OR claimed_at < ?)`)
    .bind(MAX_ATTEMPTS, new Date(Date.now() - CLAIM_MS).toISOString())
    .run()
  const rows = (
    await db
      .prepare(`SELECT id, subject, body_text, attachment_ids, attempts, from_name, cc_extra, zip_name, zip_paths FROM accounting_outbox WHERE status = 'queued' AND attempts < ? AND (claimed_at IS NULL OR claimed_at < ?) ORDER BY created_at, dedupe_key LIMIT ?`)
      .bind(MAX_ATTEMPTS, new Date(Date.now() - CLAIM_MS).toISOString(), limit)
      .all<{ id: string; subject: string; body_text: string; attachment_ids: string; attempts: number; from_name: string | null; cc_extra: string | null; zip_name: string | null; zip_paths: string | null }>()
  ).results
  const only = cfg.only?.length ? cfg.only : null
  const to = only ?? cfg.to
  const baseCc = only ? [] : cfg.cc
  const replyTo = cfg.replyTo
  let sent = 0
  let failed = 0
  for (const r of rows) {
    const now = new Date().toISOString()
    const claim = await db
      .prepare(`UPDATE accounting_outbox SET attempts = attempts + 1, claimed_at = ? WHERE id = ? AND status = 'queued' AND (claimed_at IS NULL OR claimed_at < ?)`)
      .bind(now, r.id, new Date(Date.now() - CLAIM_MS).toISOString())
      .run()
    if (claim.meta.changes !== 1) continue
    const cc = only ? [] : mergeCc(to, baseCc, r.cc_extra)
    try {
      const ids = JSON.parse(r.attachment_ids) as string[]
      const atts = ids.length
        ? (
            await db
              .prepare(`SELECT id, r2_key, original_name, content_type, is_sensitive FROM attachments WHERE id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL`)
              .bind(r.attachment_ids)
              .all<{ id: string; r2_key: string; original_name: string; content_type: string; is_sensitive: number }>()
          ).results
        : []
      let attachments: { name: string; contentType: string; bytes: Uint8Array }[] = []
      for (const a of atts) {
        const obj = await files.get(a.r2_key)
        if (!obj) throw new Error('attachment missing')
        attachments.push({ name: a.is_sensitive ? healthName(a.content_type) : a.original_name, contentType: a.content_type, bytes: new Uint8Array(await obj.arrayBuffer()) })
      }
      if (r.zip_name && attachments.length) {
        const paths = JSON.parse(r.zip_paths ?? '{}') as Record<string, string>
        const tree: Record<string, [Uint8Array, { level: 0 }]> = {}
        atts.forEach((a, n) => {
          const p = paths[a.id] ?? `${L().t('accounting.zip.other')}/${zipSafe(a.original_name, L().t('accounting.zip.file'))}`
          tree[p] = [attachments[n].bytes, { level: 0 }]
        })
        attachments = [{ name: r.zip_name, contentType: 'application/zip', bytes: zipSync(tree) }]
      }
      const result = await mailer.send({
        to: to.join(', '),
        cc,
        fromName: r.from_name ?? undefined,
        replyTo,
        subject: r.subject,
        text: r.body_text.replaceAll(GREETING, greetingLine(cfg.salutation)),
        attachments,
        headers: only ? { 'X-Original-Recipients': `To: ${cfg.to.join(', ')}; CC: ${mergeCc(cfg.to, cfg.cc, r.cc_extra).join(', ')}` } : undefined,
      })
      if (result === 'skipped') {
        await db.prepare(`UPDATE accounting_outbox SET status = 'failed', last_error = 'skipped: MAIL_ONLY', claimed_at = NULL WHERE id = ?`).bind(r.id).run()
        failed++
        continue
      }
      await db.batch([
        db.prepare(`UPDATE accounting_outbox SET status = 'sent', sent_at = ?, delivered_to = ? WHERE id = ?`).bind(now, `to=${to.join(', ')}; cc=${cc.join(', ')}`.slice(0, 1000), r.id),
        ...atts.filter((a) => a.is_sensitive).map((a) => audit(db, { actorId: null, action: 'attachment.mail', entityType: 'attachment', entityId: a.id, meta: { outbox: r.id, onlyMode: !!only } })),
      ])
      sent++
    } catch (e) {
      const last = r.attempts + 1 >= MAX_ATTEMPTS
      await db
        .prepare(`UPDATE accounting_outbox SET status = ?, last_error = ?, claimed_at = NULL WHERE id = ?`)
        .bind(last ? 'failed' : 'queued', (e instanceof Error ? e.message : 'send failed').slice(0, 500), r.id)
        .run()
      failed++
    }
  }
  return { sent, failed }
}
