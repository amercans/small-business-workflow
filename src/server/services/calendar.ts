import { HALF_DAY } from '#/lib/leave'
import { must } from '../auth/authorize'
import type { Ctx } from '../ctx'
import { todayISO } from '../time'

export interface TeamLeave {
  userId: string
  name: string
  hue: number
  start: string
  end: string
  part: 'half' | 'hours' | null
}

const BACK_MONTHS = 1
const AHEAD_MONTHS = 12

const addMonths = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return d.toISOString().slice(0, 7)
}

export function calendarWindow(today: string = todayISO()): { min: string; max: string } {
  const cur = today.slice(0, 7)
  return { min: addMonths(cur, -BACK_MONTHS), max: addMonths(cur, AHEAD_MONTHS) }
}

const isHalf = (a: string, b: string) => Object.values(HALF_DAY).some(([x, y]) => x === a && y === b)

export async function teamLeaves(ctx: Ctx, month: string): Promise<{ month: string; min: string; max: string; leaves: TeamLeave[] }> {
  must(ctx.user, { a: 'calendar.read' })
  const win = calendarWindow(ctx.today ?? todayISO())
  if (month < win.min || month > win.max) return { month, ...win, leaves: [] }
  const rows = await ctx.db
    .prepare(
      `SELECT u.id AS user_id, u.display_name, u.avatar_hue, l.start_date, l.end_date, l.start_time, l.end_time
       FROM leave_requests l JOIN requests r ON r.id = l.request_id JOIN users u ON u.id = r.requester_id
       WHERE r.status = 'approved' AND u.status = 'active' AND l.start_date <= ? AND l.end_date >= ?
       ORDER BY l.start_date, u.display_name`,
    )
    .bind(`${month}-31`, `${month}-01`)
    .all<{ user_id: string; display_name: string; avatar_hue: number | null; start_date: string; end_date: string; start_time: string | null; end_time: string | null }>()
  return {
    month,
    ...win,
    leaves: rows.results.map((r) => ({
      userId: r.user_id,
      name: r.display_name,
      hue: r.avatar_hue ?? 220,
      start: r.start_date,
      end: r.end_date,
      part: r.start_time && r.end_time ? (isHalf(r.start_time, r.end_time) ? 'half' : 'hours') : null,
    })),
  }
}
