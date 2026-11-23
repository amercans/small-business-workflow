import { normalizeApprovalRules, type ApprovalRules, type ApproverRole, type RequestKindKey } from '#/lib/approvals'
import type { Role } from '#/lib/permissions'
import type { Db } from './db/d1'
import { readSetting } from './settings'

export const APPROVALS_KEY = 'approvals'

export const loadApprovalRules = async (db: Db): Promise<ApprovalRules> => normalizeApprovalRules(await readSetting<unknown>(db, APPROVALS_KEY, null))

const hasOtherActive = async (db: Db, role: ApproverRole, requesterId: string) =>
  !!(await db.prepare(`SELECT 1 AS x FROM users WHERE status = 'active' AND can_login = 1 AND role = ? AND id <> ? LIMIT 1`).bind(role, requesterId).first<{ x: number }>())

export async function resolveApprover(db: Db, rules: ApprovalRules, kind: RequestKindKey, requester: { id: string; role: Role }): Promise<ApproverRole | 'auto'> {
  if (rules.autoApprove.includes(requester.role)) return 'auto'
  const target = rules.routes[kind][requester.role]
  if (await hasOtherActive(db, target, requester.id)) return target
  if (target !== 'owner' && (await hasOtherActive(db, 'owner', requester.id))) return 'owner'
  console.warn(JSON.stringify({ at: 'approvals', warning: 'no active user can approve this request; it stays pending until an administrator assigns an approver role', kind, requesterRole: requester.role, approverRole: target }))
  return target
}

export const autoApprovedKinds = (rules: ApprovalRules, role: Role): RequestKindKey[] => (rules.autoApprove.includes(role) ? (Object.keys(rules.routes) as RequestKindKey[]) : [])
