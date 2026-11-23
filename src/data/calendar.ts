import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authed } from '#/server/fn'
import * as svc from '#/server/services/calendar'

export type { TeamLeave } from '#/server/services/calendar'

export const loadTeamCalendar = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((d: { month: string }) => z.object({ month: z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/) }).parse(d))
  .handler(({ data, context }) => svc.teamLeaves(context, data.month))
