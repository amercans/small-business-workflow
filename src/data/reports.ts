import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authed } from '#/server/fn'
import { expenseReport, leaveReport, purchaseTravelReport } from '#/server/services/reports'

export type { ExpenseReport, LeaveReport, PurchaseTravelReport } from '#/server/services/reports'

const input = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })

export const loadLeaveReport = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { month: string }) => input.parse(d))
  .handler(({ data, context }) => leaveReport(context, data.month))

export const loadExpenseReport = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { month: string }) => input.parse(d))
  .handler(({ data, context }) => expenseReport(context, data.month))

export const loadPurchaseTravelReport = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { month: string }) => input.parse(d))
  .handler(({ data, context }) => purchaseTravelReport(context, data.month))
