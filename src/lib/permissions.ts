import { t } from '#/i18n'

export type Role = 'employee' | 'manager' | 'approver' | 'owner'

export const roleLabel = (role: Role): string => t(`roles.${role}`)

export const MANAGEMENT: readonly Role[] = ['manager', 'approver', 'owner']

export const DECIDERS: readonly Role[] = ['manager', 'approver', 'owner']

export interface Actor {
  id: string
  role: Role
  isAdmin: boolean
  canUploadInvoices: boolean
  canManageJobs?: boolean
}

export type Area = 'approvals' | 'allRequests' | 'overview' | 'reports' | 'agreements' | 'invoices' | 'inventory' | 'jobs' | 'users' | 'settings'

export const isManagement = (role: Role) => MANAGEMENT.includes(role)

export const canWriteJobs = (user: Actor) => isManagement(user.role) || (user.role === 'employee' && !!user.canManageJobs)

export function canAccess(user: Actor, area: Area): boolean {
  switch (area) {
    case 'approvals':
      return DECIDERS.includes(user.role)
    case 'allRequests':
    case 'overview':
    case 'reports':
    case 'agreements':
    case 'inventory':
      return isManagement(user.role)
    case 'invoices':
      return isManagement(user.role) || (user.role === 'employee' && user.canUploadInvoices)
    case 'jobs':
      return true
    case 'users':
    case 'settings':
      return user.isAdmin
  }
}

export interface DecisionTarget {
  requesterId: string
  approverRole?: Role | null
}

export function canDecide(user: Actor, req: DecisionTarget): boolean {
  if (req.requesterId === user.id) return false
  return !!req.approverRole && user.role === req.approverRole
}

export function canMarkPaid(user: Actor, req: { type: 'leave' | 'expense' | 'advance' | 'purchase' | 'travel'; status: string }): boolean {
  return user.role === 'approver' && (req.type === 'expense' || req.type === 'advance') && req.status === 'approved'
}

export const seesAllInvoices = (user: Actor) => isManagement(user.role)

export const seesJobMoney = (user: Actor) => isManagement(user.role)
