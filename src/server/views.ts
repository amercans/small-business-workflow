import type { ApprovalAttachment, ApprovalRequest } from '#/data/approvals'
import type { MyRequest, RequestDetail, RequestStatus, RequestType } from '#/data/home'
import { formatDay, formatLeaveDays, formatRange } from '#/lib/leave'
import { CURRENCY_SYMBOL, formatAmount, formatMoney, type Currency, isBaseCurrency } from '#/lib/money'
import { roleLabel, type Role } from '#/lib/permissions'
import { expenseCategoryLabel, formatIban } from '#/lib/requestSchemas'
import { multiItemTitle } from '#/lib/expense'
import { nights } from '#/lib/trip'
import type { AttachmentInfo } from './db/attachments'
import { fromMinor, type Db } from './db/d1'
import type { RequestDetailRows, RequestRow } from './db/requests'
import { stampDay, stampLabel } from './time'
import { t, tn, type MessageKey } from '#/i18n'

function lazyLabels<K extends string>(keys: Record<K, MessageKey>): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>
  for (const k of Object.keys(keys) as K[]) Object.defineProperty(out, k, { enumerable: true, get: () => t(keys[k]) })
  return out
}

export const TYPE_UI: Record<RequestRow['type'], RequestType> = { leave: 'leave', expense: 'expense', advance: 'advance', purchase: 'purchase', travel: 'travel' }
export const TYPE_LABEL = lazyLabels<RequestType>({ leave: 'views.type.leave', expense: 'views.type.expense', advance: 'views.type.advance', purchase: 'views.type.purchase', travel: 'views.type.travel' })
export const LEAVE_KIND_LABEL = lazyLabels({ annual: 'views.leaveKind.annual', excuse: 'views.leaveKind.excuse', sick: 'views.leaveKind.sick', unpaid: 'views.leaveKind.unpaid', other: 'views.leaveKind.other' })
export const LEAVE_KIND_NAME = lazyLabels({ annual: 'views.leaveName.annual', excuse: 'views.leaveName.excuse', sick: 'views.leaveName.sick', unpaid: 'views.leaveName.unpaid', other: 'views.leaveName.other' })
const PAYMENT_LABEL = lazyLabels({ bank: 'views.payment.bank', cash: 'views.payment.cash' })
export const PURCHASE_LABEL = lazyLabels({ equipment: 'views.purchase.equipment', software: 'views.purchase.software', other: 'views.purchase.other' })
export const PERIOD_LABEL_TR = lazyLabels({ monthly: 'views.period.monthly', yearly: 'views.period.yearly', one_time: 'views.period.oneTime' })
export const TRANSPORT_LABEL = lazyLabels({ plane: 'views.transport.plane', bus: 'views.transport.bus', car: 'views.transport.car', train: 'views.transport.train', other: 'views.transport.other' })

const money = (k: number | null | undefined) => (k == null ? '' : formatMoney(fromMinor(k)))

export type Approvers = Record<'manager' | 'approver' | 'owner', string | null>

export async function approverNames(db: Db): Promise<Approvers> {
  const rows = (await db.prepare(`SELECT display_name, role FROM users WHERE status = 'active' AND can_login = 1 AND role IN ('manager','approver','owner') ORDER BY created_at`).all<{ display_name: string; role: string }>()).results
  const name = (role: string) => rows.find((r) => r.role === role)?.display_name ?? null
  return { manager: name('manager'), approver: name('approver'), owner: name('owner') }
}

export const requesterRoleLabel = (r: Pick<RequestRow, 'requester_role' | 'requester_department'>) => {
  const role = roleLabel(r.requester_role as Role) ?? ''
  return r.requester_department ? `${role} · ${r.requester_department}` : role
}

export const typeLabelOf = (r: Pick<RequestRow, 'travel_advance'>, type: RequestType): string => (type === 'advance' && r.travel_advance ? t('views.travelAdvance') : TYPE_LABEL[type])

export function requestTitle(r: Pick<RequestRow, 'type' | 'title' | 'item_count' | 'first_item'>): string {
  if (r.type !== 'expense' || r.item_count < 2 || !r.first_item) return r.title
  return multiItemTitle(r.first_item, r.item_count)
}

const isImage = (ct: string) => ct.startsWith('image/')

function itemSub(it: NonNullable<RequestDetailRows['items']>[number]): string {
  const parts = [formatDay(it.expense_date), expenseCategoryLabel(it.category)]
  if (it.doc_no) parts.push(t('views.item.doc', { no: it.doc_no }))
  if (it.vat_minor != null) parts.push(`${t('views.item.vat')} ${isBaseCurrency(it.currency) ? formatMoney(fromMinor(it.vat_minor)) : `${formatAmount(it.vat_minor / 100)} ${CURRENCY_SYMBOL[it.currency as Currency] ?? it.currency}`}`)
  return parts.join(' · ')
}

