import type { Role } from './permissions'

export const REQUEST_KINDS = ['leave', 'expense', 'advance', 'purchase', 'travel'] as const
export type RequestKindKey = (typeof REQUEST_KINDS)[number]

export const APPROVER_ROLES = ['manager', 'approver', 'owner'] as const
export type ApproverRole = (typeof APPROVER_ROLES)[number]

export const ROLES: readonly Role[] = ['employee', 'manager', 'approver', 'owner']

export interface ApprovalRules {
  routes: Record<RequestKindKey, Record<Role, ApproverRole>>
  autoApprove: Role[]
}

const DEFAULT_ROUTE: Record<Role, ApproverRole> = { employee: 'approver', manager: 'approver', approver: 'owner', owner: 'owner' }

export const defaultApprovalRules = (): ApprovalRules => ({
  routes: Object.fromEntries(REQUEST_KINDS.map((k) => [k, { ...DEFAULT_ROUTE }])) as ApprovalRules['routes'],
  autoApprove: ['owner'],
})

const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)
const isApprover = (v: unknown): v is ApproverRole => typeof v === 'string' && (APPROVER_ROLES as readonly string[]).includes(v)

export function normalizeApprovalRules(raw: unknown): ApprovalRules {
  const base = defaultApprovalRules()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as { routes?: Record<string, Record<string, unknown>>; autoApprove?: unknown }
  for (const k of REQUEST_KINDS) {
    for (const role of ROLES) {
      const v = r.routes?.[k]?.[role]
      if (isApprover(v)) base.routes[k][role] = v
    }
  }
  if (Array.isArray(r.autoApprove)) base.autoApprove = [...new Set(r.autoApprove.filter(isRole))]
  return base
}
