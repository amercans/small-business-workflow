import type { ApproverRole, RequestKind } from './auth/authorize'
import { forLocale, type Locale, type MessageKey } from '#/i18n'
import { isLocale } from '#/i18n/locales'
import { currentLocale } from '#/i18n'
import { runtimeConfig } from '#/config/runtime'
import { appNameOr } from '#/config/brand'
import type { Currency } from '#/lib/money'
import { issueToken } from './actionToken'
import { ulid, type Db, type Stmt } from './db/d1'
import { mailDay, mailLeaveDays, mailMoney, mailRange } from './mailFormat'

export const PANEL = '{PANEL}'
export const ACTIONS = '{APPROVAL_LINKS}'

export type Template = 'request_submitted' | 'request_decided' | 'request_paid' | 'agreement_expiring' | 'digital_renewal'

export type LeaveKindDb = 'annual' | 'excuse' | 'sick' | 'unpaid' | 'other'

export interface MailFacts {
  amountMinor?: number | null
  currency?: Currency
  leave?: {
    start: string
    end: string
    startTime?: string | null
    endTime?: string | null
    days: number
    kind: LeaveKindDb | string
    balance?: { now: number; after: number; deducts: boolean }
  }
}

export type MailMessage =
  | { kind: 'submitted'; params: { requestKind: RequestKind; who: string; facts: MailFacts } }
  | { kind: 'invoiceSubmitted'; params: { who: string; firm: string; no: string; amountMinor: number; currency?: Currency } }
  | { kind: 'invoiceRejected'; params: { firm: string; no: string; reason: string } }
  | { kind: 'submittedFyi'; params: { requestKind: RequestKind; requestId: string; who: string; stage: ApproverRole | 'auto'; facts: MailFacts } }
  | { kind: 'decided'; params: { requestKind: RequestKind; requestId: string; day: string; decision: 'approved' | 'rejected'; facts: MailFacts } }
  | { kind: 'leaveCancelled'; params: { requestId: string; who: string; facts: MailFacts } }
  | { kind: 'paid'; params: { requestKind: RequestKind; requestId: string; day: string; facts: MailFacts } }
  | { kind: 'expiring'; params: { agreementId: string; counterparty: string; end: string; daysLeft: number } }
  | { kind: 'renewal'; params: { name: string; date: string; daysLeft: number } }

export interface Mail {
  to: string
  template: Template
  entityType: string
  entityId: string
  dedupe: string
  message: MailMessage
}

type Tr = ReturnType<typeof forLocale>

const kindWord = (l: Tr, k: RequestKind) => l.t(`mail.kind.${k}` as MessageKey)
const kindTitle = (l: Tr, k: RequestKind) => l.t(`mail.kindTitle.${k}` as MessageKey)
const leavePhrase = (l: Tr, kind: string) => (kind === 'annual' ? l.t('mail.leavePhrase.annual') : l.t('mail.leavePhrase.other'))
const amountOf = (l: Tr, f: MailFacts) => (f.amountMinor == null ? null : mailMoney(l.locale, f.amountMinor, f.currency))
const rangeOf = (l: Tr, lv: NonNullable<MailFacts['leave']>) => (lv.startTime && lv.endTime ? `${mailDay(l.locale, lv.start)} ${lv.startTime}–${lv.endTime}` : mailRange(l.locale, lv.start, lv.end))

function what(l: Tr, kind: RequestKind, f: MailFacts): string {
  if (kind === 'leave' && f.leave) return l.t('mail.what.leave', { range: rangeOf(l, f.leave), phrase: leavePhrase(l, f.leave.kind), phraseA: f.leave.kind === 'annual' ? l.t('mail.leavePhraseA.annual') : l.t('mail.leavePhraseA.other'), days: mailLeaveDays(l, f.leave.days, true) })
  const amount = amountOf(l, f)
  const kindA = l.t(`mail.kindA.${kind}` as MessageKey)
  return amount ? l.t('mail.what.withAmount', { amount, kind: kindWord(l, kind), kindA }) : l.t('mail.what.plain', { kind: kindWord(l, kind), kindA })
}

