import { currentLocale, forLocale, type MessageKey } from '#/i18n'
import { isLocale, type Locale } from '#/i18n/locales'
import { readLimitedForm } from './auth/routes'
import { runtimeConfig } from '#/config/runtime'
import { appNameOr } from '#/config/brand'
import { requestLocale } from './auth/routes'
import { mailDay, mailLeaveDays, mailMoney, mailRange } from './mailFormat'
import { authorize, HttpError, type AuthUser } from './auth/authorize'
import type { Ctx } from './ctx'
import { hashToken } from './actionToken'
import { nowIso, type Db } from './db/d1'
import { getRequest } from './db/requests'
import { findUserById, toAuthUser } from './db/users'
import { decideInvoice } from './services/invoiceApproval'
import { decide } from './services/requests'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

interface TokenRow {
  id: string
  entity_type: 'request' | 'invoice'
  entity_id: string
  user_id: string
  expires_at: string
  used_at: string | null
}

type Summary = { title: string; rows: [string, string][]; version?: number }

type Tr = ReturnType<typeof forLocale>

async function pendingSummary(db: Db, user: AuthUser, t: TokenRow, l: Tr): Promise<Summary | null> {
  if (t.entity_type === 'invoice') {
    const i = await db
      .prepare(
        `SELECT i.counterparty, i.invoice_no, i.invoice_date, i.net_base_minor, i.vat_base_minor, i.approval_status, i.uploaded_by, i.version, u.full_name AS who
         FROM invoices i JOIN users u ON u.id = i.uploaded_by WHERE i.id = ? AND i.archived_at IS NULL`,
      )
      .bind(t.entity_id)
      .first<{ counterparty: string; invoice_no: string; invoice_date: string; net_base_minor: number; vat_base_minor: number; approval_status: 'pending' | 'approved' | 'rejected'; uploaded_by: string; version: number; who: string }>()
    if (!i || !authorize(user, { a: 'invoice.decide', uploadedBy: i.uploaded_by, status: i.approval_status }).ok) return null
    return {
      version: i.version,
      title: l.t('actionLink.invoiceTitle'),
      rows: [
        [l.t('actionLink.row.supplier'), i.counterparty],
        [l.t('actionLink.row.invoiceNo'), i.invoice_no],
        [l.t('actionLink.row.invoiceDate'), mailDay(l.locale, i.invoice_date, true)],
        [l.t('actionLink.row.amount'), l.t('actionLink.vatIncluded', { amount: mailMoney(l.locale, i.net_base_minor + i.vat_base_minor) })],
        [l.t('actionLink.row.uploadedBy'), i.who],
      ],
    }
  }
  const r = await getRequest(db, t.entity_id)
  if (!r) return null
  const res = { requesterId: r.requester_id, type: r.type, status: r.status, approverRole: r.approver_role }
  if (!authorize(user, { a: 'request.decide', r: res }).ok) return null
  const kind = l.t(`actionLink.kind.${r.type}` as MessageKey)
  const rows: [string, string][] = [[l.t('actionLink.row.employee'), r.requester_name], [l.t('actionLink.row.type'), kind]]
  if (r.type === 'leave') {
    const lv = await db.prepare(`SELECT start_date, end_date, start_time, end_time, work_days FROM leave_requests WHERE request_id = ?`).bind(r.id).first<{ start_date: string; end_date: string; start_time: string | null; end_time: string | null; work_days: number }>()
    if (lv) {
      rows.push([l.t('actionLink.row.dates'), lv.start_time && lv.end_time ? `${mailDay(l.locale, lv.start_date)} ${lv.start_time}–${lv.end_time}` : mailRange(l.locale, lv.start_date, lv.end_date)])
      rows.push([l.t('actionLink.row.duration'), mailLeaveDays(l, lv.work_days, true)])
    }
  } else {
    if (r.total_base_minor != null) rows.push([l.t('actionLink.row.amount'), mailMoney(l.locale, r.total_base_minor)])
    if (r.submitted_at) rows.push([l.t('actionLink.row.submitted'), mailDay(l.locale, r.submitted_at.slice(0, 10))])
  }
  return { title: l.t('actionLink.requestTitle', { kind }), rows }
}

