import { DECIDERS, MANAGEMENT, type Role } from '#/lib/permissions'
import { t } from '#/i18n'

export interface AuthUser {
  id: string
  email: string
  role: Role
  isAdmin: boolean
  canUploadInvoices: boolean
  canManageJobs: boolean
  status: 'active' | 'inactive'
}

export type RequestKind = 'leave' | 'expense' | 'advance' | 'purchase' | 'travel'
export type RequestState = 'draft' | 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled'

export type ApproverRole = 'manager' | 'approver' | 'owner'

export interface RequestRes {
  requesterId: string
  type: RequestKind
  status: RequestState
  approverRole?: ApproverRole | null
}

export type AttachmentParent =
  | { kind: 'request'; request: RequestRes; sensitive: boolean }
  | { kind: 'invoice'; uploadedBy: string }
  | { kind: 'agreement' }

export type Action =
  | { a: 'request.read'; r: RequestRes }
  | { a: 'request.create' }
  | { a: 'request.cancel'; r: RequestRes }
  | { a: 'request.addReport'; r: RequestRes }
  | { a: 'request.decide'; r: RequestRes }
  | { a: 'request.markPaid'; r: RequestRes }
  | { a: 'advance.close'; r: RequestRes }
  | { a: 'advance.refundReceived'; r: RequestRes }
  | { a: 'approvals.list' }
  | { a: 'requests.all' }
  | { a: 'attachment.read'; p: AttachmentParent }
  | { a: 'invoice.create'; direction: 'in' | 'out' }
  | { a: 'invoice.list' }
  | { a: 'invoice.read'; uploadedBy: string }
  | { a: 'invoice.update' }
  | { a: 'invoice.decide'; uploadedBy: string; status: 'pending' | 'approved' | 'rejected' }
  | { a: 'agreement.read' }
  | { a: 'agreement.write' }
  | { a: 'asset.read' }
  | { a: 'asset.write' }
  | { a: 'dashboard.read' }
  | { a: 'fixedCost.write' }
  | { a: 'leaveEntitlement.write' }
  | { a: 'export.expenses' }
  | { a: 'export.invoices' }
  | { a: 'report.read' }
  | { a: 'user.manage' }
  | { a: 'audit.read' }
  | { a: 'calendar.read' }
  | { a: 'jobs.read' }
  | { a: 'jobs.write' }
  | { a: 'jobs.money' }

export type Decision = { ok: true } | { ok: false; reason: 'forbidden' | 'not_found' }

const OK: Decision = { ok: true }
const FORBIDDEN: Decision = { ok: false, reason: 'forbidden' }
const NOT_FOUND: Decision = { ok: false, reason: 'not_found' }

const isMgmt = (u: AuthUser) => MANAGEMENT.includes(u.role)
const isApprover = (u: AuthUser) => u.role === 'approver'
const allow = (cond: boolean, otherwise: Decision = FORBIDDEN): Decision => (cond ? OK : otherwise)

function readsOthersRequest(u: AuthUser, r: RequestRes): boolean {
  if (r.status === 'draft') return false
  return isMgmt(u)
}

export function canDecideRequest(u: AuthUser, r: Pick<RequestRes, 'requesterId' | 'approverRole'>): boolean {
  if (r.requesterId === u.id) return false
  return !!r.approverRole && u.role === r.approverRole
}

export function authorize(u: AuthUser, act: Action): Decision {
  if (u.status !== 'active') return FORBIDDEN

  switch (act.a) {
    case 'request.read': {
      const r = act.r
      if (r.requesterId === u.id) return OK
      return allow(readsOthersRequest(u, r), NOT_FOUND)
    }
    case 'request.create':
      return OK
    case 'request.cancel':
      if (act.r.requesterId !== u.id) return NOT_FOUND
      return allow(act.r.status === 'draft' || act.r.status === 'pending')
    case 'request.addReport':
      if (act.r.requesterId !== u.id) return NOT_FOUND
      return allow(act.r.type === 'leave' && (act.r.status === 'pending' || act.r.status === 'approved'))
    case 'request.decide': {
      const r = act.r
      if (r.requesterId !== u.id && !readsOthersRequest(u, r)) return NOT_FOUND
      return allow(r.status === 'pending' && canDecideRequest(u, r))
    }
    case 'request.markPaid': {
      const r = act.r
      if (r.requesterId !== u.id && !readsOthersRequest(u, r)) return NOT_FOUND
      return allow(isApprover(u) && (r.type === 'expense' || r.type === 'advance') && r.status === 'approved')
    }
    case 'advance.close':
      if (act.r.requesterId !== u.id) return NOT_FOUND
      return allow(act.r.type === 'advance' && act.r.status === 'paid')
    case 'advance.refundReceived': {
      const r = act.r
      if (r.requesterId !== u.id && !readsOthersRequest(u, r)) return NOT_FOUND
      return allow(isApprover(u) && r.requesterId !== u.id && r.type === 'advance' && r.status === 'paid')
    }
    case 'calendar.read':
      return OK
    case 'requests.all':
      return allow(isMgmt(u))
    case 'approvals.list':
      return allow(DECIDERS.includes(u.role))
    case 'attachment.read': {
      const p = act.p
      if (p.kind === 'request') {
        if (p.request.requesterId === u.id) return OK
        if (p.sensitive) return allow(isMgmt(u) && p.request.status !== 'draft', NOT_FOUND)
        return allow(readsOthersRequest(u, p.request), NOT_FOUND)
      }
      if (p.kind === 'invoice') return authorize(u, { a: 'invoice.read', uploadedBy: p.uploadedBy })
      return allow(isMgmt(u), NOT_FOUND)
    }
    case 'invoice.create':
      if (isMgmt(u)) return OK
      return allow(u.role === 'employee' && u.canUploadInvoices && act.direction === 'in')
    case 'invoice.list':
      return allow(isMgmt(u) || (u.role === 'employee' && u.canUploadInvoices))
    case 'invoice.read':
      if (isMgmt(u)) return OK
      return allow(u.role === 'employee' && u.canUploadInvoices && act.uploadedBy === u.id, NOT_FOUND)
    case 'invoice.decide':
      if (!isMgmt(u)) return NOT_FOUND
      return allow(isApprover(u) && act.uploadedBy !== u.id && act.status === 'pending')
    case 'invoice.update':
    case 'agreement.read':
    case 'agreement.write':
    case 'asset.read':
    case 'asset.write':
    case 'dashboard.read':
    case 'fixedCost.write':
    case 'leaveEntitlement.write':
    case 'export.invoices':
      return allow(isMgmt(u))
    case 'export.expenses':
    case 'report.read':
      return allow(isMgmt(u))
    case 'jobs.read':
      return OK
    case 'jobs.write':
      return allow(isMgmt(u) || (u.role === 'employee' && u.canManageJobs))
    case 'jobs.money':
      return allow(isMgmt(u))
    case 'user.manage':
    case 'audit.read':
      return allow(u.isAdmin)
    default: {
      const never: never = act
      return never
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function must(u: AuthUser, act: Action): void {
  const d = authorize(u, act)
  if (!d.ok) throw d.reason === 'not_found' ? new HttpError(404, t('server.recordNotFound')) : new HttpError(403, t('server.forbidden'))
}
