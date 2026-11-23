import { z } from 'zod'
import { CURRENCIES, isBaseCurrency } from './money'
import { isoDay, labels, lt, money, optText } from './schema'
import { t } from '#/i18n'
import { HALF_DAY, isTimeSlot, isValidISO, leaveHours, WORKDAY_HOURS } from './leave'

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

export const ibanLabel = () => t('forms.ibanLabel')

export const formatIban = (s: string) => s.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()

export const EXPENSE_CATEGORIES = ['transport', 'meals', 'lodging', 'equipment_rental', 'supplies', 'other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
const CATEGORY_ID = { transport: 'transport', meals: 'meals', lodging: 'lodging', equipment_rental: 'equipmentRental', supplies: 'supplies', other: 'other' } as const satisfies Record<ExpenseCategory, string>
export const EXPENSE_CATEGORY_LABEL = labels(EXPENSE_CATEGORIES, (c) => `expense.categories.${CATEGORY_ID[c]}`)
export const expenseCategoryLabel = (c: string): string => ((EXPENSE_CATEGORIES as readonly string[]).includes(c) ? EXPENSE_CATEGORY_LABEL[c as ExpenseCategory] : c)

export const expenseItemSchema = z
  .object({
    date: isoDay(lt('expense.errors.date')),
    amount: money(),
    currency: z.enum(CURRENCIES),
    rate: z.number({ error: lt('expense.errors.rate') }).positive({ error: lt('expense.errors.rateRange') }).max(100_000, { error: lt('expense.errors.rateRange') }).optional(),
    category: z.enum(EXPENSE_CATEGORIES, { error: lt('expense.errors.category') }),
    description: z.string({ error: lt('expense.errors.description') }).trim().min(1, { error: lt('expense.errors.description') }).max(200, { error: lt('forms.maxChars', { max: 200 }) }),
    fileName: z.string({ error: lt('expense.errors.receipt') }).min(1, { error: lt('expense.errors.receipt') }).max(200),
    docNo: optText(60),
    vat: z.number().min(0, { error: lt('expense.errors.vatNegative') }).max(10_000_000_000, { error: lt('forms.amountTooLarge') }).optional(),
  })
  .superRefine((v, ctx) => {
    if (isBaseCurrency(v.currency) && v.rate != null && v.rate !== 1) ctx.addIssue({ code: 'custom', path: ['rate'], message: t('expense.errors.rateBase') })
    if (v.vat != null && v.vat >= v.amount) ctx.addIssue({ code: 'custom', path: ['vat'], message: t('expense.errors.vatTooLarge') })
  })

export const expenseSchema = z.object({
  items: z.array(expenseItemSchema).min(1, { error: lt('expense.errors.itemsMin') }).max(20, { error: lt('expense.errors.itemsMax') }),
  project: optText(120),
  note: optText(500),
})
export type ExpenseInput = z.input<typeof expenseSchema>

export const PAYMENT_METHODS = ['bank', 'cash'] as const
export const PAYMENT_METHOD_LABEL = labels(PAYMENT_METHODS, (m) => (m === 'bank' ? 'advance.payment.bank' : 'advance.payment.cash'))

export const advanceSchema = z.object({
  amount: money(),
  reason: z.string({ error: lt('advance.errors.reason') }).trim().min(1, { error: lt('advance.errors.reason') }).max(300, { error: lt('forms.maxChars', { max: 300 }) }),
})

export const closeAdvanceSchema = z.object({ note: optText(500) })
export type AdvanceInput = z.input<typeof advanceSchema>

export const PURCHASE_KINDS = ['equipment', 'software', 'other'] as const
export const LICENSE_PERIODS = ['monthly', 'yearly', 'one_time'] as const
export const PURCHASE_KIND_LABEL = labels(PURCHASE_KINDS, (k) => `purchase.kinds.${k}`)
export const LICENSE_PERIOD_LABEL = labels(LICENSE_PERIODS, (k) => (k === 'one_time' ? 'purchase.periods.oneTime' : `purchase.periods.${k}`))

const validUrl = (s: string) => {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export const purchaseSchema = z
  .object({
    kind: z.enum(PURCHASE_KINDS),
    name: z.string({ error: lt('purchase.errors.name') }).trim().min(1, { error: lt('purchase.errors.name') }).max(160, { error: lt('forms.maxChars', { max: 160 }) }),
    unitPrice: z.number().min(0, { error: lt('forms.amountNegative') }).max(10_000_000_000, { error: lt('forms.amountTooLarge') }).optional(),
    quantity: z.number({ error: lt('purchase.errors.quantity') }).int({ error: lt('purchase.errors.quantityInt') }).min(1, { error: lt('purchase.errors.quantityMin') }).max(999, { error: lt('purchase.errors.quantityMax') }),
    reason: z.string({ error: lt('purchase.errors.reason') }).trim().min(1, { error: lt('purchase.errors.reason') }).max(400, { error: lt('forms.maxChars', { max: 400 }) }),
    url: z
      .string()
      .trim()
      .max(500)
      .optional()
      .refine((v) => !v || validUrl(v), { error: lt('purchase.errors.url') }),
    period: z.enum(LICENSE_PERIODS).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'software' && !v.period) ctx.addIssue({ code: 'custom', path: ['period'], message: t('purchase.errors.period') })
  })
export type PurchaseInput = z.input<typeof purchaseSchema>

export const TRANSPORTS = ['plane', 'bus', 'car', 'train', 'other'] as const
export const LODGINGS = ['none', 'hotel'] as const
export const TRANSPORT_LABEL = labels(TRANSPORTS, (k) => `travel.transports.${k}`)
export const LODGING_LABEL = labels(LODGINGS, (k) => `travel.lodging.${k}`)

export const travelSchema = z
  .object({
    place: z.string({ error: lt('travel.errors.place') }).trim().min(1, { error: lt('travel.errors.place') }).max(120, { error: lt('forms.maxChars', { max: 120 }) }),
    start: isoDay(lt('travel.errors.dates')),
    end: isoDay(lt('travel.errors.dates')),
    purpose: z.string({ error: lt('travel.errors.purpose') }).trim().min(1, { error: lt('travel.errors.purpose') }).max(300, { error: lt('forms.maxChars', { max: 300 }) }),
    project: optText(120),
    budget: money(lt('travel.errors.budget')).optional(),
    wantAdvance: z.boolean(),
    advanceAmount: money(lt('travel.errors.advance')).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.end < v.start) ctx.addIssue({ code: 'custom', path: ['start'], message: t('forms.endBeforeStart') })
    if (v.wantAdvance && !v.advanceAmount) ctx.addIssue({ code: 'custom', path: ['advanceAmount'], message: t('travel.errors.advance') })
  })
