import { formatMoney, isBaseCurrency, round2, type Currency } from '#/lib/money'
import { lazyLabels, STATUS_KEYS } from '../i18nLabels'
import { formatDate } from '#/i18n/format'
import { t } from '#/i18n'
import { hasUnlimitedLeave } from '#/lib/leave'
import type { ApprovalRequest, ApprovalsData, DecideResult } from '#/data/approvals'
import type { CancelResult, MyRequest, RequestStatus, HomeData } from '#/data/home'
import { halfHolidayDates, HOLIDAY_YEARS, holidayDates } from '#/data/holidays'
import { daysBetween } from '#/lib/agreements'
import { addDays, earliestLeaveDate, SICK_BACKDATE_DAYS, formatDay, formatLeaveDays, formatRange, countWorkdays, HALF_DAY, hoursToDays, isWorkday, partialHours, returnDate } from '#/lib/leave'
import { multiItemTitle } from '#/lib/expense'
import {
  advanceSchema, closeAdvanceSchema, expenseSchema, leaveName, leaveRequestSchema, purchaseSchema, travelSchema,
} from '#/lib/requestSchemas'
import { z } from 'zod'
import { authorize, HttpError, must, type RequestKind } from '../auth/authorize'
import type { Ctx, FormInput } from '../ctx'
import { attachmentsOfRequest, insertAttachment } from '../db/attachments'
import { rateOn, storedRates } from '../fx'
import { audit, failedAssertion, nowIso, toMinor, toBaseMinor, ulid, type Stmt, type Db } from '../db/d1'
import {
  allocationsOf, cancelStmts, closeAdvanceStmts, decideStmts, detailRows, getRequest, insertDraft, leaveBalance, leaveChecks, leaveRanges, partialLeaves,
  listAll, listMine, listQueue, markPaidStmts, openAdvances, refundReceivedStmts, refundsDue, submitDraft, type RequestRow,
} from '../db/requests'
import type { PreparedFile } from '../files'
import { enqueue, mails, newRequestRecipients, type MailFacts } from '../notify'
import { loadApprovalRules, resolveApprover } from '../approvalRules'
import { approvedRequestMail } from '../accounting'
import { consumeTokens, pendingInvoices } from './invoiceApproval'
import { gateError } from './compliance'
import { commit, fail, fileError, fileFrom, type Fail } from '../submit'
import { nowLabel, stampDay, todayISO } from '../time'
import { approverNames, requesterRoleLabel, toApproval, toListRequest, toMyRequest } from '../views'

export const STATUS_LABEL: Record<RequestStatus, string> = lazyLabels(STATUS_KEYS, (k) => `server.status.${k}` as const)

