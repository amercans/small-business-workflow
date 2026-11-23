import { z } from 'zod'
import { t } from '#/i18n'
import { isVatRateShape } from './vat'
import { CURRENCIES, isBaseCurrency, type Currency } from './money'
import { isoDay, labels, lt, money, optText, reqText } from './schema'
import { isValidISO } from './leave'

export const invoiceItemSchema = z.object({
  name: reqText(lt('schemas.invoice.itemNameRequired'), 300),
  qty: z.number({ error: lt('schemas.invoice.qtyRequired') }).int({ error: lt('schemas.invoice.qtyInt') }).min(1, { error: lt('schemas.invoice.qtyMin') }).max(999, { error: lt('schemas.invoice.qtyMax') }),
  serial: optText(100),
})

const fxRateField = z.number({ error: lt('schemas.invoice.fxNumber') }).min(0.000001, { error: lt('schemas.invoice.fxRange') }).max(100_000, { error: lt('schemas.invoice.fxRange') }).optional()

export const invoiceSchema = z
  .object({
    direction: z.enum(['in', 'out']),
    fileName: z.string({ error: lt('schemas.invoice.fileRequired') }).min(1, { error: lt('schemas.invoice.fileRequired') }).max(200),
    firm: reqText(lt('schemas.invoice.firmRequired'), 200),
    no: reqText(lt('schemas.invoice.noRequired'), 60),
    date: isoDay(lt('schemas.invoice.dateRequired')),
    currency: z.enum(CURRENCIES).optional(),
    fxRate: fxRateField,
    net: money(lt('schemas.invoice.netRequired')),
    vatRate: z.number({ error: lt('schemas.invoice.vatRequired') }).refine(isVatRateShape, { error: lt('schemas.invoice.vatRequired') }),
    due: z.string().refine((v) => !v || isValidISO(v), { error: lt('schemas.invoice.dueInvalid') }).optional(),
    toInventory: z.boolean(),
    costKind: z.enum(['direct', 'overhead']).optional(),
    items: z.array(invoiceItemSchema).max(50),
    links: z.array(z.object({ kind: z.enum(['asset', 'digital', 'job']), id: z.string().length(26) })).max(30).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.direction === 'out' && !v.due) ctx.addIssue({ code: 'custom', path: ['due'], message: t('schemas.invoice.dueRequired') })
    if (v.direction === 'out' && v.due && v.due < v.date) ctx.addIssue({ code: 'custom', path: ['due'], message: t('schemas.invoice.dueBeforeDate') })
    if (v.direction === 'in' && !v.costKind) ctx.addIssue({ code: 'custom', path: ['costKind'], message: t('schemas.invoice.costKindRequired') })
    if (v.direction === 'in' && v.toInventory && v.items.length === 0) ctx.addIssue({ code: 'custom', path: ['items'], message: t('schemas.invoice.itemsRequired') })
    v.items.forEach((it, i) => {
      if (it.serial && it.qty > 1) ctx.addIssue({ code: 'custom', path: ['items', i, 'serial'], message: t('schemas.invoice.serialSingle') })
    })
  })

export const invoiceEditSchema = z.object({
  id: z.string().length(26),
  version: z.number().int().min(1),
  firm: reqText(lt('schemas.invoice.firmRequired'), 200),
  no: reqText(lt('schemas.invoice.noRequired'), 60),
  date: isoDay(lt('schemas.invoice.dateRequired')),
  currency: z.enum(CURRENCIES),
  fxRate: fxRateField,
  net: money(lt('schemas.invoice.netRequired')),
  vatRate: z.number({ error: lt('schemas.invoice.vatRequired') }).refine(isVatRateShape, { error: lt('schemas.invoice.vatRequired') }),
  due: z.string().refine((v) => !v || isValidISO(v), { error: lt('schemas.invoice.dueInvalid') }).optional(),
  costKind: z.enum(['direct', 'overhead']).optional(),
})

export type AgreementPeriod = 'yearly' | 'monthly' | 'one_time'
export const PERIOD_LABEL: Record<AgreementPeriod, string> = labels(['yearly', 'monthly', 'one_time'] as const, (k) => `schemas.agreementPeriod.${k}` as const)

export const agreementSchema = z
  .object({
    counterparty: reqText(lt('schemas.agreement.counterpartyRequired'), 200),
    title: reqText(lt('schemas.agreement.titleRequired'), 200),
    start: isoDay(lt('schemas.agreement.startRequired')),
    end: isoDay(lt('schemas.agreement.endRequired')),
    amount: money(),
    period: z.enum(['yearly', 'monthly', 'one_time']),
    tag: optText(60),
    note: optText(2000),
    pdfName: z
      .string({ error: lt('schemas.agreement.pdfRequired') })
      .min(1, { error: lt('schemas.agreement.pdfRequired') })
      .regex(/\.pdf$/i, { error: lt('schemas.agreement.pdfOnly') }),
  })
  .refine((v) => v.end >= v.start, { error: lt('schemas.common.endBeforeStart'), path: ['end'] })

