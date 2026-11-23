import { createServerFn } from '@tanstack/react-start'
import type { DigitalCurrency, DigitalKind, DigitalPeriod } from '#/lib/manageSchemas'
import type { LinkedInvoice } from '#/data/invoices'
import type { FailResult } from '#/lib/useSubmit'
import { authed } from '#/server/fn'
import * as svc from '#/server/services/manage'
import { clientError } from '#/lib/clientError'

export { digitalSchema, DIGITAL_KIND_LABEL, DIGITAL_PERIOD_LABEL, monthlyCost, monthlyBase, type DigitalCurrency, type DigitalKind, type DigitalPeriod, type FxRates } from '#/lib/manageSchemas'

export interface DigitalAsset {
  id: string
  kind: DigitalKind
  name: string
  vendor: string
  plan: string
  seats: number | null
  accountEmail: string
  ownerId: string | null
  ownerName: string
  renewsOn: string | null
  period: DigitalPeriod
  cost: number | null
  currency: DigitalCurrency
  verified: boolean
  source: string
  lastPaidOn: string | null
  lastPaid: number | null
  paidBy: string
  status: 'active' | 'cancelled'
  note: string
  purpose: string
  users: { id: string; name: string }[]
  invoices?: LinkedInvoice[]
  hasInvoice?: boolean
}

export const loadDigital = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }) => ({ items: await svc.listDigital(context), users: await svc.assignableUsers(context), fx: await svc.fxRates(context.db) }))

const saveFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => svc.saveDigital(context, data))

export const submitDigital = (input: unknown): Promise<{ ok: true; id: string } | FailResult> =>
  saveFn({ data: input as Record<string, unknown> }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const fxFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => svc.saveFx(context, data))

export const submitFx = (input: unknown): Promise<{ ok: true } | FailResult> =>
  fxFn({ data: input as Record<string, unknown> }).catch((e) => ({ ok: false as const, error: clientError(e) }))
