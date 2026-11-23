import { createServerFn } from '@tanstack/react-start'
import { clientError } from '#/lib/clientError'
import type { ApprovalRules } from '#/lib/approvals'
import type { JobType, JobTypeInput } from '#/lib/jobs'
import type { FailResult } from '#/lib/useSubmit'
import { authed } from '#/server/fn'
import { getSettings, saveApprovalRules } from '#/server/services/settings'
import { saveJobType as saveJobTypeSvc } from '#/server/services/jobTypes'

export type { SettingsData } from '#/server/services/settings'

export const loadSettings = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => getSettings(context))

const approvalsFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => saveApprovalRules(context, data))

export const saveApprovals = (rules: ApprovalRules): Promise<{ ok: true; approvals: ApprovalRules } | FailResult> =>
  approvalsFn({ data: rules as unknown as Record<string, unknown> }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const jobTypeFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => saveJobTypeSvc(context, data))

export const saveJobType = (input: JobTypeInput): Promise<{ ok: true; types: JobType[] } | FailResult> =>
  jobTypeFn({ data: input as Record<string, unknown> }).catch((e) => ({ ok: false as const, error: clientError(e) }))
