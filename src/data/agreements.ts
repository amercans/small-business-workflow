import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { toFormData } from '#/lib/formData'
import type { AgreementPeriod } from '#/lib/manageSchemas'
import type { FailResult } from '#/lib/useSubmit'
import { authed, readForm } from '#/server/fn'
import * as svc from '#/server/services/manage'
import { clientError, notFoundOrThrow } from '#/lib/clientError'

export { agreementSchema, PERIOD_LABEL, type AgreementPeriod } from '#/lib/manageSchemas'

export interface Agreement {
  id: string
  counterparty: string
  title: string
  start: string
  end: string | null
  amount: number
  period: AgreementPeriod
  tag: string
  note: string
  pdfName: string
  pdfId?: string
}

export const listAgreements = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => svc.listAgreements(context))

const getFn = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { id: string }) => z.object({ id: z.string().length(26) }).parse(d))
  .handler(({ data, context }) => svc.getAgreement(context, data.id))

export const getAgreement = (id: string) => getFn({ data: { id } }).catch(notFoundOrThrow)

export type SubmitAgreementResult = { ok: true; agreement: Agreement } | FailResult

const submitFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => svc.createAgreement(context, data))

export const submitAgreement = (input: unknown): Promise<SubmitAgreementResult> =>
  submitFn({ data: toFormData(input) }).catch((e) => ({ ok: false, error: clientError(e) }))
