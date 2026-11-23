import { createServerFn } from '@tanstack/react-start'
import type { Agreement } from './agreements'
import type { Receivables } from '#/lib/invoice'
import type { Breakdown, RateSettings } from '#/lib/finance'
import { authed } from '#/server/fn'
import type { FailResult } from '#/lib/useSubmit'
import { overview, saveFixedCosts } from '#/server/services/manage'
import { clientError } from '#/lib/clientError'

export { fixedCostSchema } from '#/lib/manageSchemas'

export interface MonthData {
  key: string
  year: number
  month: number
  income: number
  expense: number
  invoiceCount: number
  customerCount: number
  breakdown: Breakdown
  fixedMissing: boolean
}

export interface OverviewData {
  todayISO: string
  currentKey: string
  months: MonthData[]
  receivables: Receivables
  expiring: Agreement[]
  agreementCount: number
  pending: { leave: number; other: number; otherSum: number; oldestDays: number }
  renewals: { id: string; name: string; sub: string; renewsOn: string }[]
  digitalMonthly: number
  digitalMissingFx: number
  rate: RateSettings & { peopleAuto: boolean }
}

export const loadOverview = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => overview(context))

const fixedFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => saveFixedCosts(context, data))

export const submitFixedCosts = (input: unknown): Promise<{ ok: true } | FailResult> =>
  fixedFn({ data: input as Record<string, unknown> }).catch((e) => ({ ok: false, error: clientError(e) }))