function yours(l: Tr, kind: RequestKind, day: string, f: MailFacts): string {
  if (kind === 'leave' && f.leave) return l.t('mail.yours.leave', { range: rangeOf(l, f.leave), phrase: leavePhrase(l, f.leave.kind) })
  const amount = amountOf(l, f)
  return amount ? l.t('mail.yours.withAmount', { day: mailDay(l.locale, day), amount, kind: kindWord(l, kind) }) : l.t('mail.yours.plain', { day: mailDay(l.locale, day), kind: kindWord(l, kind) })
}

const signed = (l: Tr, n: number) => (n < 0 ? l.t('mail.balance.negative', { days: mailLeaveDays(l, n) }) : mailLeaveDays(l, n))

function balanceLine(l: Tr, f: MailFacts): string | null {
  const b = f.leave?.balance
  if (!b) return null
  return b.deducts ? l.t('mail.balance.deducts', { now: signed(l, b.now), after: signed(l, b.after) }) : l.t('mail.balance.keeps', { now: signed(l, b.now) })
}

const amountSuffix = (l: Tr, f: MailFacts) => {
  const a = amountOf(l, f)
  return a ? ` · ${a}` : ''
}

const capFirst = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

const compose = (l: Tr, parts: (string | null | undefined)[]) =>
  [...parts.filter((p): p is string => !!p), `${l.t('mail.footDetails')} ${l.t('mail.foot', { app: appNameOr(runtimeConfig().appName) })}`].join('\n\n')

