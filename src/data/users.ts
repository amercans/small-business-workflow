import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import type { Role } from '#/lib/permissions'
import type { FailResult } from '#/lib/useSubmit'
import { authed, panelOrigin } from '#/server/fn'
import * as svc from '#/server/services/manage'
import * as admin from '#/server/services/accountsAdmin'
import { clientError } from '#/lib/clientError'
import { mailDelivers } from '#/server/mailer'

export { userSchema } from '#/lib/manageSchemas'

export type UserStatus = 'pending' | 'active' | 'inactive'

export interface AppUser {
  id: string
  displayName: string
  email: string
  role: Role
  isAdmin: boolean
  canUploadInvoices: boolean
  canManageJobs: boolean
  avatarHue: number
  status: UserStatus
  leaveEntitlement: number
  canLogin: boolean
  department: string
  emailVerified: boolean
}

export const loadUsers = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }) => ({ users: await svc.listUsers(context), emailDomain: env.ALLOWED_EMAIL_DOMAIN ?? '', mailDelivers: mailDelivers(), tokens: await admin.listTokens(context) }))

export type UserResult = { ok: true; user: AppUser; warning?: string } | FailResult

const saveFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => svc.saveUser(context, data, env.ALLOWED_EMAIL_DOMAIN ?? '', { mailDelivers: mailDelivers() }))

export const submitUser = (input: unknown): Promise<UserResult> =>
  saveFn({ data: input as Record<string, unknown> }).catch((e) => ({ ok: false, error: clientError(e) }))

const inviteFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => admin.inviteLink(context, data, { panelUrl: panelOrigin(), allowedDomain: env.ALLOWED_EMAIL_DOMAIN ?? '' }))

export const createInviteLink = (input: { role: Role; email?: string }): Promise<admin.LinkResult> =>
  inviteFn({ data: input as unknown as Record<string, unknown> }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const resetFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => admin.resetLink(context, data, { panelUrl: panelOrigin() }))

export const createResetLink = (id: string): Promise<admin.LinkResult> => resetFn({ data: { id } }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const revokeFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => admin.revokeLink(context, data))

export const revokeLink = (id: string): Promise<{ ok: true } | { ok: false; error: string }> => revokeFn({ data: { id } }).catch((e) => ({ ok: false as const, error: clientError(e) }))

export type { OpenLink } from '#/server/services/accountsAdmin'