export type TravelInput = z.input<typeof travelSchema>

export const leaveKinds = ['annual', 'excuse', 'sick', 'unpaid'] as const
export type LeaveKind = (typeof leaveKinds)[number]
export const LEAVE_KIND_TEXT = labels(leaveKinds, (k) => `leave.kinds.${k}`)
export const EXCUSE_REASONS = ['marriage', 'paternity', 'bereavement', 'other'] as const
export type ExcuseReason = (typeof EXCUSE_REASONS)[number]
export const EXCUSE_REASON_LABEL = labels(EXCUSE_REASONS, (r) => `leave.excuses.${r}`)
const EXCUSE_DAYS: Partial<Record<ExcuseReason, number>> = { marriage: 3, paternity: 5, bereavement: 3 }
export function excuseLegal(reason: ExcuseReason): { days: number; note: string } | undefined {
  const days = EXCUSE_DAYS[reason]
  if (days === undefined) return undefined
  return { days, note: t(`leave.excuseNotes.${reason as 'marriage' | 'paternity' | 'bereavement'}`) }
}
export function leaveName(kind: LeaveKind, reason?: ExcuseReason): string {
  if (kind === 'excuse') return reason && reason !== 'other' ? t(`leave.names.excuseWith.${reason}`) : t('leave.names.excuse')
  return t(`leave.names.${kind}`)
}
export const LEAVE_SPANS = ['full_day', 'half_day', 'hours'] as const
export type LeaveSpan = (typeof LEAVE_SPANS)[number]
export const LEAVE_SPAN_LABEL = labels(LEAVE_SPANS, (s) => (s === 'full_day' ? 'leave.spans.full' : s === 'half_day' ? 'leave.spans.half' : 'leave.spans.hourly'))
export const HALF_DAYS = Object.keys(HALF_DAY) as (keyof typeof HALF_DAY)[]

export const leaveRequestSchema = z
  .object({
    kind: z.enum(leaveKinds),
    reason: z.enum(EXCUSE_REASONS).optional(),
    span: z.enum(LEAVE_SPANS).default('full_day'),
    start: z.string().refine(isValidISO, { error: lt('forms.invalidDate') }),
    end: z.string().refine(isValidISO, { error: lt('forms.invalidDate') }),
    half: z.enum(HALF_DAYS).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    substituteId: z.string().regex(ULID, { error: lt('leave.errors.substitute') }).optional(),
    note: z.string({ error: lt('leave.errors.note') }).trim().min(1, { error: lt('leave.errors.note') }).max(500, { error: lt('leave.errors.noteMax') }),
    attachmentName: z.string().max(200).optional(),
  })
  .refine((v) => v.end >= v.start, { error: lt('forms.endBeforeStart'), path: ['end'] })
  .refine((v) => Date.parse(v.end) - Date.parse(v.start) <= 366 * 86_400_000, { error: lt('leave.errors.maxYear'), path: ['end'] })
  .superRefine((v, ctx) => {
    if (v.kind === 'excuse' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: t('leave.errors.reason') })
    if (v.span === 'full_day') return
    if (v.end !== v.start) ctx.addIssue({ code: 'custom', path: ['end'], message: t('leave.errors.singleDay') })
    if (v.span === 'half_day' && !v.half) ctx.addIssue({ code: 'custom', path: ['half'], message: t('leave.errors.half') })
    if (v.span === 'hours') {
      if (!v.startTime || !isTimeSlot(v.startTime)) ctx.addIssue({ code: 'custom', path: ['startTime'], message: t('leave.errors.startTime') })
      else if (!v.endTime || !isTimeSlot(v.endTime)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: t('leave.errors.endTime') })
      else {
        const h = leaveHours(v.startTime, v.endTime)
        if (h <= 0) ctx.addIssue({ code: 'custom', path: ['endTime'], message: t('leave.errors.endAfterStart') })
        else if (h >= WORKDAY_HOURS) ctx.addIssue({ code: 'custom', path: ['endTime'], message: t('leave.errors.useFullDay', { hours: WORKDAY_HOURS }) })
      }
    }
  })

export type LeaveRequestInput = z.input<typeof leaveRequestSchema> & { file?: File }