export function renderMail(locale: Locale, msg: MailMessage): { subject: string; text: string } {
  const l = forLocale(locale)
  switch (msg.kind) {
    case 'submitted': {
      const p = msg.params
      return {
        subject: p.requestKind === 'leave' ? l.t('mail.submitted.subjectLeave', { who: p.who }) : l.t('mail.submitted.subject', { who: p.who, kind: kindTitle(l, p.requestKind), amount: amountSuffix(l, p.facts) }),
        text: compose(l, [
          `${l.t('mail.submitted.body', { who: p.who, what: what(l, p.requestKind, p.facts) })} ${l.t('mail.submitted.waiting')}`,
          balanceLine(l, p.facts),
          ACTIONS,
          `${l.t('mail.link.approvals')}: ${PANEL}/approvals`,
        ]),
      }
    }
    case 'invoiceSubmitted': {
      const p = msg.params
      const amount = mailMoney(locale, p.amountMinor, p.currency)
      return {
        subject: l.t('mail.invoiceSubmitted.subject', { firm: p.firm, amount }),
        text: compose(l, [l.t('mail.invoiceSubmitted.body', { who: p.who, firm: p.firm, no: p.no, amount }), ACTIONS, `${l.t('mail.link.approvals')}: ${PANEL}/approvals`]),
      }
    }
    case 'invoiceRejected': {
      const p = msg.params
      return {
        subject: l.t('mail.invoiceRejected.subject', { firm: p.firm }),
        text: compose(l, [l.t('mail.invoiceRejected.body', { firm: p.firm, no: p.no }), `${l.t('mail.invoiceRejected.reason')}: ${p.reason.replace(/\s+/g, ' ').trim().slice(0, 500)}`, `${l.t('mail.link.invoices')}: ${PANEL}/invoices`]),
      }
    }
    case 'submittedFyi': {
      const p = msg.params
      const stage = p.stage === 'auto' ? l.t('mail.fyi.auto') : l.t('mail.fyi.waitingOn', { role: l.t(`roles.${p.stage}`) })
      return {
        subject: p.requestKind === 'leave' ? l.t('mail.fyi.subjectLeave', { who: p.who }) : l.t('mail.fyi.subject', { who: p.who, kind: kindTitle(l, p.requestKind), amount: amountSuffix(l, p.facts) }),
        text: compose(l, [`${l.t('mail.submitted.body', { who: p.who, what: what(l, p.requestKind, p.facts) })} ${l.t('mail.fyi.info', { stage })}`, balanceLine(l, p.facts), `${l.t('mail.link.viewRequest')}: ${PANEL}/all-requests/${p.requestId}`]),
      }
    }
    case 'decided': {
      const p = msg.params
      const y = capFirst(yours(l, p.requestKind, p.day, p.facts))
      return {
        subject: p.decision === 'approved' ? l.t('mail.decided.subjectApproved', { kind: kindWord(l, p.requestKind), title: kindTitle(l, p.requestKind) }) : l.t('mail.decided.subjectRejected', { kind: kindWord(l, p.requestKind), title: kindTitle(l, p.requestKind) }),
        text: compose(l, [p.decision === 'approved' ? l.t('mail.decided.approved', { yours: y }) : l.t('mail.decided.rejected', { yours: y }), `${l.t('mail.link.request')}: ${PANEL}/requests/${p.requestId}`]),
      }
    }
    case 'leaveCancelled': {
      const p = msg.params
      return {
        subject: l.t('mail.cancelled.subject', { who: p.who }),
        text: compose(l, [p.facts.leave ? l.t('mail.cancelled.bodyRange', { who: p.who, range: rangeOf(l, p.facts.leave) }) : l.t('mail.cancelled.body', { who: p.who }), `${l.t('mail.link.viewRequest')}: ${PANEL}/all-requests/${p.requestId}`]),
      }
    }
    case 'paid': {
      const p = msg.params
      return {
        subject: l.t('mail.paid.subject', { kind: kindWord(l, p.requestKind), title: kindTitle(l, p.requestKind), amount: amountSuffix(l, p.facts) }),
        text: compose(l, [l.t('mail.paid.body', { yours: capFirst(yours(l, p.requestKind, p.day, p.facts)) }), `${l.t('mail.link.request')}: ${PANEL}/requests/${p.requestId}`]),
      }
    }
    case 'expiring': {
      const p = msg.params
      return {
        subject: l.t('mail.expiring.subject', { counterparty: p.counterparty }),
        text: compose(l, [l.tn('mail.expiring.body', p.daysLeft, { counterparty: p.counterparty, date: mailDay(locale, p.end, true) }), `${l.t('mail.link.agreement')}: ${PANEL}/agreements/${p.agreementId}`]),
      }
    }
    case 'renewal': {
      const p = msg.params
      return {
        subject: l.t('mail.renewal.subject', { name: p.name }),
        text: compose(l, [l.tn('mail.renewal.body', p.daysLeft, { name: p.name, date: mailDay(locale, p.date, true) }), `${l.t('mail.link.digital')}: ${PANEL}/inventory?tab=digital`]),
      }
    }
  }
}