const today = (ctx: Ctx) => ctx.today ?? todayISO()
const res = (r: RequestRow) => ({ requesterId: r.requester_id, type: r.type, status: r.status, approverRole: r.approver_role })
const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 3)}…` : s)

const sinceLabel = (iso: string) => t('server.home.since', { date: formatDate(iso, { day: 'numeric', month: 'long' }) })

export async function homeData(ctx: Ctx, types: HomeData['types']): Promise<HomeData> {
  const { db, user } = ctx
  const day = today(ctx)
  const year = Number(day.slice(0, 4))
  const [rows, bal, ranges, partials, adv, people] = await Promise.all([
    listMine(db, user.id), leaveBalance(db, user.id, year), leaveRanges(db, user.id), partialLeaves(db, user.id, addDays(day, -SICK_BACKDATE_DAYS)), openAdvances(db, user.id),
    db.prepare(`SELECT id, full_name FROM users WHERE status = 'active' AND can_login = 1 AND id <> ? ORDER BY full_name`).bind(user.id).all<{ id: string; full_name: string }>(),
  ])

  const upcoming = ranges.filter((r) => r.to >= day)
  const nextPending = upcoming.find((r) => r.status === 'pending')
  const lastApproved = [...upcoming].reverse().find((r) => r.status === 'approved')
  const leaveNote =
    bal.entitled == null
      ? t('server.home.noEntitlement')
      : nextPending
        ? t('server.home.sentForApproval', { range: formatRange(nextPending.from, nextPending.to) })
        : lastApproved
          ? t('server.home.approved', { range: formatRange(lastApproved.from, lastApproved.to) })
          : t('server.home.yearAllowance', { year, days: bal.entitled })

  const openMinor = adv.reduce((s, a) => s + a.open_minor, 0)
  const settling = adv.some((a) => a.settling_minor > 0)
  const pendingExpenses = rows.filter((r) => r.type === 'expense' && r.status === 'pending').length

  return {
    todayISO: day,
    nowLabel: nowLabel(),
    types,
    statusLabel: STATUS_LABEL,
    leave: {
      year,
      unlimited: hasUnlimitedLeave(user.role),
      total: bal.entitled,
      left: (bal.entitled ?? 0) - bal.usedBefore - bal.used,
      pendingDays: bal.pending,
      note: leaveNote,
      approvedRanges: ranges.map(({ from, to, status }) => ({ from, to, pending: status === 'pending' })),
      partialDays: partials.map((x) => ({ date: x.date, from: x.from, to: x.to, pending: x.status === 'pending' })),
      approvedLabel: [...upcoming.map((r) => (r.status === 'pending' ? t('server.home.waiting', { range: formatRange(r.from, r.to) }) : formatRange(r.from, r.to))), ...partials.filter((x) => x.date >= day).map((x) => `${formatDay(x.date)} ${x.from}–${x.to}${x.status === 'pending' ? t('server.home.waitingSuffix') : ''}`)].join(', '),
    },
    advance: {
      openAmount: openMinor / 100,
      since: adv[0] ? sinceLabel(stampDay(adv[0].paid_at)) : '',
      reason: adv.length === 1 ? adv[0].title : adv.length > 1 ? t('server.home.advances', { count: adv.length }) : '',
      note: settling && pendingExpenses > 0 ? t('server.home.pendingExpenses', { count: pendingExpenses }) : t('server.home.advanceHint'),
      pendingExpenses,
      items: adv.map((a) => ({ id: a.id, title: a.title, open: a.open_minor / 100 })),
    },
    colleagues: people.results.map((p) => ({ id: p.id, name: p.full_name })),
    requests: rows.map(toListRequest),
  }
}

export async function myRequests(ctx: Ctx) {
  return { requests: (await listMine(ctx.db, ctx.user.id)).map(toListRequest), statusLabel: STATUS_LABEL }
}

export async function allRequests(ctx: Ctx) {
  must(ctx.user, { a: 'requests.all' })
  const rows = await listAll(ctx.db)
  return {
    requests: rows.filter((r) => authorize(ctx.user, { a: 'request.read', r: res(r) }).ok).map((r) => ({ ...toListRequest(r), requesterName: r.requester_name })),
    statusLabel: STATUS_LABEL,
  }
}

export async function anyRequest(ctx: Ctx, id: string): Promise<MyRequest | null> {
  const r = await getRequest(ctx.db, id)
  if (!r || r.status === 'draft' || !authorize(ctx.user, { a: 'request.read', r: res(r) }).ok) return null
  const [d, atts, ap] = await Promise.all([detailRows(ctx.db, r), attachmentsOfRequest(ctx.db, r.id), approverNames(ctx.db)])
  const v = toMyRequest(r, d, atts, ap)
  v.detail.fields.unshift({ label: t('server.requests.fullName'), value: r.requester_full_name }, { label: t('server.requests.roleDepartment'), value: requesterRoleLabel(r) })
  return { ...v, requesterName: r.requester_name }
}

export async function myRequest(ctx: Ctx, id: string): Promise<MyRequest | null> {
  const r = await getRequest(ctx.db, id)
  if (!r || r.requester_id !== ctx.user.id || r.status === 'draft' || !authorize(ctx.user, { a: 'request.read', r: res(r) }).ok) return null
  const [d, atts, ap] = await Promise.all([detailRows(ctx.db, r), attachmentsOfRequest(ctx.db, r.id), approverNames(ctx.db)])
  const v = toMyRequest(r, d, atts, ap)
  if (r.status === 'approved' && r.type === 'leave' && d.leave && d.leave.start_date > today(ctx)) v.cancellable = true
  if (r.type === 'leave' && d.leave?.kind === 'sick' && (r.status === 'pending' || r.status === 'approved') && !atts.some((a) => a.sensitive)) v.canAddReport = true
  return v
}

async function approvalView(ctx: Ctx, r: RequestRow): Promise<ApprovalRequest> {
  const { db } = ctx
  const [d, atts, adv, alloc] = await Promise.all([
    detailRows(db, r),
    attachmentsOfRequest(db, r.id),
    r.type === 'expense' ? openAdvances(db, r.requester_id) : Promise.resolve([]),
    r.type === 'expense' ? allocationsOf(db, r.id) : Promise.resolve(0),
  ])
  return toApproval(r, d, atts, adv.reduce((s, a) => s + a.open_minor, 0), alloc)
}

export async function approvals(ctx: Ctx): Promise<ApprovalsData> {
  must(ctx.user, { a: 'approvals.list' })
  const day = today(ctx)
  const since = new Date(`${day}T00:00:00+03:00`).toISOString()
  const [pending, decided] = await Promise.all([listQueue(ctx.db, ctx.user, 'pending'), listQueue(ctx.db, ctx.user, 'decided', since)])
  const visible = (r: RequestRow) => authorize(ctx.user, { a: 'request.read', r: res(r) }).ok
  const refunds = ctx.user.role === 'approver' ? await refundsDue(ctx.db) : []
  return {
    todayISO: day,
    pending: await Promise.all(pending.filter(visible).map((r) => approvalView(ctx, r))),
    decided: await Promise.all(decided.filter(visible).map((r) => approvalView(ctx, r))),
    invoices: await pendingInvoices(ctx),
    refunds: refunds.map((x) => ({ id: x.id, title: x.title, who: x.who, hue: x.hue ?? 220, amount: formatMoney(x.refund_minor / 100), closedAt: formatDay(stampDay(x.closed_at)) })),
  }
}

async function load(ctx: Ctx, id: string): Promise<RequestRow> {
  const r = await getRequest(ctx.db, id)
  if (!r) throw new HttpError(404, t('server.recordNotFound'))
  return r
}

async function run(ctx: Ctx, stmts: Stmt[], conflict: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ctx.db.batch(stmts)
    return { ok: true }
  } catch (e) {
    if (failedAssertion(e, ['conflict'])) return { ok: false, error: conflict }
    throw e
  }
}

export async function cancel(ctx: Ctx, id: string): Promise<CancelResult> {
  const r = await getRequest(ctx.db, id)
  const d = r ? authorize(ctx.user, { a: 'request.cancel', r: res(r) }) : null
  if (!r || !d || (!d.ok && d.reason === 'not_found')) return { ok: false, error: t('server.requests.notFound') }
  if (r.status === 'approved' && r.type === 'leave' && r.requester_id === ctx.user.id) {
    const l = await ctx.db.prepare(`SELECT start_date FROM leave_requests WHERE request_id = ?`).bind(r.id).first<{ start_date: string }>()
    if (!l || l.start_date <= today(ctx)) return { ok: false, error: t('server.requests.startedLeave') }
    const facts = await factsOf(ctx.db, r)
    const { watchers } = await newRequestRecipients(ctx.db, r.requester_id, r.approver_role ?? 'approver')
    const to = [...new Set([r.decided_by, ...watchers].filter((x): x is string => !!x && x !== r.requester_id))]
    return run(ctx, [...cancelStmts(ctx.db, ctx.user, r, null), ...enqueue(ctx.db, to.map((id) => mails.leaveCancelled(id, r.id, r.requester_name, facts)))], t('server.requests.changed'))
  }
  if (!d.ok) return { ok: false, error: t('server.requests.cancelOnlyPending') }
  return run(ctx, cancelStmts(ctx.db, ctx.user, r, null), t('server.requests.changed'))
}

const tl = (minor: number | null | undefined): number | null => (minor == null ? null : minor)

const leaveRangeLabel = (start: string, end: string, st?: string | null, et?: string | null) => (st && et ? `${formatDay(start)} ${st}–${et}` : formatRange(start, end))

async function factsOf(db: Db, r: RequestRow): Promise<MailFacts> {
  if (r.type !== 'leave') return { amountMinor: tl(r.total_base_minor) }
  const l = await db.prepare(`SELECT kind, start_date, end_date, start_time, end_time, work_days FROM leave_requests WHERE request_id = ?`).bind(r.id).first<{ kind: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; work_days: number }>()
  return l ? { leave: { start: l.start_date, end: l.end_date, startTime: l.start_time, endTime: l.end_time, days: l.work_days, kind: l.kind } } : {}
}

export type ClientInfo = { ip?: string; ua?: string }

export async function decide(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note?: string, opts: { via?: 'email'; client?: ClientInfo } = {}): Promise<DecideResult> {
  const r = await load(ctx, id)
  must(ctx.user, { a: 'request.decide', r: res(r) })
  const reason = note?.trim()
  if (decision === 'rejected' && !reason) return { ok: false, error: t('server.requests.rejectReason') }
  const facts = await factsOf(ctx.db, r)
  const conflict = t('server.requests.decidedByOther')
  const meta = opts.via ? { via: opts.via, ...(opts.client ?? {}) } : undefined
  const mail = enqueue(ctx.db, [mails.decided(r.requester_id, r.id, r.type, stampDay(r.submitted_at ?? r.created_at), decision, facts)])
  const approverName = decision === 'approved' ? (await ctx.db.prepare(`SELECT full_name FROM users WHERE id = ?`).bind(ctx.user.id).first<{ full_name: string }>())?.full_name : null
  const acct = approverName ? await approvedRequestMail(ctx.db, r.id, approverName, today(ctx)) : null
  return run(ctx, [...decideStmts(ctx.db, ctx.user, r, decision, decision === 'rejected' ? (reason ?? null) : null, meta), consumeTokens(ctx.db, 'request', r.id, nowIso()), ...mail, ...(acct ? [acct] : [])], conflict)
}

export async function markPaid(ctx: Ctx, id: string): Promise<DecideResult> {
  const r = await load(ctx, id)
  must(ctx.user, { a: 'request.markPaid', r: res(r) })
  const mail = r.requester_id === ctx.user.id ? [] : enqueue(ctx.db, [mails.paid(r.requester_id, r.id, r.type, stampDay(r.submitted_at ?? r.created_at), await factsOf(ctx.db, r))])
  return run(ctx, [...markPaidStmts(ctx.db, ctx.user, r), ...mail], t('server.requests.changedShort'))
}

export async function addLeaveReport(ctx: Ctx, input: FormInput): Promise<{ ok: true } | Fail> {
  const idIn = z.object({ id: z.string().length(26) }).safeParse(input.json)
  if (!idIn.success) return fail(t('server.invalidRequest'))
  const r = await load(ctx, idIn.data.id)
  must(ctx.user, { a: 'request.addReport', r: res(r) })
  const l = await ctx.db.prepare(`SELECT kind FROM leave_requests WHERE request_id = ?`).bind(r.id).first<{ kind: string }>()
  if (l?.kind !== 'sick') return fail(t('server.requests.reportOnlySick'))
  if ((await attachmentsOfRequest(ctx.db, r.id)).some((a) => a.sensitive)) return fail(t('server.requests.reportExists'))
  let report: PreparedFile | null
  try {
    report = await fileFrom((input.json as { file?: unknown }).file, input.files, 'file', { required: true })
  } catch (e) {
    return fileError(e)
  }
  const err = await commit(
    ctx,
    [
      insertAttachment(ctx.db, report!, 'health_report', { requestId: r.id }, ctx.user.id),
      audit(ctx.db, { actorId: ctx.user.id, action: 'attachment.add', entityType: 'request', entityId: r.id, meta: { kind: 'health_report', late: true, status: r.status } }),
    ],
    [report!],
    { unique: fail(t('server.requests.reportExists')) },
  )
  return err ?? { ok: true }
}

export type SubmitResult = { ok: true; requests: MyRequest[] } | Fail

function parsed<T extends z.ZodType>(schema: T, input: unknown): { ok: true; data: z.output<T> } | { ok: false; res: Fail } {
  const r = schema.safeParse(input)
  if (r.success) return { ok: true, data: r.data }
  const fe: Record<string, string> = {}
  for (const i of r.error.issues) fe[i.path.join('.')] ??= i.message
  return { ok: false, res: { ok: false, error: Object.values(fe)[0] ?? t('server.requests.invalid'), fieldErrors: fe } }
}

async function finish(ctx: Ctx, list: { id: string; kind: RequestKind; facts?: MailFacts }[], stmts: Stmt[], files: PreparedFile[], errors?: Record<string, Fail>): Promise<SubmitResult> {
  const now = nowIso()
  const ids = list.map((x) => x.id)
  const mailsOut: Stmt[] = []
  const who = (await ctx.db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(ctx.user.id).first<{ display_name: string }>())?.display_name ?? t('server.someone')
  const rules = await loadApprovalRules(ctx.db)
  const stages = new Map<string, Awaited<ReturnType<typeof resolveApprover>>>()
  for (const x of list) {
    const stage = await resolveApprover(ctx.db, rules, x.kind, ctx.user)
    stages.set(x.id, stage)
    const { approvers, watchers } = await newRequestRecipients(ctx.db, ctx.user.id, stage)
    mailsOut.push(...enqueue(ctx.db, [...approvers.map((to) => mails.submitted(to, x.id, x.kind, who, x.facts)), ...watchers.map((to) => mails.submittedFyi(to, x.id, x.kind, who, stage, x.facts))]))
  }
  const err = await commit(ctx, [...stmts, ...ids.flatMap((id) => submitDraft(ctx.db, ctx.user, id, now, stages.get(id)!)), ...mailsOut], files, errors)
  if (err) return err
  for (const x of list) {
    if (stages.get(x.id) !== 'auto' || !['leave', 'expense', 'advance'].includes(x.kind)) continue
    try {
      const acct = await approvedRequestMail(ctx.db, x.id, null, today(ctx))
      if (acct) await ctx.db.batch([acct])
    } catch (e) {
      console.error(JSON.stringify({ at: 'accounting-enqueue', user: ctx.user.id, error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }))
    }
  }
  const rows = await Promise.all(ids.map((id) => getRequest(ctx.db, id)))
  return { ok: true, requests: rows.map((r) => ({ ...toListRequest(r!), justNow: true })) }
}

async function validSubstitute(db: Db, requesterId: string, id: string | undefined) {
  if (!id) return true
  return !!(await db.prepare(`SELECT 1 AS x FROM users WHERE id = ? AND id <> ? AND status = 'active' AND can_login = 1`).bind(id, requesterId).first<{ x: number }>())
}

export async function submitLeave(ctx: Ctx, input: FormInput): Promise<{ ok: true; request: MyRequest; days: number } | Fail> {
  const { db, user } = ctx
  must(user, { a: 'request.create' })
  const gate = await gateError(ctx)
  if (gate) return gate
  const p = parsed(leaveRequestSchema, input.json)
  if (!p.ok) return p.res
  const { kind, reason, span, start, end, half, note, substituteId } = p.data
  if (start < earliestLeaveDate(kind, today(ctx))) return fail(kind === 'sick' ? t('server.requests.sickBackdate', { days: SICK_BACKDATE_DAYS }) : t('server.requests.pastDate'))
  if (daysBetween(start, end) > 366) return fail(t('server.requests.maxYear'))
  for (const y of new Set([start, end].map((d) => Number(d.slice(0, 4))))) {
    if (!HOLIDAY_YEARS.has(y)) return fail(t('server.requests.noHolidays', { year: y }))
  }
  const cal = { holidays: holidayDates, halfDays: halfHolidayDates, approved: [] }
  const [startTime, endTime] = span === 'half_day' && half ? HALF_DAY[half] : span === 'hours' ? [p.data.startTime!, p.data.endTime!] : [null, null]
  let days: number
  if (startTime && endTime) {
    if (!isWorkday(start, cal)) return fail(t('server.requests.notWorkday'))
    const h = partialHours(start, startTime, endTime, cal)
    if (h <= 0) return fail(t('server.requests.afternoonOff'))
    days = hoursToDays(h)
  } else {
    days = countWorkdays(start, end, cal)
    if (days < 1) return fail(t('server.requests.noWorkdays'))
  }
  if (!(await validSubstitute(db, user.id, substituteId))) return fail(t('server.requests.pickSubstitute'), 'substituteId')
  const back = returnDate(end, cal, endTime)

  let report: PreparedFile | null
  try {
    report = kind === 'sick' ? await fileFrom((input.json as { file?: unknown }).file, input.files, 'file') : null
  } catch (e) {
    return fileError(e)
  }

  const id = ulid()
  const dbKind = kind
  const year = Number(start.slice(0, 4))
  const range = leaveRangeLabel(start, end, startTime, endTime)
  const bal = await leaveBalance(db, user.id, year)
  const nowLeft = bal.entitled == null ? null : bal.entitled - bal.usedBefore - bal.used - bal.pending
  const deducts = dbKind === 'annual'
  const facts: MailFacts = {
    leave: {
      start, end, startTime, endTime, days, kind: dbKind,
      balance: nowLeft == null ? undefined : { now: nowLeft, after: deducts ? nowLeft - days : nowLeft, deducts },
    },
  }
  const r = await finish(
    ctx,
    [{ id, kind: 'leave', facts }],
    [
      insertDraft(db, user, { id, type: 'leave', title: `${leaveName(kind, kind === 'excuse' ? reason : undefined)}, ${range} (${formatLeaveDays(days)})`, note: note || null }, nowIso()),
      db
        .prepare(`INSERT INTO leave_requests (request_id, kind, start_date, end_date, start_time, end_time, work_days, return_date, substitute_id, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, dbKind, start, end, startTime, endTime, days, back, substituteId ?? null, year),
      ...(report ? [insertAttachment(db, report, 'health_report', { requestId: id }, user.id)] : []),
      ...leaveChecks(db, user.id, id, { kind: dbKind, start, end, days, year, startTime, endTime, unlimited: hasUnlimitedLeave(user.role) }),
    ],
    report ? [report] : [],
    {
      leave_overlap: fail(t('server.requests.overlap')),
      leave_no_entitlement: fail(t('server.requests.noYearEntitlement', { year })),
      leave_balance: fail(t('server.requests.balance', { days: formatLeaveDays(days) })),
    },
  )
  return r.ok ? { ok: true, request: r.requests[0], days } : r
}

