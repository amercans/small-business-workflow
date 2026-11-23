import { expenseCategoryLabel } from '#/lib/requestSchemas'
import { formatRange } from '#/lib/leave'
import { lazyLabels, STATUS_KEYS } from '../i18nLabels'
import { runtimeConfig } from '#/config/runtime'
import { currencyLabel } from '#/lib/money'
import { formatDate } from '#/i18n/format'
import type { Messages } from '#/i18n/lang/en'
import { t } from '#/i18n'
import { roleLabel, type Role } from '#/lib/permissions'
import { must } from '../auth/authorize'
import type { Ctx } from '../ctx'
import { audit } from '../db/d1'
import { todayISO } from '../time'
import { LEAVE_KIND_LABEL, LEAVE_KIND_NAME, PERIOD_LABEL_TR, PURCHASE_LABEL, TRANSPORT_LABEL } from '../views'

export const STATUS_TR: Record<string, string> = lazyLabels(STATUS_KEYS, (k) => `server.status.${k}` as const)

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { from: `${month}-01`, to: `${next}-01` }
}

export const validMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

export interface LeaveBalanceRow {
  userId: string
  name: string
  role: string
  entitled: number | null
  usedBefore: number
  used: number
  pending: number
  left: number | null
  other: { excuse: number; sick: number; unpaid: number; other: number }
  statementAt: string | null
}

export interface LeaveEntry {
  id: string
  name: string
  kind: string
  range: string
  start: string
  end: string
  days: number
  status: string
}

export interface LeaveReport {
  year: number
  month: string
  balances: LeaveBalanceRow[]
  entries: LeaveEntry[]
  totals: { onLeaveDays: number; pendingCount: number }
}

