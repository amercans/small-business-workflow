import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { LinkedInvoice } from '#/data/invoices'
import type { AssetCondition, AssetStatus } from '#/lib/manageSchemas'
import type { FailResult } from '#/lib/useSubmit'
import { authed } from '#/server/fn'
import * as svc from '#/server/services/manage'
import { clientError, notFoundOrThrow } from '#/lib/clientError'

export { assetSchema, assignSchema, STATUS_LABEL, type AssetCondition, type AssetStatus } from '#/lib/manageSchemas'

export interface Assignment {
  userId: string
  userName: string
  from: string
  to: string | null
  returnConfirmedAt: string | null
  disputedAt: string | null
  disputeNote: string
  note: string
}

export interface Asset {
  id: string
  name: string
  serial: string
  condition: AssetCondition
  acquiredOn: string
  invoiceId?: string
  invoice?: { id: string; no: string; firm: string; date: string }
  note: string
  category: string
  quantity: number
  source: string
  history: Assignment[]
  holderOther: string
  holderOtherOn: string
  officeHolder: string
  officeOn: string
  holderName: string
  invoices?: LinkedInvoice[]
  hasInvoice?: boolean
}

export function statusOf(a: Asset): AssetStatus {
  if (a.condition === 'retired') return 'retired'
  if (a.condition === 'in_repair') return 'repair'
  return a.history.some((h) => h.to === null) || a.holderOther ? 'assigned' : 'stock'
}

const idIn = (d: { id: string }) => z.object({ id: z.string().length(26) }).parse(d)

export const loadInventory = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }) => ({ assets: await svc.listAssets(context), users: await svc.assignableUsers(context) }))

const getFn = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator(idIn)
  .handler(async ({ data, context }) => ({ asset: await svc.getAsset(context, data.id), users: await svc.assignableUsers(context) }))

export const loadAsset = (id: string) => getFn({ data: { id } }).catch((e) => (notFoundOrThrow(e), { asset: null, users: [] }))

export type AssetResult = { ok: true; asset: Asset } | FailResult
export type SimpleResult = { ok: true } | FailResult
const failed = (e: unknown) => ({ ok: false as const, error: clientError(e) })

const createFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => svc.createAsset(context, data))
const assignFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => svc.assignAsset(context, data))
const returnFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator(idIn)
  .handler(({ data, context }) => svc.returnAsset(context, data.id))

export const submitAsset = (input: unknown): Promise<AssetResult> => createFn({ data: input as Record<string, unknown> }).catch(failed)
export const assignAsset = (input: unknown): Promise<SimpleResult> => assignFn({ data: input as Record<string, unknown> }).catch(failed)
export const returnAsset = (id: string): Promise<SimpleResult> => returnFn({ data: { id } }).catch(failed)
const officeFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string; date: string }) => d)
  .handler(({ data, context }) => svc.toOffice(context, data))
export const toOffice = (id: string, date: string): Promise<SimpleResult> => officeFn({ data: { id, date } }).catch(failed)

export { assetEditSchema, seatSchema } from '#/lib/manageSchemas'

const updateFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => svc.updateAsset(context, data))
export const updateAsset = (input: unknown): Promise<SimpleResult> => updateFn({ data: input as Record<string, unknown> }).catch(failed)

const personFn = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator(idIn)
  .handler(async ({ data, context }) => svc.personInventory(context, data.id))
export const loadPerson = (id: string) => personFn({ data: { id } }).catch(notFoundOrThrow)

const seatFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => svc.setDigitalSeat(context, data))
export const setSeat = (input: unknown): Promise<SimpleResult> => seatFn({ data: input as Record<string, unknown> }).catch(failed)