async function resolveRate(ctx: Ctx, day: string, currency: Currency): Promise<number | null> {
  const r = await rateOn(day, currency, ctx.fetcher ?? fetch)
  if (r) return r.rate
  const stored = await storedRates(ctx.db)
  return stored[currency] ?? null
}

function advanceRow(ctx: Ctx, id: string, amountBase: number, neededOn: string, travelId: string | null, payment: 'bank' | 'cash' | null = null, iban: string | null = null) {
  return ctx.db.prepare(`INSERT INTO advance_requests (request_id, amount_minor, needed_on, travel_request_id, payment_method, iban) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, amountBase, neededOn, travelId, payment, iban)
}

async function allocations(ctx: Ctx, expenseId: string, totalMinor: number): Promise<Stmt[]> {
  const { db, user } = ctx
  let left = totalMinor
  const out: Stmt[] = []
  for (const a of await openAdvances(db, user.id)) {
    const free = a.open_minor - a.settling_minor
    if (left <= 0 || free <= 0) continue
    const take = Math.min(free, left)
    left -= take
    out.push(
      db
        .prepare(
          `INSERT INTO advance_allocations (id, advance_request_id, expense_request_id, amount_minor, created_by)
           SELECT ?, ?, ?, ?, ? WHERE ? <= (
             SELECT a.amount_minor - COALESCE((SELECT SUM(al.amount_minor) FROM advance_allocations al JOIN requests e ON e.id = al.expense_request_id
                                               WHERE al.advance_request_id = a.request_id AND e.status IN ('pending','approved','paid')), 0)
             FROM advance_requests a JOIN requests r ON r.id = a.request_id
             WHERE a.request_id = ? AND r.status = 'paid' AND r.requester_id = ? AND a.travel_request_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM advance_closures c WHERE c.advance_request_id = a.request_id))`,
        )
        .bind(ulid(), a.id, expenseId, take, user.id, take, a.id, user.id),
    )
  }
  return out
}

export async function submitExpense(ctx: Ctx, input: FormInput): Promise<SubmitResult> {
  const { db, user } = ctx
  must(user, { a: 'request.create' })
  const gate = await gateError(ctx)
  if (gate) return gate
  const p = parsed(expenseSchema, input.json)
  if (!p.ok) return p.res
  const { items, project, note } = p.data
  const day = today(ctx)
  const future: Record<string, string> = {}
  items.forEach((it, i) => {
    if (it.date > day) future[`items.${i}.date`] = t('server.requests.futureExpense')
  })
  if (Object.keys(future).length) return { ok: false, error: t('server.requests.futureExpense'), fieldErrors: future }

  const raw = ((input.json as { items?: { file?: unknown }[] }).items ?? []) as { file?: unknown }[]
  const files: PreparedFile[] = []
  try {
    for (let i = 0; i < items.length; i++) files.push((await fileFrom(raw[i]?.file, input.files, `items.${i}.fileName`, { required: true }))!)
  } catch (e) {
    return fileError(e)
  }

  const rates: number[] = []
  const missingRate: Record<string, string> = {}
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (isBaseCurrency(it.currency)) rates.push(1)
    else if (it.rate) rates.push(it.rate)
    else {
      const r = await resolveRate(ctx, it.date, it.currency)
      if (r == null) missingRate[`items.${i}.rate`] = t('expense.errors.rateHint')
      rates.push(r ?? 0)
    }
  }
  if (Object.keys(missingRate).length) return { ok: false, error: t('expense.errors.rateHint'), fieldErrors: missingRate }

  const id = ulid()
  const lines = items.map((it, i) => {
    const minor = toMinor(it.amount)
    const fx = isBaseCurrency(it.currency) ? 1_000_000 : Math.round(rates[i] * 1_000_000)
    return { ...it, minor, fx, tryK: isBaseCurrency(it.currency) ? minor : toBaseMinor(minor, fx), vat: it.vat == null ? null : toMinor(round2(it.vat)) }
  })
  const total = lines.reduce((s, l) => s + l.tryK, 0)
  const title = items.length === 1 ? short(items[0].description) : multiItemTitle(items[0].description, items.length)
  const stmts: Stmt[] = [
    insertDraft(db, user, { id, type: 'expense', title, note: note || null, project: project || null, totalMinor: total }, nowIso()),
  ]
  lines.forEach((l, i) => {
    const itemId = ulid()
    stmts.push(
      db
        .prepare(
          `INSERT INTO request_items (id, request_id, line_no, expense_date, category, description, currency, amount_minor, fx_rate_micro, amount_base_minor, doc_no, vat_minor, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(itemId, id, i + 1, l.date, l.category, l.description, l.currency, l.minor, l.fx, l.tryK, l.docNo || null, l.vat, user.id, user.id),
      insertAttachment(db, files[i], 'receipt', { requestItemId: itemId }, user.id),
    )
  })
  stmts.push(...(await allocations(ctx, id, total)))
  return finish(ctx, [{ id, kind: 'expense', facts: { amountMinor: tl(total) } }], stmts, files)
}

