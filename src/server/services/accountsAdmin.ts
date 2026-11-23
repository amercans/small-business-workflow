import { z } from 'zod'
import { must } from '../auth/authorize'
import { ADMIN_RESET_TTL_MS, createInvite, createResetToken, emailAllowed, openTokens, revokeToken } from '../auth/accounts'
import type { Ctx } from '../ctx'
import type { Role } from '#/lib/permissions'
import { t } from '#/i18n'

const ROLES = ['employee', 'manager', 'approver', 'owner'] as const satisfies readonly Role[]

export type LinkResult = { ok: true; url: string; expiresAt: string } | { ok: false; error: string }

const base = (panelUrl: string) => panelUrl.replace(/\/$/, '')

export async function inviteLink(ctx: Ctx, input: unknown, opts: { panelUrl: string; allowedDomain: string }): Promise<LinkResult> {
  must(ctx.user, { a: 'user.manage' })
  const p = z.object({ role: z.enum(ROLES), email: z.string().trim().toLowerCase().max(200).optional().default('') }).safeParse(input)
  if (!p.success) return { ok: false, error: t('users.invite.invalid') }
  const email = p.data.email || null
  if (email && !/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: t('auth.errors.emailInvalid') }
  if (email && !emailAllowed(email, opts.allowedDomain)) return { ok: false, error: t('auth.register.domainRejected', { domain: opts.allowedDomain.replace(/^@/, '') }) }
  const r = await createInvite(ctx.db, ctx.user, { role: p.data.role, email })
  return { ok: true, url: `${base(opts.panelUrl)}/register?invite=${r.token}`, expiresAt: r.expiresAt }
}

export async function resetLink(ctx: Ctx, input: unknown, opts: { panelUrl: string }): Promise<LinkResult> {
  must(ctx.user, { a: 'user.manage' })
  const p = z.object({ id: z.string().length(26) }).safeParse(input)
  if (!p.success) return { ok: false, error: t('users.reset.invalid') }
  const u = await ctx.db.prepare(`SELECT id, status, can_login FROM users WHERE id = ?`).bind(p.data.id).first<{ id: string; status: string; can_login: number }>()
  if (!u || u.status !== 'active' || u.can_login !== 1) return { ok: false, error: t('users.reset.notActive') }
  const r = await createResetToken(ctx.db, u.id, { createdBy: ctx.user.id, ttlMs: ADMIN_RESET_TTL_MS })
  return { ok: true, url: `${base(opts.panelUrl)}/reset/${r.token}`, expiresAt: r.expiresAt }
}

export interface OpenLink {
  id: string
  kind: 'invite' | 'reset'
  email: string | null
  role: Role | null
  userName: string | null
  expiresAt: string
}

export async function listTokens(ctx: Ctx): Promise<OpenLink[]> {
  if (!ctx.user.isAdmin) return []
  return (await openTokens(ctx.db)).map((x) => ({ id: x.id, kind: x.kind === 'reset' ? 'reset' : 'invite', email: x.email, role: x.role, userName: x.userName, expiresAt: x.expiresAt }))
}

export async function revokeLink(ctx: Ctx, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  must(ctx.user, { a: 'user.manage' })
  const p = z.object({ id: z.string().length(26) }).safeParse(input)
  if (!p.success) return { ok: false, error: t('users.reset.invalid') }
  return (await revokeToken(ctx.db, ctx.user, p.data.id)) ? { ok: true } : { ok: false, error: t('users.links.gone') }
}