async function lookup(db: Db, token: string): Promise<{ t: TokenRow; user: AuthUser; locale: Locale | null } | 'unknown' | 'gone'> {
  if (!TOKEN_RE.test(token)) return 'unknown'
  const t = await db
    .prepare(`SELECT id, entity_type, entity_id, user_id, expires_at, used_at FROM action_tokens WHERE token_hash = ?`)
    .bind(await hashToken(token))
    .first<TokenRow>()
  if (!t) return 'unknown'
  if (t.used_at || t.expires_at <= new Date().toISOString()) return 'gone'
  const row = await findUserById(db, t.user_id)
  if (!row || row.status !== 'active' || row.can_login === 0) return 'gone'
  return { t, user: toAuthUser(row), locale: isLocale(row.locale) ? row.locale : null }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const PAGE_STYLE = `body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;background:#ECECF1;color:#17171C}
main{background:#fff;padding:28px 24px;border-radius:22px;box-shadow:0 18px 40px -28px rgba(0,0,0,.35);width:min(420px,calc(100vw - 32px));box-sizing:border-box}
h1{font-size:20px;font-weight:600;margin:0 0 4px;letter-spacing:-.02em}p{margin:0;color:#6A6A76;font-size:15px;line-height:1.5}
dl{margin:18px 0 22px;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:15px}dt{color:#6A6A76}dd{margin:0;font-weight:500;overflow-wrap:anywhere}
button{font:inherit;font-size:16px;font-weight:600;border:0;border-radius:14px;padding:14px 18px;width:100%;cursor:pointer}
.ok{background:#1F7A4D;color:#fff}.no{background:#C2362B;color:#fff;margin-top:10px}
details{margin-top:10px}summary{list-style:none;cursor:pointer}summary::-webkit-details-marker{display:none}details[open]>summary{display:none}
textarea{width:100%;box-sizing:border-box;margin:10px 0;border:1px solid #D4D4DC;border-radius:12px;padding:10px;font:inherit;font-size:15px;min-height:84px}
.danger{background:#C2362B;color:#fff}.err{color:#C2362F;margin-top:12px}a{color:#2456C9}.small{font-size:13px;margin-top:18px}`

function page(l: Tr, status: number, body: string): Response {
  const html = `<!doctype html><html lang="${l.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="strict-origin"><title>${esc(l.t('actionLink.pageTitle', { app: appNameOr(runtimeConfig().appName) }))}</title><style>${PAGE_STYLE}</style></head><body><main>${body}</main></body></html>`
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'strict-origin',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  })
}

const panelLink = (l: Tr, panelUrl: string) => (panelUrl ? `<p class="small"><a href="${esc(panelUrl.replace(/\/$/, ''))}/approvals">${esc(l.t('actionLink.openPanel'))}</a></p>` : '')

const goneBody = (l: Tr, panelUrl: string) => `<h1>${esc(l.t('actionLink.gone.title'))}</h1><p>${esc(l.t('actionLink.gone.body'))}</p>${panelLink(l, panelUrl)}`

const rejected = (l: Tr) => `<h1>${esc(l.t('actionLink.rejectedRequest'))}</h1>`

function decisionPage(l: Tr, token: string, s: Summary, opts: { reject: boolean; error?: string; note?: string; panelUrl: string }): string {
  const rows = s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
  const t = esc(token)
  const ver = s.version ? `<input type="hidden" name="v" value="${s.version}">` : ''
  const approve = esc(l.t('actionLink.approve'))
  const reject = esc(l.t('actionLink.reject'))
  return `<h1>${esc(s.title)}</h1><p>${esc(l.t('actionLink.waiting'))}</p><dl>${rows}</dl>
<form method="post"><input type="hidden" name="t" value="${t}"><input type="hidden" name="d" value="approved">${ver}<button class="ok" type="submit">&#10003; ${approve}</button></form>
<details${opts.reject ? ' open' : ''}><summary><span class="no" style="display:block;text-align:center;border-radius:14px;padding:14px 18px;font-weight:600">&#10005; ${reject}</span></summary>
<form method="post"><input type="hidden" name="t" value="${t}"><input type="hidden" name="d" value="rejected">${ver}<label for="n" style="display:block;margin-top:12px;font-size:14px;color:#6A6A76">${esc(l.t('actionLink.reasonLabel'))}</label><textarea id="n" name="n" maxlength="1000" required>${esc(opts.note ?? '')}</textarea><button class="danger" type="submit">&#10005; ${reject}</button></form></details>
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}${panelLink(l, opts.panelUrl)}`
}