export async function submitAdvance(ctx: Ctx, input: FormInput): Promise<SubmitResult> {
  must(ctx.user, { a: 'request.create' })
  const gate = await gateError(ctx)
  if (gate) return gate
  const p = parsed(advanceSchema, input.json)
  if (!p.ok) return p.res
  const { amount, reason } = p.data
  const date = today(ctx)
  const id = ulid()
  const k = toMinor(round2(amount))
  return finish(
    ctx,
    [{ id, kind: 'advance', facts: { amountMinor: tl(k) } }],
    [
      insertDraft(ctx.db, ctx.user, { id, type: 'advance', title: short(reason), note: reason, project: null, totalMinor: k }, nowIso()),
      advanceRow(ctx, id, k, date, null, 'bank'),
    ],
    [],
  )
}

export async function closeAdvance(ctx: Ctx, id: string, input: unknown): Promise<DecideResult> {
  const r = await load(ctx, id)
  must(ctx.user, { a: 'advance.close', r: res(r) })
  const p = parsed(closeAdvanceSchema, input)
  if (!p.ok) return { ok: false, error: p.res.error }
  try {
    await ctx.db.batch(closeAdvanceStmts(ctx.db, ctx.user, r.id, p.data.note || null))
    return { ok: true }
  } catch (e) {
    if (failedAssertion(e, ['advance_close'])) return { ok: false, error: t('server.requests.advanceClose') }
    throw e
  }
}