export const mails = {
  submitted: (to: string, requestId: string, kind: RequestKind, who: string, f: MailFacts = {}): Mail => ({
    to, template: 'request_submitted', entityType: 'request', entityId: requestId,
    dedupe: `request_submitted:${requestId}:${to}`,
    message: { kind: 'submitted', params: { requestKind: kind, who, facts: f } },
  }),
  invoiceSubmitted: (to: string, invoiceId: string, who: string, firm: string, no: string, amountMinor: number, currency?: Currency): Mail => ({
    to, template: 'request_submitted', entityType: 'invoice', entityId: invoiceId, dedupe: `invoice_submitted:${invoiceId}:${to}`,
    message: { kind: 'invoiceSubmitted', params: { who, firm, no, amountMinor, ...(currency ? { currency } : {}) } },
  }),
  invoiceRejected: (to: string, invoiceId: string, firm: string, no: string, reason: string): Mail => ({
    to, template: 'request_decided', entityType: 'invoice', entityId: invoiceId, dedupe: `invoice_decided:${invoiceId}`,
    message: { kind: 'invoiceRejected', params: { firm, no, reason: reason.slice(0, 600) } },
  }),
  submittedFyi: (to: string, requestId: string, kind: RequestKind, who: string, stage: ApproverRole | 'auto', f: MailFacts = {}): Mail => ({
    to, template: 'request_submitted', entityType: 'request', entityId: requestId, dedupe: `request_submitted:${requestId}:${to}`,
    message: { kind: 'submittedFyi', params: { requestKind: kind, requestId, who, stage, facts: f } },
  }),
  decided: (to: string, requestId: string, kind: RequestKind, day: string, decision: 'approved' | 'rejected', f: MailFacts = {}): Mail => ({
    to, template: 'request_decided', entityType: 'request', entityId: requestId, dedupe: `request_decided:${requestId}`,
    message: { kind: 'decided', params: { requestKind: kind, requestId, day, decision, facts: f } },
  }),
  leaveCancelled: (to: string, requestId: string, who: string, f: MailFacts = {}): Mail => ({
    to, template: 'request_decided', entityType: 'request', entityId: requestId, dedupe: `request_cancelled:${requestId}:${to}`,
    message: { kind: 'leaveCancelled', params: { requestId, who, facts: f } },
  }),
  paid: (to: string, requestId: string, kind: RequestKind, day: string, f: MailFacts = {}): Mail => ({
    to, template: 'request_paid', entityType: 'request', entityId: requestId, dedupe: `request_paid:${requestId}`,
    message: { kind: 'paid', params: { requestKind: kind, requestId, day, facts: f } },
  }),
  expiring: (to: string, agreementId: string, counterparty: string, end: string, daysLeft: number, threshold: number): Mail => ({
    to, template: 'agreement_expiring', entityType: 'agreement', entityId: agreementId, dedupe: `agreement_expiring:${agreementId}:${end}:${threshold}:${to}`,
    message: { kind: 'expiring', params: { agreementId, counterparty, end, daysLeft } },
  }),
  renewal: (to: string, assetId: string, name: string, date: string, daysLeft: number, threshold: number): Mail => ({
    to, template: 'digital_renewal', entityType: 'digital_asset', entityId: assetId, dedupe: `digital_renewal:${assetId}:${date}:${threshold}:${to}`,
    message: { kind: 'renewal', params: { name, date, daysLeft } },
  }),
}

export async function requestMailFacts(db: Db, r: { id: string; type: RequestKind; total_base_minor: number | null }): Promise<MailFacts> {
  if (r.type !== 'leave') return { amountMinor: r.total_base_minor }
  const l = await db
    .prepare(`SELECT kind, start_date, end_date, start_time, end_time, work_days FROM leave_requests WHERE request_id = ?`)
    .bind(r.id)
    .first<{ kind: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; work_days: number }>()
  return l ? { leave: { start: l.start_date, end: l.end_date, startTime: l.start_time, endTime: l.end_time, days: l.work_days, kind: l.kind } } : {}
}

export function keepTemplateActions(text: string): string {
  const i = text.lastIndexOf(ACTIONS)
  if (i < 0) return text
  return text.slice(0, i).replaceAll(ACTIONS, '') + text.slice(i)
}

export const mailFallbackLocale = (): Locale => currentLocale()

export const recipientLocale = (value: string | null | undefined): Locale => (isLocale(value) ? value : mailFallbackLocale())

