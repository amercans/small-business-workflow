import { describe, expect, it } from 'vitest'
import { partialMap } from '#/lib/leave'
import * as req from './services/requests'
import { leaveInput, setup } from './testkit'

describe('leave calendar markers', () => {
  it('returns pending full-day leave as pending with a waiting label', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect((await req.submitLeave(c, leaveInput({ start: '2026-11-02', end: '2026-11-03' }))).ok).toBe(true)
    const home = await req.homeData(c, [])
    expect(home.leave.approvedRanges).toEqual([{ from: '2026-11-02', to: '2026-11-03', pending: true }])
    expect(home.leave.approvedLabel).toContain('bekliyor')
  })

  it('returns pending half-day and hourly leave in partialDays', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect((await req.submitLeave(c, leaveInput({ span: 'half_day', half: 'morning', start: '2026-11-04', end: '2026-11-04' }))).ok).toBe(true)
    expect((await req.submitLeave(c, leaveInput({ span: 'hours', startTime: '14:00', endTime: '16:00', start: '2026-11-05', end: '2026-11-05' }))).ok).toBe(true)
    const home = await req.homeData(c, [])
    expect(home.leave.partialDays).toEqual([
      { date: '2026-11-04', from: '09:00', to: '13:00', pending: true },
      { date: '2026-11-05', from: '14:00', to: '16:00', pending: true },
    ])
    expect(home.leave.approvedRanges).toEqual([])
    expect(partialMap(home.leave.partialDays).get('2026-11-05')).toBe('14:00–16:00, onay bekliyor')
  })
})
