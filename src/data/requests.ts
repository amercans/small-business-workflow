import { createServerFn } from '@tanstack/react-start'
import { toFormData } from '#/lib/formData'
import { authed, readForm } from '#/server/fn'
import * as svc from '#/server/services/requests'
import type { SubmitResult } from '#/server/services/requests'
import { clientError } from '#/lib/clientError'

export * from '#/lib/requestSchemas'
export type { SubmitResult }

const expenseFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => svc.submitExpense(context, data))
const advanceFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => svc.submitAdvance(context, data))
const purchaseFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => svc.submitPurchase(context, data))
const travelFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => svc.submitTravel(context, data))

const send =
  (fn: (opts: { data: FormData }) => Promise<SubmitResult>) =>
  (input: unknown): Promise<SubmitResult> =>
    fn({ data: toFormData(input) }).catch((e) => ({ ok: false, error: clientError(e) }))

export const submitExpenseRequest = send(expenseFn)
export const submitAdvanceRequest = send(advanceFn)
export const submitPurchaseRequest = send(purchaseFn)
export const submitTravelRequest = send(travelFn)
