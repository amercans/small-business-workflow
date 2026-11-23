import { createServerFn } from '@tanstack/react-start'
import { t } from '#/i18n'
import { z } from 'zod'
import { authed, readForm } from '#/server/fn'
import { toFormData } from '#/lib/formData'
import * as svc from '#/server/services/requests'
import { clientError, notFoundOrThrow } from '#/lib/clientError'

export type RequestType = 'leave' | 'expense' | 'advance' | 'purchase' | 'travel'
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled'

export interface TypeTile {
  key: RequestType
  label: string
  hint: string
}

export interface RequestAttachment {
  id: string
  name: string
}

export interface RequestDetail {
  approver: string
  submittedAt: string
  decidedAt?: string
  paidAt?: string
  cancelledAt?: string
  rejectReason?: string
  fields: { label: string; value: string }[]
  items?: { label: string; sub?: string; amount?: string }[]
  attachments?: RequestAttachment[]
  leaveDays?: number
  waitingOn?: string
  totals?: { subtotal: string; offset: string; net: string; hasOffset: boolean }
  closure?: {
    paid: string
    spent: string
    refund: string
    hasRefund: boolean
    settling?: string
    closedAt?: string
    note?: string
    refundReceivedAt?: string
    canClose: boolean
  }
}

export interface MyRequest {
  id: string
  date: string
  dateISO?: string
  type: RequestType
  typeLabel: string
  title: string
  amount: string
  status: RequestStatus
  justNow?: boolean
  requesterName?: string
  cancellable?: boolean
  canAddReport?: boolean
  detail: RequestDetail
}

export interface HomeData {
  todayISO: string
  nowLabel: string
  types: TypeTile[]
  statusLabel: Record<RequestStatus, string>
  leave: {
    year: number
    unlimited: boolean
    total: number | null
    left: number
    pendingDays: number
    note: string
    approvedRanges: { from: string; to: string; pending?: boolean }[]
    partialDays: { date: string; from: string; to: string; pending: boolean }[]
    approvedLabel: string
  }
  advance: {
    openAmount: number
    since: string
    reason: string
    note: string
    pendingExpenses: number
    items: { id: string; title: string; open: number }[]
  }
  colleagues: { id: string; name: string }[]
  requests: MyRequest[]
}

const TILE_KEYS = ['leave', 'expense', 'advance', 'purchase', 'travel'] as const

const types = (): TypeTile[] => TILE_KEYS.map((key) => ({ key, label: t(`schemas.requestTiles.${key}.label`), hint: t(`schemas.requestTiles.${key}.hint`) }))

export const loadHome = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => svc.homeData(context, types()))

export const loadMyRequests = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => svc.myRequests(context))

const idInput = z.object({ id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/) })

const loadRequestFn = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { id: string }) => idInput.parse(d))
  .handler(async ({ data, context }) => ({ request: await svc.myRequest(context, data.id), statusLabel: svc.STATUS_LABEL }))

export const loadRequest = (id: string) => loadRequestFn({ data: { id } }).catch((e) => (notFoundOrThrow(e), { request: null, statusLabel: {} as Record<RequestStatus, string> }))

export type CancelResult = { ok: true } | { ok: false; error: string }

const cancelFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string }) => idInput.parse(d))
  .handler(({ data, context }) => svc.cancel(context, data.id))

export const cancelRequest = (id: string) => cancelFn({ data: { id } })

const addReportFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => svc.addLeaveReport(context, data))

export const addLeaveReport = (id: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> =>
  addReportFn({ data: toFormData({ id, file }) }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const closeAdvanceFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string; note?: string }) => idInput.extend({ note: z.string().max(500).optional() }).parse(d))
  .handler(({ data, context }) => svc.closeAdvance(context, data.id, { note: data.note }))

export const closeAdvance = (id: string, note?: string) => closeAdvanceFn({ data: { id, note } })

export const loadAllRequests = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => svc.allRequests(context))

const anyFn = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { id: string }) => z.object({ id: z.string().length(26) }).parse(d))
  .handler(async ({ data, context }) => ({ request: await svc.anyRequest(context, data.id), statusLabel: svc.STATUS_LABEL }))

export const loadAnyRequest = (id: string) => anyFn({ data: { id } }).catch((e) => (notFoundOrThrow(e), { request: null, statusLabel: {} as Record<RequestStatus, string> }))
