import { z } from 'zod'
import { t } from '#/i18n'
import { APPROVER_ROLES, normalizeApprovalRules, REQUEST_KINDS, ROLES, type ApprovalRules } from '#/lib/approvals'
import type { JobType } from '#/lib/jobs'
import { must } from '../auth/authorize'
import { APPROVALS_KEY, loadApprovalRules } from '../approvalRules'
import type { Ctx } from '../ctx'
import { audit, nowIso } from '../db/d1'
import { writeSetting } from '../settings'
import { commit, fail, type Fail } from '../submit'
import { listJobTypes } from './jobTypes'

export interface SettingsData {
  approvals: ApprovalRules
  jobTypes: JobType[]
}

export async function getSettings(ctx: Ctx): Promise<SettingsData> {
  must(ctx.user, { a: 'user.manage' })
  const [approvals, jobTypes] = await Promise.all([loadApprovalRules(ctx.db), listJobTypes(ctx.db)])
  return { approvals, jobTypes }
}

const route = z.object(Object.fromEntries(ROLES.map((r) => [r, z.enum(APPROVER_ROLES)])) as Record<(typeof ROLES)[number], z.ZodEnum<{ manager: 'manager'; approver: 'approver'; owner: 'owner' }>>)
const rulesSchema = z.object({
  routes: z.object(Object.fromEntries(REQUEST_KINDS.map((k) => [k, route])) as Record<(typeof REQUEST_KINDS)[number], typeof route>),
  autoApprove: z.array(z.enum(ROLES as ['employee', 'manager', 'approver', 'owner'])).max(ROLES.length),
})

export async function saveApprovalRules(ctx: Ctx, input: unknown): Promise<{ ok: true; approvals: ApprovalRules } | Fail> {
  must(ctx.user, { a: 'user.manage' })
  const p = rulesSchema.safeParse(input)
  if (!p.success) return fail(t('settings.approvals.invalid'))
  const next = normalizeApprovalRules(p.data)
  const before = await loadApprovalRules(ctx.db)
  const now = nowIso()
  const err = await commit(
    ctx,
    [writeSetting(ctx.db, APPROVALS_KEY, next, ctx.user.id, now), audit(ctx.db, { actorId: ctx.user.id, action: 'settings.approvals', entityType: 'settings', entityId: APPROVALS_KEY, before, after: next })],
    [],
  )
  return err ?? { ok: true, approvals: next }
}