export async function leaveReport(ctx: Ctx, month: string): Promise<LeaveReport> {
  must(ctx.user, { a: 'report.read' })
  const year = Number(month.slice(0, 4))
  const { from, to } = monthRange(month)
  const [users, sums, entries] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT u.id, u.display_name, u.role, e.entitled_days, COALESCE(e.used_before_days, 0) AS used_before, ls.confirmed_at AS statement_at
         FROM users u LEFT JOIN leave_entitlements e ON e.user_id = u.id AND e.year = ?
         LEFT JOIN leave_statements ls ON ls.user_id = u.id AND ls.year = ? WHERE u.status = 'active' AND u.can_login = 1 ORDER BY u.display_name`,
      )
      .bind(year, year)
      .all<{ id: string; display_name: string; role: Role; entitled_days: number | null; used_before: number; statement_at: string | null }>(),
    ctx.db
      .prepare(
        `SELECT r.requester_id AS uid, l.kind, r.status, SUM(l.work_days) AS days FROM leave_requests l JOIN requests r ON r.id = l.request_id
         WHERE l.year = ? AND r.status IN ('approved','pending') GROUP BY r.requester_id, l.kind, r.status`,
      )
      .bind(year)
      .all<{ uid: string; kind: keyof typeof LEAVE_KIND_LABEL; status: string; days: number }>(),
    ctx.db
      .prepare(
        `SELECT r.id, u.display_name, l.kind, l.start_date, l.end_date, l.work_days, r.status FROM leave_requests l
         JOIN requests r ON r.id = l.request_id JOIN users u ON u.id = r.requester_id
         WHERE r.status IN ('approved','pending') AND l.start_date < ? AND l.end_date >= ? ORDER BY l.start_date, u.display_name`,
      )
      .bind(to, from)
      .all<{ id: string; display_name: string; kind: keyof typeof LEAVE_KIND_LABEL; start_date: string; end_date: string; work_days: number; status: string }>(),
  ])
  const sum = (uid: string, kind: string, status: string) => sums.results.find((s) => s.uid === uid && s.kind === kind && s.status === status)?.days ?? 0
  const balances = users.results.map((u) => {
    const used = sum(u.id, 'annual', 'approved')
    return {
      userId: u.id,
      name: u.display_name,
      role: roleLabel(u.role),
      entitled: u.entitled_days,
      usedBefore: u.used_before,
      used,
      pending: sum(u.id, 'annual', 'pending'),
      left: u.entitled_days == null ? null : u.entitled_days - u.used_before - used,
      other: { excuse: sum(u.id, 'excuse', 'approved'), sick: sum(u.id, 'sick', 'approved'), unpaid: sum(u.id, 'unpaid', 'approved'), other: sum(u.id, 'other', 'approved') },
      statementAt: u.statement_at,
    }
  })
  const list = entries.results.map((e) => ({
    id: e.id,
    name: e.display_name,
    kind: LEAVE_KIND_NAME[e.kind],
    range: formatRange(e.start_date, e.end_date),
    start: e.start_date,
    end: e.end_date,
    days: e.work_days,
    status: STATUS_TR[e.status],
  }))
  return {
    year,
    month,
    balances,
    entries: list,
    totals: { onLeaveDays: entries.results.filter((e) => e.status === 'approved').reduce((s, e) => s + e.work_days, 0), pendingCount: entries.results.filter((e) => e.status === 'pending').length },
  }
}

export interface ExpenseLine {
  requestId: string
  date: string
  name: string
  project: string
  category: string
  description: string
  currency: string
  amountOriginal: number
  docNo: string
  vat: number | null
  amount: number
  status: string
}

export interface AdvanceLine {
  requestId: string
  name: string
  title: string
  amount: number
  neededOn: string
  status: string
  open: number
}

export interface Group {
  key: string
  amount: number
  count: number
}

export interface ExpenseReport {
  month: string
  lines: ExpenseLine[]
  advances: AdvanceLine[]
  openAdvances: { name: string; open: number; since: string }[]
  byPerson: Group[]
  byProject: Group[]
  byCategory: Group[]
  totals: { approved: number; approvedCount: number; pending: number; pendingCount: number; advancesPaid: number; openAdvances: number }
}

const group = (lines: ExpenseLine[], key: (l: ExpenseLine) => string): Group[] => {
  const m = new Map<string, Group>()
  for (const l of lines) {
    const k = key(l) || '—'
    const g = m.get(k) ?? { key: k, amount: 0, count: 0 }
    g.amount += l.amount
    g.count++
    m.set(k, g)
  }
  return [...m.values()].map((g) => ({ ...g, amount: Math.round(g.amount * 100) / 100 })).sort((a, b) => b.amount - a.amount)
}

export async function expenseReport(ctx: Ctx, month: string): Promise<ExpenseReport> {
  must(ctx.user, { a: 'report.read' })
  const { from, to } = monthRange(month)
  const [items, advs, open] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT r.id AS rid, it.expense_date, u.display_name, r.project, it.category, it.description, it.currency, it.amount_minor, it.amount_base_minor, it.doc_no, it.vat_minor, r.status
         FROM request_items it JOIN requests r ON r.id = it.request_id JOIN users u ON u.id = r.requester_id
         WHERE it.archived_at IS NULL AND r.status IN ('pending','approved','paid') AND it.expense_date >= ? AND it.expense_date < ?
         ORDER BY it.expense_date, u.display_name, it.line_no`,
      )
      .bind(from, to)
      .all<{ rid: string; expense_date: string; display_name: string; project: string | null; category: string; description: string | null; currency: string; amount_minor: number; amount_base_minor: number; doc_no: string | null; vat_minor: number | null; status: string }>(),
    ctx.db
      .prepare(
        `SELECT r.id, u.display_name, r.title, a.amount_minor, a.needed_on, r.status,
                CASE WHEN a.travel_request_id IS NULL OR EXISTS (SELECT 1 FROM advance_closures c WHERE c.advance_request_id = r.id) THEN 0 ELSE
                a.amount_minor - COALESCE((SELECT SUM(al.amount_minor) FROM advance_allocations al JOIN requests e ON e.id = al.expense_request_id
                                           WHERE al.advance_request_id = r.id AND e.status IN ('approved','paid')), 0) END AS open_minor
         FROM advance_requests a JOIN requests r ON r.id = a.request_id JOIN users u ON u.id = r.requester_id
         WHERE r.status IN ('pending','approved','paid') AND substr(r.submitted_at, 1, 10) >= ? AND substr(r.submitted_at, 1, 10) < ?
         ORDER BY r.submitted_at`,
      )
      .bind(from, to)
      .all<{ id: string; display_name: string; title: string; amount_minor: number; needed_on: string; status: string; open_minor: number }>(),
    ctx.db
      .prepare(
        `SELECT u.display_name, MIN(r.paid_at) AS since,
                SUM(a.amount_minor - COALESCE((SELECT SUM(al.amount_minor) FROM advance_allocations al JOIN requests e ON e.id = al.expense_request_id
                                               WHERE al.advance_request_id = r.id AND e.status IN ('approved','paid')), 0)) AS open_minor
         FROM advance_requests a JOIN requests r ON r.id = a.request_id JOIN users u ON u.id = r.requester_id
         WHERE r.status = 'paid' AND a.travel_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM advance_closures c WHERE c.advance_request_id = r.id)
         GROUP BY u.id HAVING open_minor > 0 ORDER BY open_minor DESC`,
      )
      .all<{ display_name: string; since: string; open_minor: number }>(),
  ])
  const lines: ExpenseLine[] = items.results.map((i) => ({
    requestId: i.rid,
    date: i.expense_date,
    name: i.display_name,
    project: i.project ?? '',
    category: expenseCategoryLabel(i.category),
    description: i.description ?? '',
    currency: i.currency,
    amountOriginal: i.amount_minor / 100,
    amount: i.amount_base_minor / 100,
    docNo: i.doc_no ?? '',
    vat: i.vat_minor == null ? null : i.vat_minor / 100,
    status: STATUS_TR[i.status],
  }))
  const decided = lines.filter((l) => l.status !== STATUS_TR.pending)
  const advances = advs.results.map((a) => ({ requestId: a.id, name: a.display_name, title: a.title, amount: a.amount_minor / 100, neededOn: a.needed_on, status: STATUS_TR[a.status], open: a.status === 'paid' ? a.open_minor / 100 : 0 }))
  const openList = open.results.map((o) => ({ name: o.display_name, open: o.open_minor / 100, since: o.since.slice(0, 10) }))
  return {
    month,
    lines,
    advances,
    openAdvances: openList,
    byPerson: group(decided, (l) => l.name),
    byProject: group(decided, (l) => l.project),
    byCategory: group(decided, (l) => l.category),
    totals: {
      approved: Math.round(decided.reduce((s, l) => s + l.amount, 0) * 100) / 100,
      approvedCount: decided.length,
      pendingCount: lines.length - decided.length,
      pending: Math.round(lines.filter((l) => l.status === STATUS_TR.pending).reduce((s, l) => s + l.amount, 0) * 100) / 100,
      advancesPaid: advances.filter((a) => a.status === STATUS_TR.paid).reduce((s, a) => s + a.amount, 0),
      openAdvances: openList.reduce((s, o) => s + o.open, 0),
    },
  }
}

