import type { Currency } from '#/lib/money'
import { createServerFn } from '@tanstack/react-start'
import { toFormData } from '#/lib/formData'
import { t } from '#/i18n'
import { formatDate } from '#/i18n/format'
import { authed, readForm } from '#/server/fn'
import { linkInvoice as linkSvc, linkTargets as targetsSvc, unlinkInvoice as unlinkSvc } from '#/server/services/invoiceLinks'
import { createInvoice, invoiceHistory as historySvc, listInvoices as listSvc, settleInvoice as settleSvc, updateInvoice as updateSvc, type InvoiceHistory } from '#/server/services/manage'
import type { FailResult } from '#/lib/useSubmit'
import { clientError } from '#/lib/clientError'

export { invoiceEditSchema, invoiceItemSchema, invoiceSchema } from '#/lib/manageSchemas'

export interface InvoiceItem {
  name: string
  qty: number
  serial?: string
  toInventory: boolean
}

export interface Invoice {
  id: string
  direction: 'in' | 'out'
  no: string
  firm: string
  date: string
  net: number
  vatRate: number
  vat: number
  total: number
  due: string | null
  settledOn: string | null
  uploadedBy: string
  currency: Currency
  fxRate: number | null
  netOrig: number
  vatOrig: number
  totalOrig: number
  version: number
  costKind: 'direct' | 'overhead' | null
  fileName: string
  fileId?: string
  beforeBooks: boolean
  approval: 'pending' | 'approved' | 'rejected'
  rejectNote?: string
  items: InvoiceItem[]
  links: { kind: LinkKind; id: string; label: string }[]
}

export type LinkKind = 'asset' | 'digital' | 'job'

export interface LinkedInvoice {
  id: string
  no: string
  counterparty: string
  date: string
  direction: 'in' | 'out'
  totalTry: number
  currency: Currency
  fxRate?: number
  totalOrig?: number
  hasPdf: boolean
  fileUrl: string | null
}

export interface LinkTarget {
  kind: LinkKind
  id: string
  label: string
  sub: string
}

export const kindLabel = (k: LinkKind): string => t(k === 'asset' ? 'invoices.kinds.asset' : k === 'digital' ? 'invoices.kinds.digital' : 'invoices.kinds.job')

export const listInvoices = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => listSvc(context))

export type InvoiceResult = { ok: true; invoice: Invoice; assets: number } | FailResult

const submitFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => createInvoice(context, data))

export const submitInvoice = (input: unknown): Promise<InvoiceResult> =>
  submitFn({ data: toFormData(input) }).catch((e) => ({ ok: false, error: clientError(e) }))

const settleFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => settleSvc(context, data))

export const settleInvoice = (input: { id: string; settledOn: string | null }): Promise<{ ok: true; settledOn: string | null } | FailResult> =>
  settleFn({ data: input }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const updateFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => updateSvc(context, data))

export const updateInvoice = (input: unknown): Promise<{ ok: true; invoice: Invoice } | FailResult> =>
  updateFn({ data: input as Record<string, unknown> }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const historyFn = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { id: string }) => d)
  .handler(({ data, context }) => historySvc(context, data.id))

export const loadInvoiceHistory = (id: string): Promise<InvoiceHistory> => historyFn({ data: { id } })
export type { InvoiceHistory }

export const dateLabel = (iso: string) => formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' })

const linkFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => linkSvc(context, data))
export const linkInvoice = (input: { invoiceId: string; kind: LinkKind; id: string }): Promise<{ ok: true } | FailResult> =>
  linkFn({ data: input }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const unlinkFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => unlinkSvc(context, data))
export const unlinkInvoice = (input: { invoiceId: string; kind: LinkKind; id: string }): Promise<{ ok: true } | FailResult> =>
  unlinkFn({ data: input }).catch((e) => ({ ok: false as const, error: clientError(e) }))

export const loadLinkTargets = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => targetsSvc(context))
