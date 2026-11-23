import { describe, expect, it } from 'vitest'
import { earliestLeaveDate } from '#/lib/leave'
import * as req from './services/requests'
import { leaveInput, setup, TODAY } from './testkit'

describe('backdated sick leave', () => {
  it('earliest day: 30 days ago for sick leave, today for the rest', () => {
    expect(earliestLeaveDate('sick', TODAY)).toBe('2026-09-21')
    for (const k of ['annual', 'excuse', 'unpaid']) expect(earliestLeaveDate(k, TODAY)).toBe(TODAY)
  })

  it('sick leave accepts dates up to 30 days back and rejects older ones', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    expect((await req.submitLeave(c, leaveInput({ kind: 'sick', start: '2026-09-21', end: '2026-09-22' }))).ok).toBe(true)
    expect(await req.submitLeave(c, leaveInput({ kind: 'sick', start: '2026-09-18', end: '2026-09-18' }))).toMatchObject({ ok: false, error: expect.stringContaining('30 gün geriye') })
  })

  it('other leave types still reject past dates', async () => {
    const s = setup()
    const c = s.ctx('employeeA')
    for (const kind of ['annual', 'excuse', 'unpaid']) {
      expect(await req.submitLeave(c, leaveInput({ kind, reason: 'other', start: '2026-10-20', end: '2026-10-20' }))).toMatchObject({ ok: false, error: 'Geçmiş bir tarih seçilemez' })
    }
  })
})
