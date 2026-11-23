import { z } from 'zod'
import { t } from '#/i18n'
import { isValidISO } from './leave'
import { labels, lt, optText, reqText } from './schema'

export const DEFAULT_JOB_TYPE_KEYS = ['project', 'consulting', 'design', 'development', 'marketing', 'support', 'other'] as const
export type JobTypeKey = (typeof DEFAULT_JOB_TYPE_KEYS)[number]
export type JobKind = string

export interface JobType {
  id: string
  key: JobTypeKey | null
  label: string | null
  archived: boolean
}

export const jobTypeLabel = (type: JobType | null | undefined, fallbackId = ''): string => (type ? (type.key ? t(`jobs.types.${type.key}`) : (type.label ?? type.id)) : fallbackId)

export const jobTypeSchema = z.object({
  id: z.string().min(1).max(26).optional(),
  label: reqText(lt('settings.jobTypes.labelRequired'), 60).optional(),
  archived: z.boolean().default(false),
})
export type JobTypeInput = z.input<typeof jobTypeSchema>

export const JOB_STATUSES = ['done', 'active', 'not_started'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const JOB_STATUS_LABEL: Record<JobStatus, string> = labels(JOB_STATUSES, (k) => `jobs.statuses.${k}` as const)

export const FULL_SHARE_BP = 10_000

const optDay = (msg: () => string) => z.string().refine((v) => !v || isValidISO(v), { error: msg }).optional()

export const jobSchema = z
  .object({
    id: z.string().length(26).optional(),
    version: z.number().int().min(1).optional(),
    client: reqText(lt('schemas.job.clientRequired'), 120),
    title: reqText(lt('schemas.job.titleRequired'), 200),
    unit: optText(120),
    kind: z.string({ error: lt('schemas.job.kindRequired') }).trim().min(1, { error: lt('schemas.job.kindRequired') }).max(26),
    start: optDay(lt('schemas.job.startInvalid')),
    end: optDay(lt('schemas.job.endInvalid')),
    note: optText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.id && !v.version) ctx.addIssue({ code: 'custom', path: ['version'], message: t('schemas.common.invalidRecord') })
    if (v.start && v.end && v.end < v.start) ctx.addIssue({ code: 'custom', path: ['end'], message: t('schemas.job.endBeforeStart') })
  })
export type JobInput = z.input<typeof jobSchema>

export const jobMoneySchema = z.object({
  amount: z.number().min(0, { error: lt('schemas.common.amountNegative') }).max(10_000_000_000, { error: lt('schemas.common.amountTooLarge') }).nullable(),
  notBillable: z.boolean().default(false),
})
export type JobMoneyInput = z.input<typeof jobMoneySchema>

export const toShareBp = (percent: number) => Math.round(percent * 100)

export const jobPeriodSchema = z
  .object({ from: z.string().refine(isValidISO), to: z.string().refine(isValidISO) })
  .refine((v) => v.from <= v.to, { error: lt('schemas.job.periodOrder') })
  .refine((v) => Number(v.to.slice(0, 4)) - Number(v.from.slice(0, 4)) <= 10, { error: lt('schemas.job.periodMax') })

export function splitMinor(amountMinor: number, weights: (number | null)[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const w = weights.some((x) => x != null) ? weights.map((x) => x ?? 0) : weights.map(() => 1)
  const sum = w.reduce((t, x) => t + x, 0)
  if (sum <= 0) return weights.map(() => 0)
  const base = w.map((x) => Math.floor((amountMinor * x) / sum))
  const rest = w.map((x) => (amountMinor * x) % sum)
  let left = amountMinor - base.reduce((t, x) => t + x, 0)
  const order = rest.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i]++
  return base
}