export interface PurchaseLine {
  requestId: string
  date: string
  name: string
  item: string
  category: string
  quantity: number
  amount: number
  status: string
}

export interface TravelLine {
  requestId: string
  name: string
  destination: string
  range: string
  start: string
  purpose: string
  project: string
  transport: string
  budget: number | null
  advance: number
  status: string
}

export interface PurchaseTravelReport {
  month: string
  purchases: PurchaseLine[]
  travels: TravelLine[]
  totals: { purchaseApproved: number; purchasePending: number; travelCount: number; travelBudget: number }
}

export async function purchaseTravelReport(ctx: Ctx, month: string): Promise<PurchaseTravelReport> {
  must(ctx.user, { a: 'report.read' })
  const { from, to } = monthRange(month)
  const [pur, trv] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT r.id, substr(r.submitted_at, 1, 10) AS day, u.display_name, p.item_name, p.category, p.license_period, p.quantity, p.estimated_minor, r.status
         FROM purchase_requests p JOIN requests r ON r.id = p.request_id JOIN users u ON u.id = r.requester_id
         WHERE r.status <> 'draft' AND r.status <> 'cancelled' AND substr(r.submitted_at, 1, 10) >= ? AND substr(r.submitted_at, 1, 10) < ?
         ORDER BY r.submitted_at`,
      )
      .bind(from, to)
      .all<{ id: string; day: string; display_name: string; item_name: string; category: keyof typeof PURCHASE_LABEL; license_period: keyof typeof PERIOD_LABEL_TR | null; quantity: number; estimated_minor: number; status: string }>(),
    ctx.db
      .prepare(
        `SELECT r.id, u.display_name, t.destination, t.start_date, t.end_date, t.purpose, r.project, t.transport, t.estimated_budget_minor, r.status,
                COALESCE((SELECT SUM(a.amount_minor) FROM advance_requests a JOIN requests ar ON ar.id = a.request_id
                          WHERE a.travel_request_id = t.request_id AND ar.status IN ('pending','approved','paid')), 0) AS adv
         FROM travel_requests t JOIN requests r ON r.id = t.request_id JOIN users u ON u.id = r.requester_id
         WHERE r.status <> 'draft' AND r.status <> 'cancelled' AND t.start_date < ? AND t.end_date >= ?
         ORDER BY t.start_date`,
      )
      .bind(to, from)
      .all<{ id: string; display_name: string; destination: string; start_date: string; end_date: string; purpose: string; project: string | null; transport: keyof typeof TRANSPORT_LABEL; estimated_budget_minor: number | null; status: string; adv: number }>(),
  ])
  const purchases = pur.results.map((p) => ({
    requestId: p.id,
    date: p.day,
    name: p.display_name,
    item: p.item_name,
    category: p.license_period ? `${PURCHASE_LABEL[p.category]} · ${PERIOD_LABEL_TR[p.license_period]}` : PURCHASE_LABEL[p.category],
    quantity: p.quantity,
    amount: p.estimated_minor / 100,
    status: STATUS_TR[p.status],
  }))
  const travels = trv.results.map((t) => ({
    requestId: t.id,
    name: t.display_name,
    destination: t.destination,
    range: formatRange(t.start_date, t.end_date),
    start: t.start_date,
    purpose: t.purpose,
    project: t.project ?? '',
    transport: TRANSPORT_LABEL[t.transport],
    budget: t.estimated_budget_minor == null ? null : t.estimated_budget_minor / 100,
    advance: t.adv / 100,
    status: STATUS_TR[t.status],
  }))
  const ok = (s: string) => s === STATUS_TR.approved || s === STATUS_TR.paid
  return {
    month,
    purchases,
    travels,
    totals: {
      purchaseApproved: purchases.filter((p) => ok(p.status)).reduce((s, p) => s + p.amount, 0),
      purchasePending: purchases.filter((p) => p.status === STATUS_TR.pending).reduce((s, p) => s + p.amount, 0),
      travelCount: travels.length,
      travelBudget: travels.filter((t) => t.status !== STATUS_TR.rejected).reduce((s, t) => s + (t.budget ?? 0), 0),
    },
  }
}

export type Cell = string | number | null
export interface Sheet {
  name: string
  header: string[]
  rows: Cell[][]
  money?: number[]
}

type ColKey = keyof Messages['exports']['cols']
const d = (iso: string) => formatDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric' })

export async function reportSheets(ctx: Ctx, kind: 'leave' | 'expense' | 'purchase', month: string): Promise<{ filename: string; sheets: Sheet[] }> {
  must(ctx.user, { a: 'report.read' })
  await audit(ctx.db, { actorId: ctx.user.id, action: `export.${kind}`, entityType: 'export', entityId: month }).run()
  const currency = currencyLabel(runtimeConfig().baseCurrency)
  const c = (k: ColKey) => t(`exports.cols.${k}`, { currency })
  if (kind === 'leave') {
    const r = await leaveReport(ctx, month)
    return {
      filename: t('exports.files.leave', { month }),
      sheets: [
        {
          name: t('exports.sheets.balance', { year: r.year }),
          header: [c('person'), c('role'), c('entitled'), c('usedBefore'), c('used'), c('pending'), c('left'), c('excuseDays'), c('sickDays'), c('unpaidDays'), c('otherDays'), c('statement')],
          rows: r.balances.map((b) => [b.name, b.role, b.entitled, b.usedBefore, b.used, b.pending, b.left, b.other.excuse, b.other.sick, b.other.unpaid, b.other.other, b.statementAt ? d(b.statementAt.slice(0, 10)) : '']),
        },
        {
          name: t('exports.sheets.leaves', { month }),
          header: [c('person'), c('kind'), c('start'), c('end'), c('workDays'), c('status')],
          rows: r.entries.map((e) => [e.name, e.kind, d(e.start), d(e.end), e.days, e.status]),
        },
      ],
    }
  }
  if (kind === 'expense') {
    const r = await expenseReport(ctx, month)
    return {
      filename: t('exports.files.expense', { month }),
      sheets: [
        {
          name: t('exports.sheets.expenses'),
          header: [c('date'), c('person'), c('project'), c('category'), c('description'), c('docNo'), c('currency'), c('vatOriginal'), c('amountOriginal'), c('amountBase'), c('status')],
          rows: r.lines.map((l) => [d(l.date), l.name, l.project, l.category, l.description, l.docNo, l.currency, l.vat, l.amountOriginal, l.amount, l.status]),
          money: [7, 8, 9],
        },
        { name: t('exports.sheets.byPerson'), header: [c('person'), c('items'), c('amountBase')], rows: r.byPerson.map((g) => [g.key, g.count, g.amount]), money: [2] },
        { name: t('exports.sheets.byProject'), header: [c('project'), c('items'), c('amountBase')], rows: r.byProject.map((g) => [g.key, g.count, g.amount]), money: [2] },
        { name: t('exports.sheets.byCategory'), header: [c('category'), c('items'), c('amountBase')], rows: r.byCategory.map((g) => [g.key, g.count, g.amount]), money: [2] },
        {
          name: t('exports.sheets.advances'),
          header: [c('person'), c('reason'), c('date'), c('amountBase'), c('status'), c('openBase')],
          rows: r.advances.map((a) => [a.name, a.title, d(a.neededOn), a.amount, a.status, a.open]),
          money: [3, 5],
        },
        { name: t('exports.sheets.openAdvances'), header: [c('person'), c('firstPaid'), c('open')], rows: r.openAdvances.map((o) => [o.name, d(o.since), o.open]), money: [2] },
      ],
    }
  }
  const r = await purchaseTravelReport(ctx, month)
  return {
    filename: t('exports.files.purchase', { month }),
    sheets: [
      {
        name: t('exports.sheets.purchases'),
        header: [c('date'), c('person'), c('item'), c('subtype'), c('quantity'), c('estimate'), c('status')],
        rows: r.purchases.map((p) => [d(p.date), p.name, p.item, p.category, p.quantity, p.amount, p.status]),
        money: [5],
      },
      {
        name: t('exports.sheets.travel'),
        header: [c('person'), c('destination'), c('date'), c('purpose'), c('project'), c('transport'), c('budget'), c('linkedAdvance'), c('status')],
        rows: r.travels.map((t) => [t.name, t.destination, t.range, t.purpose, t.project, t.transport, t.budget, t.advance, t.status]),
        money: [6, 7],
      },
    ],
  }
}

export const currentMonth = () => todayISO().slice(0, 7)