export type AssetCondition = 'active' | 'in_repair' | 'retired'
export type AssetStatus = 'stock' | 'assigned' | 'repair' | 'retired'
export const STATUS_LABEL: Record<AssetStatus, string> = labels(['stock', 'assigned', 'repair', 'retired'] as const, (k) => `schemas.assetStatus.${k}` as const)

export const assetSchema = z
  .object({
    name: reqText(lt('schemas.asset.nameRequired'), 200),
    serial: optText(100),
    acquiredOn: isoDay(lt('schemas.asset.acquiredRequired')),
    note: optText(1000),
    category: optText(60),
    quantity: z.number().int({ error: lt('schemas.common.integer') }).min(1, { error: lt('schemas.common.min', { min: 1 }) }).max(9999, { error: lt('schemas.common.max', { max: 9999 }) }).default(1),
    source: optText(120),
  })
  .superRefine((v, ctx) => {
    if (v.serial && v.quantity > 1) ctx.addIssue({ code: 'custom', path: ['quantity'], message: t('schemas.asset.serialSingle') })
  })

export const assetEditSchema = z
  .object({
    id: z.string().length(26),
    name: reqText(lt('schemas.asset.nameRequired'), 200),
    serial: optText(100),
    acquiredOn: z.string().refine((v) => !v || isValidISO(v), { error: lt('schemas.common.dateInvalid') }).optional(),
    note: optText(1000),
    category: optText(60),
    quantity: z.number().int({ error: lt('schemas.common.integer') }).min(1, { error: lt('schemas.common.min', { min: 1 }) }).max(9999, { error: lt('schemas.common.max', { max: 9999 }) }).default(1),
    source: optText(120),
    condition: z.enum(['active', 'in_repair', 'retired']),
  })
  .superRefine((v, ctx) => {
    if (v.serial && v.quantity > 1) ctx.addIssue({ code: 'custom', path: ['quantity'], message: t('schemas.asset.serialSingle') })
  })

export const seatSchema = z.object({ assetId: z.string().length(26), userId: z.string().length(26), on: z.boolean() })

export const assignSchema = z
  .object({
    assetId: z.string().min(1),
    userId: z.string().optional(),
    other: optText(200),
    date: isoDay(lt('schemas.asset.handoverRequired')),
    note: optText(500),
  })
  .superRefine((v, ctx) => {
    if (!v.userId && !v.other) ctx.addIssue({ code: 'custom', path: ['userId'], message: t('schemas.asset.personRequired') })
  })

const ROLES = ['employee', 'manager', 'approver', 'owner'] as const

export const userSchema = z
  .object({
    id: z.string().optional(),
    displayName: reqText(lt('schemas.user.nameRequired'), 60),
    department: optText(80),
    email: z.string().trim().max(200).default(''),
    canLogin: z.boolean().default(true),
    role: z.enum(ROLES, { error: lt('schemas.user.roleRequired') }),
    isAdmin: z.boolean(),
    canUploadInvoices: z.boolean(),
    canManageJobs: z.boolean().default(false),
    approveUnverified: z.boolean().optional(),
    leaveEntitlement: z.number({ error: lt('schemas.user.leaveRequired') }).int({ error: lt('schemas.user.leaveInt') }).min(0, { error: lt('schemas.user.leaveMin') }).max(60, { error: lt('schemas.user.leaveMax') }),
    status: z.enum(['active', 'inactive']),
  })
  .superRefine((v, ctx) => {
    if (v.canLogin && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: t('schemas.user.emailRequired') })
  })

const amountTL = (msg: () => string) => z.number({ error: msg }).min(0, { error: lt('schemas.common.amountNegative') }).max(1_000_000_000, { error: lt('schemas.common.amountTooLarge') })
export const FIXED_KINDS = ['personnel', 'office', 'software', 'equipment', 'professional', 'other'] as const
export type FixedKind = (typeof FIXED_KINDS)[number]
const optAmount = z.number().min(0, { error: lt('schemas.common.amountNegative') }).max(1_000_000_000, { error: lt('schemas.common.amountTooLarge') }).default(0)
const intIn = (min: number, max: number, msg: () => string) => z.number({ error: msg }).int({ error: lt('schemas.common.integer') }).min(min, { error: msg }).max(max, { error: msg })
export const fixedCostSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: lt('schemas.fixed.monthRequired') }),
  personnel: amountTL(lt('schemas.fixed.personnelRequired')),
  office: amountTL(lt('schemas.fixed.officeRequired')),
  software: optAmount,
  equipment: optAmount,
  professional: optAmount,
  other: optAmount,
  people: intIn(1, 500, lt('schemas.fixed.peopleRange')).nullable(),
  hours: intIn(1, 744, lt('schemas.fixed.hoursRange')),
  utilization: intIn(1, 100, lt('schemas.fixed.utilizationRange')),
  margin: intIn(0, 90, lt('schemas.fixed.marginRange')),
})

