import { createServerFn } from '@tanstack/react-start'
import { clientError } from '#/lib/clientError'
import type { JobKind, JobMoneyInput, JobInput, JobStatus, JobType } from '#/lib/jobs'
import type { LinkedInvoice } from '#/data/invoices'
import type { FailResult } from '#/lib/useSubmit'
import { authed } from '#/server/fn'
import { archiveJob as archiveSvc, jobsSummary, listJobs, saveJob as saveSvc } from '#/server/services/jobs'

export interface Job {
  id: string
  client: string
  title: string
  unit: string | null
  kind: JobKind
  status: JobStatus
  start: string | null
  end: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  version: number
  invoices?: LinkedInvoice[]
  hasInvoice?: boolean
}

export interface PricedJob extends Job {
  amount: number | null
  notBillable: boolean
}

interface PageBase {
  period: { from: string; to: string }
  clients: string[]
  canWrite: boolean
  types: JobType[]
}

export type JobsPage = (PageBase & { money: false; jobs: Job[] }) | (PageBase & { money: true; jobs: PricedJob[] })

export const loadJobs = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { from?: string; to?: string } | undefined) => d ?? {})
  .handler(({ data, context }) => listJobs(context, data))

const saveFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => saveSvc(context, data))

export const saveJob = (input: { job: JobInput; money?: JobMoneyInput }): Promise<{ ok: true; id: string } | FailResult> =>
  saveFn({ data: input }).catch((e) => ({ ok: false as const, error: clientError(e) }))

const archiveFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: Record<string, unknown>) => d)
  .handler(({ data, context }) => archiveSvc(context, data))

export const archiveJob = (input: { id: string; version: number }): Promise<{ ok: true } | FailResult> =>
  archiveFn({ data: input }).catch((e) => ({ ok: false as const, error: clientError(e) }))

export interface JobsSummary {
  period: { from: string; to: string }
  jobs: number
  amount: number
  missing: number
  notBillable: number
  undated: number
  firms: { client: string; jobs: number; amount: number; missing: number; notBillable: number }[]
}

const summaryFn = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { from?: string; to?: string } | undefined) => d ?? {})
  .handler(({ data, context }) => jobsSummary(context, data))

export const loadJobsSummary = (input: { from?: string; to?: string }): Promise<JobsSummary> => summaryFn({ data: input })