const leaveWhen = (l: NonNullable<RequestDetailRows['leave']>) => (l.start_time ? `${formatDay(l.start_date)}, ${l.start_time}–${l.end_time}` : formatRange(l.start_date, l.end_date))

function itemAmount(it: NonNullable<RequestDetailRows['items']>[number]): string {
  const tl = formatMoney(fromMinor(it.amount_base_minor))
  if (isBaseCurrency(it.currency)) return tl
  const sym = CURRENCY_SYMBOL[it.currency as Currency] ?? it.currency
  return `${tl} (${formatAmount(it.amount_minor / 100)} ${sym} × ${formatAmount(it.fx_rate_micro / 1_000_000)})`
}

function describe(r: RequestRow, d: RequestDetailRows) {
  const fields: { label: string; value: string }[] = []
  let items: RequestDetail['items']
  let leaveDays: number | undefined
  let hero = r.total_base_minor != null ? money(r.total_base_minor) : TYPE_LABEL[TYPE_UI[r.type]]
  if (d.leave) {
    const l = d.leave
    fields.push({ label: t('views.field.type'), value: LEAVE_KIND_NAME[l.kind] }, { label: t('views.field.dates'), value: leaveWhen(l) }, { label: t('views.field.duration'), value: formatLeaveDays(l.work_days) })
    if (l.return_date) fields.push({ label: t('views.field.returnDate'), value: formatDay(l.return_date) })
    if (l.substitute_name) fields.push({ label: t('views.field.substitute'), value: l.substitute_name })
    if (l.kind === 'annual' && r.status === 'pending') leaveDays = l.work_days
    hero = formatLeaveDays(l.work_days)
  }
  let totals: RequestDetail['totals']
  if (d.items) {
    items = d.items.map((it) => ({ label: it.description ?? expenseCategoryLabel(it.category), sub: itemSub(it), amount: itemAmount(it) }))
    if (d.iban) fields.push({ label: t('views.field.iban'), value: formatIban(d.iban) })
    const sub = r.total_base_minor ?? 0
    const off = d.allocatedMinor ?? 0
    totals = { subtotal: money(sub), offset: money(off), net: money(sub - off), hasOffset: off > 0 }
  }
  let closure: RequestDetail['closure']
  if (d.advance) {
    const a = d.advance
    if (r.note) fields.push({ label: t('views.field.purpose'), value: r.note })
    if (a.payment_method) fields.push({ label: t('views.field.paymentMethod'), value: a.payment_method === 'bank' && !a.iban ? t('views.payment.salary') : PAYMENT_LABEL[a.payment_method] })
    if (a.iban) fields.push({ label: t('views.field.iban'), value: formatIban(a.iban) })
    if (a.travel_title) fields.push({ label: t('views.field.linkedTravel'), value: a.travel_title })
    if (r.status === 'paid' && a.travel_request_id) {
      const c = d.closure
      const settled = c ? c.spent_minor : (d.advanceSpent?.settled_minor ?? 0)
      const settling = c ? 0 : (d.advanceSpent?.settling_minor ?? 0)
      closure = {
        paid: money(a.amount_minor),
        spent: money(settled),
        refund: money(c ? c.refund_minor : a.amount_minor - settled),
        hasRefund: (c ? c.refund_minor : a.amount_minor - settled) > 0,
        settling: settling > 0 ? money(settling) : undefined,
        closedAt: c ? stampLabel(c.closed_at) : undefined,
        note: c?.note ?? undefined,
        refundReceivedAt: c?.refund_received_at ? `${stampLabel(c.refund_received_at)}${c.receiver_name ? ` · ${c.receiver_name}` : ''}` : undefined,
        canClose: !c && settling === 0,
      }
    }
  }
  if (d.purchase) {
    const p = d.purchase
    fields.push(
      { label: t('views.field.product'), value: p.item_name },
      { label: t('views.field.subtype'), value: p.license_period ? `${PURCHASE_LABEL[p.category]} · ${PERIOD_LABEL_TR[p.license_period]}` : PURCHASE_LABEL[p.category] },
      { label: t('views.field.quantity'), value: String(p.quantity) },
      { label: t('views.field.unitPrice'), value: p.unit_estimated_minor ? money(p.unit_estimated_minor) : t('views.notSpecified') },
    )
    if (r.note) fields.push({ label: t('views.field.reason'), value: r.note })
    if (p.url) fields.push({ label: t('views.field.link'), value: p.url })
  }
  if (d.travel) {
    const tr = d.travel
    fields.push({ label: t('views.field.destination'), value: tr.destination }, { label: t('views.field.dates'), value: formatRange(tr.start_date, tr.end_date) }, { label: t('views.field.purpose'), value: tr.purpose })
    if (tr.transport !== 'other') fields.push({ label: t('views.field.transport'), value: TRANSPORT_LABEL[tr.transport] })
    if (tr.accommodation === 'hotel') fields.push({ label: t('views.field.accommodation'), value: tn('views.hotelNights', nights(tr.start_date, tr.end_date)) })
    for (const a of d.linkedAdvances ?? []) fields.push({ label: t('views.field.linkedAdvance'), value: money(a.amount_minor) })
  }
  return { fields, items, leaveDays, hero, totals, closure }
}

