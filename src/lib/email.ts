import { t } from '#/i18n'

export interface EmailCheck {
  ok: boolean
  warning?: string
  error?: string
}

const FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const normalizeEmail = (s: string): string => s.trim().toLowerCase()

export function checkEmailDomain(email: string, domain: string): EmailCheck {
  const e = normalizeEmail(email)
  if (!FORMAT.test(e)) return { ok: false, error: t('auth.errors.emailInvalid') }
  const d = domain.trim().toLowerCase().replace(/^@/, '')
  if (!d) return { ok: true }
  if (!e.endsWith(`@${d}`)) return { ok: false, error: t('auth.register.domainOnly', { domain: d }) }
  return { ok: true }
}
