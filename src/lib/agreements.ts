import { t } from '#/i18n'

const MS_DAY = 86_400_000

export const daysBetween = (fromISO: string, toISO: string): number =>
  Math.round((Date.parse(toISO) - Date.parse(fromISO)) / MS_DAY)

export const daysLeft = (end: string | null, todayISO: string): number | null => (end ? daysBetween(todayISO, end) : null)

export type AgreementState = 'active' | 'expiring' | 'ended'

export function agreementState(end: string | null, todayISO: string, soon = 60): AgreementState {
  const left = daysLeft(end, todayISO)
  if (left === null) return 'active'
  if (left < 0) return 'ended'
  return left <= soon ? 'expiring' : 'active'
}

export const isHot = (left: number | null) => left !== null && left >= 0 && left <= 30

export type Period = 'yearly' | 'monthly' | 'one_time'

export const periodUnit = (p: Period): string => t(p === 'yearly' ? 'agreements.unit.yearly' : p === 'monthly' ? 'agreements.unit.monthly' : 'agreements.unit.oneTime')

export const periodName = (p: Period): string => t(p === 'yearly' ? 'agreements.period.yearly' : p === 'monthly' ? 'agreements.period.monthly' : 'agreements.period.oneTime')
