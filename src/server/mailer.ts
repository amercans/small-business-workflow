import { env } from 'cloudflare:workers'
import { logMailer, type Mailer } from './notify'
import { resendMailer } from './resend'
import { parseAddresses, type AccountingConfig } from './accounting'

let resend: Mailer | null = null

export const mailMode = (): 'none' | 'log' | 'resend' => (env.MAIL_MODE === 'none' || env.MAIL_MODE === 'resend' ? env.MAIL_MODE : 'log')

export function mailer(): Mailer | null {
  const mode = mailMode()
  if (mode === 'none') return null
  if (mode === 'log' || import.meta.env.DEV) return logMailer
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return null
  resend ??= resendMailer({
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    only: env.MAIL_ONLY ? env.MAIL_ONLY.split(',').map((a) => a.trim()).filter(Boolean) : undefined,
  })
  return resend
}

const textLogMailer: Mailer = {
  async send(m) {
    console.log(`[mail] ${m.to} - ${m.subject}\n${m.text}`)
  },
}

export function authMailer(): Mailer | null {
  const mode = mailMode()
  if (mode === 'none') return null
  if (mode === 'log' || import.meta.env.DEV) return textLogMailer
  return mailer()
}

export const mailDelivers = (): boolean => mailMode() === 'resend' && !import.meta.env.DEV && !!env.RESEND_API_KEY && !!env.MAIL_FROM

export function accountingConfig(): AccountingConfig {
  const only = env.MAIL_ONLY ? parseAddresses(env.MAIL_ONLY) : undefined
  return {
    to: parseAddresses(env.ACCOUNTING_TO),
    cc: parseAddresses(env.ACCOUNTING_CC),
    replyTo: parseAddresses(env.ACCOUNTING_REPLY_TO)[0],
    salutation: (env.ACCOUNTING_SALUTATION ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60),
    only: only?.length ? only : undefined,
  }
}
