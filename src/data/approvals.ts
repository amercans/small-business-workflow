import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { RequestStatus, RequestType } from './home'
import { advanceOffset } from '#/lib/expense'
import { formatMoney } from '#/lib/money'
import { authed } from '#/server/fn'
import * as svc from '#/server/services/requests'
import * as invSvc from '#/server/services/invoiceApproval'
import type { PendingInvoice } from '#/server/services/invoiceApproval'
import { clientError } from '#/lib/clientError'
import { t } from '#/i18n'

export interface ApprovalAttachment {
  id: string
  name: string
  kind: 'image' | 'pdf' | 'file'
}

export interface ApprovalItem {
  desc: string
  date: string
  cat: string
  receipt: string
  amount: string
  sub: string
}

export interface ApprovalRequest {
  id: string
  requesterId: string
  who: string
  hue: number
  type: RequestType
  typeLabel: string
  title: string
  hero: string
  amount: string
  amountValue: number | null
  date: string
  dateISO: string
  submittedAt: string
  status: RequestStatus
  decidedAt?: string
  rejectReason?: string
  project?: string
  note?: string
  fields: { label: string; value: string }[]
  items?: ApprovalItem[]
  attachments: ApprovalAttachment[]
  openAdvance: number
  allocated: number
  requesterRole: string
}

export interface RefundDue {
  id: string
  title: string
  who: string
  hue: number
  amount: string
  closedAt: string
}

export interface ApprovalsData {
  todayISO: string
  pending: ApprovalRequest[]
  decided: ApprovalRequest[]
  refunds: RefundDue[]
  invoices: PendingInvoice[]
}

export type { PendingInvoice }

export const loadApprovals = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => svc.approvals(context))

export type DecideResult = { ok: true } | { ok: false; error: string }

const decideInput = z.object({
  id: z.string().length(26),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})

const decideFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: z.input<typeof decideInput>) => decideInput.parse(d))
  .handler(({ data, context }) => svc.decide(context, data.id, data.decision, data.note))

const paidFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string }) => z.object({ id: z.string().length(26) }).parse(d))
  .handler(({ data, context }) => svc.markPaid(context, data.id))

const refundFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string }) => z.object({ id: z.string().length(26) }).parse(d))
  .handler(({ data, context }) => svc.refundReceived(context, data.id))

const invoiceDecideInput = decideInput.extend({ version: z.number().int().min(1) })
const invoiceDecideFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: z.input<typeof invoiceDecideInput>) => invoiceDecideInput.parse(d))
  .handler(({ data, context }) => invSvc.decideInvoice(context, data.id, data.decision, data.note, { expectedVersion: data.version }))

const failed = (e: unknown) => ({ ok: false as const, error: clientError(e) })
export const decideInvoice = (id: string, version: number, decision: 'approved' | 'rejected', note?: string) => invoiceDecideFn({ data: { id, version, decision, note } }).catch(failed)
export const refundReceived = (id: string) => refundFn({ data: { id } }).catch(failed)
export const decide = (id: string, decision: 'approved' | 'rejected', note?: string) => decideFn({ data: { id, decision, note } }).catch(failed)
export const markPaid = (id: string) => paidFn({ data: { id } }).catch(failed)

export function advanceNote(r: ApprovalRequest): string {
  if (r.type !== 'expense' || !r.amountValue || r.openAdvance <= 0 || r.allocated <= 0) return ''
  const o = advanceOffset(r.amountValue, r.allocated)
  return o.payable > 0
    ? t('approvals.advanceNoteSplit', { open: formatMoney(r.openAdvance), offset: formatMoney(o.offset), payable: formatMoney(o.payable) })
    : t('approvals.advanceNoteFull', { open: formatMoney(r.openAdvance), left: formatMoney(Math.max(0, r.openAdvance - r.amountValue)) })
}

export function oldestDays(list: ApprovalRequest[], todayISO: string): number {
  if (list.length === 0) return 0
  const oldest = list.reduce((m, r) => (r.dateISO < m ? r.dateISO : m), list[0].dateISO)
  return Math.round((Date.parse(todayISO) - Date.parse(oldest)) / 86_400_000)
}
