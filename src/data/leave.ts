import { createServerFn } from '@tanstack/react-start'
import type { MyRequest } from './home'
import { toFormData } from '#/lib/formData'
import type { LeaveRequestInput } from '#/lib/requestSchemas'
import { authed, readForm } from '#/server/fn'
import { submitLeave } from '#/server/services/requests'

export { leaveKinds, leaveRequestSchema, type LeaveKind, type LeaveRequestInput } from '#/lib/requestSchemas'

export type SubmitLeaveResult = { ok: true; request: MyRequest; days: number } | { ok: false; error: string }

const submitLeaveFn = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((d: FormData) => readForm(d))
  .handler(({ data, context }) => submitLeave(context, data))

export const submitLeaveRequest = (input: LeaveRequestInput): Promise<SubmitLeaveResult> => submitLeaveFn({ data: toFormData(input) })