export const DIGITAL_KINDS = ['software', 'domain', 'stock', 'account'] as const
export type DigitalKind = (typeof DIGITAL_KINDS)[number]
export const DIGITAL_KIND_LABEL: Record<DigitalKind, string> = labels(DIGITAL_KINDS, (k) => `digital.kinds.${k}` as const)
export const DIGITAL_PERIODS = ['monthly', 'yearly', 'one_time', 'free'] as const
export type DigitalPeriod = (typeof DIGITAL_PERIODS)[number]
export const DIGITAL_PERIOD_LABEL: Record<DigitalPeriod, string> = labels(DIGITAL_PERIODS, (k) => `digital.periods.${k}` as const)

export const CURRENCIES_DIGITAL = CURRENCIES
export type DigitalCurrency = Currency

export const digitalSchema = z
  .object({
    id: z.string().length(26).optional(),
    kind: z.enum(DIGITAL_KINDS, { error: lt('schemas.digital.kindRequired') }),
    name: reqText(lt('schemas.digital.nameRequired'), 200),
    vendor: optText(120),
    plan: optText(120),
    seats: z.number().int({ error: lt('schemas.common.integer') }).min(1, { error: lt('schemas.common.min', { min: 1 }) }).max(1000, { error: lt('schemas.common.max', { max: 1000 }) }).nullable().optional(),
    purpose: optText(200),
    accountEmail: optText(200),
    ownerId: z.string().length(26).nullable().optional(),
    renewsOn: z.string().refine((v) => !v || isValidISO(v), { error: lt('schemas.common.dateInvalid') }).optional(),
    period: z.enum(DIGITAL_PERIODS),
    cost: z.number().min(0, { error: lt('schemas.common.amountNegative') }).max(1_000_000_000, { error: lt('schemas.common.amountTooLarge') }).nullable().optional(),
    currency: z.enum(CURRENCIES_DIGITAL),
    verified: z.boolean().default(false),
    source: optText(120),
    lastPaidOn: z.string().refine((v) => !v || isValidISO(v), { error: lt('schemas.common.dateInvalid') }).optional(),
    lastPaid: z.number().min(0, { error: lt('schemas.common.amountNegative') }).max(1_000_000_000, { error: lt('schemas.common.amountTooLarge') }).nullable().optional(),
    paidBy: optText(120),
    userIds: z.array(z.string().length(26)).max(200),
    status: z.enum(['active', 'cancelled']).default('active'),
    note: optText(1000),
  })

export type FxRates = Record<Currency, number | null>

export const settleSchema = z.object({
  id: z.string().length(26),
  settledOn: isoDay(lt('schemas.common.dateRequired')).nullable(),
})

export const fxSchema = z.object({
  rates: z.object({ TRY: z.number().positive({ error: lt('schemas.fx.positive') }).max(100_000, { error: lt('schemas.fx.tooLarge') }).nullable().optional(), USD: z.number().positive({ error: lt('schemas.fx.positive') }).max(100_000, { error: lt('schemas.fx.tooLarge') }).nullable().optional(), EUR: z.number().positive({ error: lt('schemas.fx.positive') }).max(100_000, { error: lt('schemas.fx.tooLarge') }).nullable().optional() }),
  vatRates: z.array(z.number().refine(isVatRateShape, { error: lt('schemas.fx.vatInvalid') })).min(1, { error: lt('schemas.fx.vatInvalid') }).max(12, { error: lt('schemas.fx.vatInvalid') }).optional(),
})

export function monthlyBase(period: DigitalPeriod, cost: number | null, currency: DigitalCurrency, fx: FxRates): number | null {
  const m = monthlyCost(period, cost)
  if (m === 0 || isBaseCurrency(currency)) return m
  const rate = fx[currency]
  return rate ? m * rate : null
}

export const monthlyCost = (period: DigitalPeriod, cost: number | null): number =>
  cost == null ? 0 : period === 'monthly' ? cost : period === 'yearly' ? cost / 12 : 0