export function enqueue(db: Db, list: Mail[]): Stmt[] {
  return list.map((m) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO email_outbox (id, to_user_id, template, entity_type, entity_id, dedupe_key, message_json)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND (role <> 'owner' OR ? LIKE 'request_submitted:%'))`,
      )
      .bind(ulid(), m.to, m.template, m.entityType, m.entityId, m.dedupe, JSON.stringify(m.message), m.to, m.dedupe),
  )
}

export async function newRequestRecipients(db: Db, requesterId: string, approver: ApproverRole | 'auto'): Promise<{ approvers: string[]; watchers: string[] }> {
  const rows = (await db.prepare(`SELECT id, role FROM users WHERE status = 'active' AND can_login = 1 AND role IN ('manager','approver','owner') AND id <> ?`).bind(requesterId).all<{ id: string; role: string }>()).results
  return {
    approvers: approver === 'auto' ? [] : rows.filter((r) => r.role === approver).map((r) => r.id),
    watchers: rows.filter((r) => r.role === 'manager' && r.role !== approver).map((r) => r.id),
  }
}

export interface Mailer {
  send(m: { to: string; subject: string; text: string; html?: string; cc?: string[]; replyTo?: string; fromName?: string; headers?: Record<string, string>; attachments?: { name: string; contentType: string; bytes: Uint8Array }[] }): Promise<void | 'skipped'>
}

export const logMailer: Mailer = {
  async send(m) {
    console.log(`[mail] ${m.to}${m.cc?.length ? ` (cc ${m.cc.join(', ')})` : ''} - ${m.subject}${m.attachments?.length ? ` (${m.attachments.length} attachments)` : ''}`)
  },
}

const MAX_ATTEMPTS = 5
const MAX_AGE_MS = 48 * 3600_000
const CLAIM_MS = 5 * 60_000

export async function deliver(db: Db, mailer: Mailer, panelUrl: string, limit = 20): Promise<{ sent: number; failed: number }> {
  await db
    .prepare(`UPDATE email_outbox SET status = 'failed', last_error = 'expired' WHERE status = 'queued' AND created_at < ?`)
    .bind(new Date(Date.now() - MAX_AGE_MS).toISOString())
    .run()
  const rows = (
    await db
      .prepare(
        `SELECT o.id, o.template, o.message_json, o.attempts, o.entity_type, o.entity_id, o.to_user_id, u.email, u.status, u.locale FROM email_outbox o JOIN users u ON u.id = o.to_user_id
         WHERE o.status = 'queued' AND (o.claimed_at IS NULL OR o.claimed_at < ?) ORDER BY o.created_at LIMIT ?`,
      )
      .bind(new Date(Date.now() - CLAIM_MS).toISOString(), limit)
      .all<{ id: string; template: string; message_json: string; attempts: number; entity_type: string; entity_id: string; to_user_id: string; email: string; status: string; locale: string | null }>()
  ).results
  let sent = 0
  let failed = 0
  for (const r of rows) {
    const now = new Date().toISOString()
    if (r.status !== 'active') {
      await db.prepare(`UPDATE email_outbox SET status = 'failed', last_error = 'recipient inactive' WHERE id = ?`).bind(r.id).run()
      failed++
      continue
    }
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(r.email) || r.email.toLowerCase().endsWith('.invalid')) {
      await db.prepare(`UPDATE email_outbox SET status = 'failed', last_error = 'invalid address' WHERE id = ?`).bind(r.id).run()
      failed++
      continue
    }
    const claim = await db
      .prepare(`UPDATE email_outbox SET attempts = attempts + 1, claimed_at = ? WHERE id = ? AND status = 'queued' AND (claimed_at IS NULL OR claimed_at < ?)`)
      .bind(now, r.id, new Date(Date.now() - CLAIM_MS).toISOString())
      .run()
    if (claim.meta.changes !== 1) continue
    try {
      const locale = recipientLocale(r.locale)
      const rendered = renderMail(locale, JSON.parse(r.message_json) as MailMessage)
      const subject = rendered.subject.replace(/[\r\n]+/g, ' ').slice(0, 200)
      const base = panelUrl.replace(/\/$/, '')
      const body = keepTemplateActions(rendered.text).replaceAll(PANEL, base)
      if (r.template === 'request_submitted' && body.includes(ACTIONS) && base && (r.entity_type === 'request' || r.entity_type === 'invoice')) {
        const t = await issueToken(db, { entityType: r.entity_type, entityId: r.entity_id, userId: r.to_user_id })
        const links = { approve: `${base}/a/${t}`, reject: `${base}/a/${t}?r=1` }
        await mailer.send({ to: r.email, subject, text: body.replace(ACTIONS, actionText(links, locale)), html: actionHtml(body, links, base, locale) })
      } else {
        await mailer.send({ to: r.email, subject, text: body.replace(ACTIONS, '').replace(/\n{3,}/g, '\n\n') })
      }
      await db.prepare(`UPDATE email_outbox SET status = 'sent', sent_at = ? WHERE id = ?`).bind(now, r.id).run()
      sent++
    } catch (e) {
      const last = r.attempts + 1 >= MAX_ATTEMPTS
      await db
        .prepare(`UPDATE email_outbox SET status = ?, last_error = ?, claimed_at = NULL WHERE id = ?`)
        .bind(last ? 'failed' : 'queued', (e instanceof Error ? e.message : 'send failed').slice(0, 500), r.id)
        .run()
      failed++
    }
  }
  return { sent, failed }
}

export const actionText = (l: { approve: string; reject: string }, locale: Locale = mailFallbackLocale()) => {
  const tr = forLocale(locale)
  return `${tr.t('mail.actions.approve')}: ${l.approve}\n${tr.t('mail.actions.reject')}: ${l.reject}\n${tr.t('mail.actions.note')}`
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const paras = (s: string, base = '') =>
  s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#17171C">${escHtml(p).replace(/\n/g, '<br>').replace(/(https:\/\/[^\s<]+)/g, (u) => (base && (u === base || u.startsWith(`${base}/`)) ? `<a class="lnk" href="${u}" style="color:#2456C9">${u}</a>` : u))}</p>`)
    .join('')

