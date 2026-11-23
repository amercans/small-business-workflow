import { createServerFn } from '@tanstack/react-start'
import { roleLabel, type Actor, type Role } from '#/lib/permissions'
import { authed } from '#/server/fn'
import { findUserById } from '#/server/db/users'
import { todayISO, todayLong } from '#/server/time'
import { pendingAssets, pendingPolicies } from '#/server/services/compliance'
import type { PolicyDoc } from '#/lib/legal'
import { env } from 'cloudflare:workers'
import { runtimeConfig, type RuntimeConfig } from '#/config/runtime'
import { vatRates } from '#/server/vat'
import { storedRates } from '#/server/fx'
import { CURRENCIES, type Currency } from '#/lib/money'

const pickRates = (r: Partial<Record<Currency, number | null>>) => Object.fromEntries(CURRENCIES.map((c) => [c, r[c] ?? null])) as Record<Currency, number | null>
import { currentLocale, type Locale } from '#/i18n'
import { autoApprovedKinds, loadApprovalRules } from '#/server/approvalRules'
import type { RequestKindKey } from '#/lib/approvals'

export type { Role }

export interface SessionUser extends Actor {
  name: string
  first: string
  roleLabel: string
  avatarHue: number
}

export interface DevUserOption {
  email: string
  label: string
  inactive: boolean
}

export interface Session {
  locale: Locale
  config: RuntimeConfig
  mailEnabled: boolean
  today: string
  todayISO: string
  user: SessionUser
  autoApproveKinds: RequestKindKey[]
  pendingPolicies: PolicyDoc[]
  pendingAssets: Awaited<ReturnType<typeof pendingAssets>>
  devUsers?: DevUserOption[]
  devCurrent?: string
}

export const loadSession = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<Session> => {
    const row = await findUserById(context.db, context.user.id)
    if (!row) throw new Error('user not found')
    const role = row.role
    const user: SessionUser = {
      id: row.id,
      name: row.display_name,
      first: row.display_name.split(' ')[0],
      role,
      roleLabel: roleLabel(role),
      avatarHue: row.avatar_hue ?? 220,
      isAdmin: row.is_admin === 1,
      canUploadInvoices: role === 'employee' ? row.can_upload_invoices === 1 : true,
      canManageJobs: role === 'employee' ? row.can_manage_jobs === 1 : true,
    }
    const session: Session = { locale: currentLocale(), config: { ...runtimeConfig(), vatRates: await vatRates(context.db), fxRates: pickRates(await storedRates(context.db)) }, mailEnabled: env.MAIL_MODE === 'resend', today: todayLong(), todayISO: todayISO(), user, autoApproveKinds: autoApprovedKinds(await loadApprovalRules(context.db), role), pendingPolicies: await pendingPolicies(context.db, row.id), pendingAssets: await pendingAssets(context.db, row.id) }
    if (import.meta.env.DEV) {
      const { devUserOptions } = await import('#/server/auth/dev-identity')
      session.devUsers = (await devUserOptions(context.db)).map((u) => ({
        email: u.email,
        label: `${u.display_name} · ${roleLabel(u.role as Role)}`,
        inactive: u.status !== 'active',
      }))
      session.devCurrent = row.email
    }
    return session
  })