export async function refundReceived(ctx: Ctx, id: string): Promise<DecideResult> {
  const r = await load(ctx, id)
  must(ctx.user, { a: 'advance.refundReceived', r: res(r) })
  return run(ctx, refundReceivedStmts(ctx.db, ctx.user, r.id), t('server.requests.refundMarked'))
}

export async function submitPurchase(ctx: Ctx, input: FormInput): Promise<SubmitResult> {
  must(ctx.user, { a: 'request.create' })
  const gate = await gateError(ctx)
  if (gate) return gate
  const p = parsed(purchaseSchema, input.json)
  if (!p.ok) return p.res
  const v = p.data
  const id = ulid()
  const unit = v.unitPrice ? toMinor(round2(v.unitPrice)) : 0
  const category = v.kind
  return finish(
    ctx,
    [{ id, kind: 'purchase', facts: { amountMinor: unit ? tl(unit * v.quantity) : null } }],
    [
      insertDraft(ctx.db, ctx.user, { id, type: 'purchase', title: short(v.quantity > 1 ? `${v.name} × ${v.quantity}` : v.name), note: v.reason, totalMinor: unit ? unit * v.quantity : null }, nowIso()),
      ctx.db
        .prepare(`INSERT INTO purchase_requests (request_id, category, item_name, quantity, unit_estimated_minor, estimated_minor, license_period, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, category, v.name, v.quantity, unit, unit * v.quantity, category === 'software' && v.period ? v.period : null, v.url || null),
    ],
    [],
  )
}

export async function submitTravel(ctx: Ctx, input: FormInput): Promise<SubmitResult> {
  const { db, user } = ctx
  must(user, { a: 'request.create' })
  const gate = await gateError(ctx)
  if (gate) return gate
  const p = parsed(travelSchema, input.json)
  if (!p.ok) return p.res
  const v = p.data
  if (v.start < today(ctx)) return fail(t('server.requests.pastDate'), 'start')
  const now = nowIso()
  const travelId = ulid()
  const budget = v.budget ? toMinor(round2(v.budget)) : null
  const stmts: Stmt[] = [
    insertDraft(db, user, { id: travelId, type: 'travel', title: `${short(v.place, 60)} — ${formatRange(v.start, v.end)}`, project: v.project || null, totalMinor: budget }, now),
    db
      .prepare(`INSERT INTO travel_requests (request_id, destination, start_date, end_date, purpose, transport, accommodation, estimated_budget_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(travelId, v.place, v.start, v.end, v.purpose, 'other', 'none', budget),
  ]
  const ids = [travelId]
  if (v.wantAdvance && v.advanceAmount) {
    const advId = ulid()
    const k = toMinor(round2(v.advanceAmount))
    stmts.push(insertDraft(db, user, { id: advId, type: 'advance', title: short(t('server.requests.travelAdvance', { place: v.place })), note: t('server.requests.travelAdvance', { place: v.place }), project: v.project || null, totalMinor: k }, now), advanceRow(ctx, advId, k, v.start, travelId, 'bank'))
    ids.push(advId)
  }
  const amounts = [tl(budget), ...(ids.length > 1 ? [tl(toMinor(round2(v.advanceAmount ?? 0)))] : [])]
  return finish(ctx, ids.map((id, i) => ({ id, kind: i === 0 ? ('travel' as const) : ('advance' as const), facts: { amountMinor: amounts[i] } })), stmts, [])
}