export function actionHtml(body: string, l: { approve: string; reject: string }, base = '', locale: Locale = mailFallbackLocale()): string {
  const tr = forLocale(locale)
  const [pre, post = ''] = body.split(ACTIONS)
  const btn = (href: string, label: string, bg: string) =>
    `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${bg}" style="border-radius:12px;background:${bg}"><a href="${escHtml(href)}" style="display:block;padding:15px 18px;border:2px solid ${bg};border-radius:12px;background:${bg};color:#ffffff;font-weight:700;font-size:16px;line-height:20px;text-align:center;text-decoration:none">${label}</a></td></tr></table></td></tr>`
  const head = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}@media (prefers-color-scheme:dark){.bg{background:#000000!important}.card{background:#1C1C1E!important}.card p{color:#F2F2F7!important}.card .muted{color:#9A9AA3!important}.card a.lnk{color:#7FA7FF!important}}</style></head>`
  return `<!doctype html><html lang="${locale}">${head}<body class="bg" style="margin:0;padding:24px;background:#F4F4F7;font-family:system-ui,-apple-system,Segoe UI,sans-serif"><div class="card" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">${paras(pre, base)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px">${btn(l.approve, `&#10003; ${escHtml(tr.t('mail.actions.approve'))}`, '#1F7A4D')}${btn(l.reject, `&#10005; ${escHtml(tr.t('mail.actions.reject'))}`, '#C2362B')}</table><p class="muted" style="margin:0 0 18px;font-size:12px;line-height:1.5;color:#6A6A76">${escHtml(tr.t('mail.actions.note'))}</p>${paras(post, base)}</div></body></html>`
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

export async function dailyMails(db: Db, today: string): Promise<Mail[]> {
  const out: Mail[] = []
  const to = (await db.prepare(`SELECT id FROM users WHERE status = 'active' AND role = 'manager'`).all<{ id: string }>()).results
  const ags = (
    await db
      .prepare(`SELECT id, counterparty, end_date FROM agreements WHERE archived_at IS NULL AND end_date BETWEEN ? AND date(?, '+30 days')`)
      .bind(today, today)
      .all<{ id: string; counterparty: string; end_date: string }>()
  ).results
  for (const g of ags) {
    const left = daysBetween(today, g.end_date)
    const threshold = left <= 7 ? 7 : 30
    for (const m of to) out.push(mails.expiring(m.id, g.id, g.counterparty, g.end_date, left, threshold))
  }
  const dig = (
    await db
      .prepare(`SELECT id, name, renews_on FROM digital_assets WHERE status = 'active' AND renews_on BETWEEN ? AND date(?, '+30 days')`)
      .bind(today, today)
      .all<{ id: string; name: string; renews_on: string }>()
  ).results
  for (const g of dig) {
    const left = daysBetween(today, g.renews_on)
    const threshold = left <= 7 ? 7 : 30
    for (const m of to) out.push(mails.renewal(m.id, g.id, g.name, g.renews_on, left, threshold))
  }
  return out
}