function approverOf(r: RequestRow, ap: Approvers): { approver: string; waitingOn?: string } {
  if (r.auto_approved) return { approver: t('views.auto.role', { role: roleLabel(r.requester_role as Role) }) }
  const waiting = r.approver_role ? (ap[r.approver_role] ?? roleLabel(r.approver_role)) : ''
  if (r.status === 'pending') return { approver: waiting, waitingOn: waiting }
  if (r.status === 'cancelled') return { approver: waiting }
  return { approver: r.decider_name ?? waiting }
}

export function toMyRequest(r: RequestRow, d: RequestDetailRows, atts: AttachmentInfo[], ap: Approvers): MyRequest {
  const ty = TYPE_UI[r.type]
  const { fields, items, leaveDays, totals, closure } = describe(r, d)
  const { approver, waitingOn } = approverOf(r, ap)
  const head: { label: string; value: string }[] = []
  if (r.project) head.push({ label: t('views.field.project'), value: r.project })
  if (r.note && (r.type === 'expense' || r.type === 'leave' || r.type === 'travel')) fields.push({ label: t('views.field.note'), value: r.note })
  return {
    id: r.id,
    date: formatDay(stampDay(r.created_at)),
    dateISO: stampDay(r.created_at),
    type: ty,
    typeLabel: typeLabelOf(r, ty),
    title: requestTitle(r),
    amount: money(r.total_base_minor),
    status: r.status as RequestStatus,
    detail: {
      approver,
      waitingOn,
      totals,
      closure,
      submittedAt: stampLabel(r.submitted_at) ?? '',
      decidedAt: stampLabel(r.decided_at),
      paidAt: stampLabel(r.paid_at),
      cancelledAt: stampLabel(r.cancelled_at),
      rejectReason: r.status === 'rejected' ? (r.decision_note ?? undefined) : undefined,
      fields: [...head, ...fields],
      items,
      attachments: atts.map((a) => ({ id: a.id, name: a.sensitive ? t('views.healthReport') : a.name })),
      leaveDays,
    },
  }
}

export function toListRequest(r: RequestRow): MyRequest {
  const ty = TYPE_UI[r.type]
  return {
    id: r.id,
    date: formatDay(stampDay(r.created_at)),
    dateISO: stampDay(r.created_at),
    type: ty,
    typeLabel: typeLabelOf(r, ty),
    title: requestTitle(r),
    amount: money(r.total_base_minor),
    status: r.status as RequestStatus,
    detail: { approver: '', submittedAt: stampLabel(r.submitted_at) ?? '', fields: [] },
  }
}

export function toApproval(r: RequestRow, d: RequestDetailRows, atts: AttachmentInfo[], openAdvanceMinor: number, allocatedMinor: number): ApprovalRequest {
  const ty = TYPE_UI[r.type]
  const { fields, items, hero } = describe(r, d)
  const byItem = new Map(atts.filter((a) => a.requestItemId).map((a) => [a.requestItemId as string, a]))
  const attachments: ApprovalAttachment[] = atts.map((a) => ({
    id: a.id,
    name: a.sensitive ? t('views.healthReport') : a.name,
    kind: isImage(a.contentType) && a.contentType !== 'image/heic' && a.contentType !== 'image/heif' ? 'image' : a.contentType === 'application/pdf' ? 'pdf' : 'file',
  }))
  const submittedDay = stampDay(r.submitted_at ?? r.created_at)
  return {
    id: r.id,
    requesterId: r.requester_id,
    who: r.requester_name,
    hue: r.requester_hue ?? 220,
    type: ty,
    typeLabel: typeLabelOf(r, ty),
    title: requestTitle(r),
    hero,
    amount: money(r.total_base_minor),
    amountValue: r.total_base_minor == null ? null : fromMinor(r.total_base_minor),
    date: formatDay(submittedDay),
    dateISO: submittedDay,
    submittedAt: stampLabel(r.submitted_at) ?? '',
    status: r.status as RequestStatus,
    decidedAt: stampLabel(r.decided_at),
    rejectReason: r.decision_note ?? undefined,
    project: r.project ?? undefined,
    note: r.type === 'expense' ? (r.note ?? undefined) : undefined,
    fields,
    items: d.items?.map((it, i) => ({
      desc: it.description ?? expenseCategoryLabel(it.category),
      date: formatDay(it.expense_date),
      cat: expenseCategoryLabel(it.category),
      receipt: byItem.get(it.id)?.name ?? '',
      amount: items?.[i]?.amount ?? '',
      sub: items?.[i]?.sub ?? '',
    })),
    attachments,
    openAdvance: fromMinor(openAdvanceMinor),
    allocated: fromMinor(allocatedMinor),
    requesterRole: requesterRoleLabel(r),
  }
}