async function donePage(l: Tr, db: Db, t: TokenRow, s: Summary, d: 'approved' | 'rejected', panelUrl: string): Promise<string> {
  const rows = s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
  if (d === 'rejected') return `<h1>${esc(l.t('actionLink.done.rejectedTitle'))}</h1><p>${esc(l.t('actionLink.done.rejected', { title: s.title }))}</p><dl>${rows}</dl>${panelLink(l, panelUrl)}`
  const acct = await db
    .prepare(`SELECT 1 AS x FROM accounting_outbox WHERE entity_type = ? AND entity_id = ? AND status IN ('queued','sent') LIMIT 1`)
    .bind(t.entity_type, t.entity_id)
    .first()
  return `<h1>&#10003; ${esc(l.t('actionLink.done.approvedTitle'))}</h1><p>${esc(l.t('actionLink.done.approved', { title: s.title }))}${acct ? ` ${esc(l.t('actionLink.done.sentToAccounting'))}` : ''}</p><dl>${rows}</dl>${panelLink(l, panelUrl)}`
}

export async function handleActionLink(request: Request, url: URL, deps: { db: Db; panelUrl: string; ctxFor?: (user: AuthUser) => Ctx }): Promise<Response> {
  const token = url.pathname.slice('/a/'.length)
  const found = await lookup(deps.db, token)
  const guest = forLocale(requestLocale(request, currentLocale()))
  if (found === 'unknown') return page(guest, 404, `<h1>${esc(guest.t('actionLink.unknown.title'))}</h1><p>${esc(guest.t('actionLink.unknown.body'))}</p>${panelLink(guest, deps.panelUrl)}`)
  if (found === 'gone') return page(guest, 410, goneBody(guest, deps.panelUrl))
  const { t, user } = found
  const l = found.locale ? forLocale(found.locale) : guest
  const summary = await pendingSummary(deps.db, user, t, l)
  if (!summary) return page(l, 410, goneBody(l, deps.panelUrl))

  if (request.method === 'GET' || request.method === 'HEAD') {
    return page(l, 200, decisionPage(l, token, summary, { reject: url.searchParams.get('r') === '1', panelUrl: deps.panelUrl }))
  }
  if (request.method !== 'POST') return page(l, 405, rejected(l))
  if (request.headers.get('Origin') !== url.origin) return page(l, 403, rejected(l))
  const form = await readLimitedForm(request)
  if (!form || form.t !== token) return page(l, form === null ? 413 : 400, rejected(l))
  const d = form.d
  const note = typeof form.n === 'string' ? form.n.slice(0, 1000) : ''
  if (d !== 'approved' && d !== 'rejected') return page(l, 400, rejected(l))
  if (d === 'rejected' && !note.trim()) return page(l, 422, decisionPage(l, token, summary, { reject: true, error: l.t('actionLink.reasonRequired'), panelUrl: deps.panelUrl }))

  const ctx: Ctx = deps.ctxFor?.(user) ?? { db: deps.db, user, store: { put: async () => {}, discard: async () => {} } }
  let res: { ok: true } | { ok: false; error: string }
  const ip = request.headers.get('cf-connecting-ip')?.slice(0, 64)
  const ua = request.headers.get('user-agent')?.slice(0, 200)
  const client = { ...(ip ? { ip } : {}), ...(ua ? { ua } : {}) }
  try {
    res = t.entity_type === 'invoice' ? await decideInvoice(ctx, t.entity_id, d, note, { via: 'email', client, expectedVersion: Number(form.v) }) : await decide(ctx, t.entity_id, d, note, { via: 'email', client })
  } catch (e) {
    if (e instanceof HttpError) return page(l, e.status === 404 ? 404 : 403, `<h1>${esc(l.t('actionLink.noAccess.title'))}</h1><p>${esc(l.t('actionLink.noAccess.body'))}</p>${panelLink(l, deps.panelUrl)}`)
    throw e
  }
  if (!res.ok) return page(l, 409, `<h1>${esc(l.t('actionLink.failedTitle'))}</h1><p>${esc(res.error)}</p>${panelLink(l, deps.panelUrl)}`)
  await deps.db.prepare(`UPDATE action_tokens SET used_at = COALESCE(used_at, ?) WHERE id = ?`).bind(nowIso(), t.id).run()
  return page(l, 200, await donePage(l, deps.db, t, summary, d, deps.panelUrl))
}
