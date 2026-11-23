import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authed } from '#/server/fn'
import * as svc from '#/server/services/compliance'
import { clientError } from '#/lib/clientError'
import type { FailResult } from '#/lib/useSubmit'

export type { LeaveStatement } from '#/server/services/compliance'
type Simple = { ok: true } | FailResult
const failed = (e: unknown) => ({ ok: false as const, error: clientError(e) })

const acceptFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { version: string; docs: string[] }) => d)
  .handler(({ data, context }) => svc.acceptPolicies(context, data))
export const acceptPolicies = (version: string, docs: string[]): Promise<Simple> => acceptFn({ data: { version, docs } }).catch(failed)

const ackFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string }) => z.object({ id: z.string().length(26) }).parse(d))
  .handler(({ data, context }) => svc.acknowledgeAssignment(context, data.id))
export const acknowledgeAssignment = (id: string): Promise<Simple> => ackFn({ data: { id } }).catch(failed)

const disputeFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string; note?: string }) => z.object({ id: z.string().length(26), note: z.string().max(300).optional() }).parse(d))
  .handler(({ data, context }) => svc.disputeAssignment(context, data))
export const disputeAssignment = (id: string, note?: string): Promise<Simple> => disputeFn({ data: { id, note } }).catch(failed)

const confirmReturnFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { id: string }) => z.object({ id: z.string().length(26) }).parse(d))
  .handler(({ data, context }) => svc.confirmReturn(context, data.id))
export const confirmReturn = (id: string): Promise<Simple> => confirmReturnFn({ data: { id } }).catch(failed)

const yearIn = z.object({ year: z.number().int().min(2020).max(2100), userId: z.string().length(26).optional() })

export const loadMyRecords = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { year: number }) => yearIn.parse(d))
  .handler(async ({ data, context }) => ({ ...(await svc.myRecords(context)), statement: await svc.leaveStatement(context, data.year) }))

export const loadStatement = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { year: number; userId?: string }) => yearIn.parse(d))
  .handler(({ data, context }) => svc.leaveStatement(context, data.year, data.userId))

const confirmFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: { year: number }) => yearIn.parse(d))
  .handler(({ data, context }) => svc.confirmLeaveStatement(context, data.year))
export const confirmStatement = (year: number): Promise<Simple> => confirmFn({ data: { year } }).catch(failed)

export const loadMyPending = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => svc.myPending(context))

export const loadUndertakings = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(({ context }) => svc.undertakingPeople(context))

export const loadAllStatements = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { year: number }) => yearIn.parse(d))
  .handler(({ data, context }) => svc.allLeaveStatements(context, data.year))
