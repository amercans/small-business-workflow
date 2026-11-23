import { describe, expect, it } from 'vitest'
import { addMonths, countWorkdays, formatLeaveDays, formatRange, hoursToDays, isWorkday, leaveHours, monthCells, partialHours, returnDate, TIME_SLOTS, type LeaveCtx } from './leave'
import { halfHolidayDates, holidayDates } from '#/data/holidays'

const ctx: LeaveCtx = {
  holidays: holidayDates,
  halfDays: halfHolidayDates,
  approved: [{ from: '2026-10-20', to: '2026-10-24' }],
}

describe('countWorkdays', () => {
  it('counts a weekday as 1 and a weekend day as 0', () => {
    expect(countWorkdays('2026-10-27', '2026-10-27', ctx)).toBe(1)
    expect(countWorkdays('2026-10-31', '2026-10-31', ctx)).toBe(0)
    expect(countWorkdays('2026-11-01', '2026-11-01', ctx)).toBe(0)
  })

  it('skips weekends across a week', () => {
    expect(countWorkdays('2026-11-02', '2026-11-09', ctx)).toBe(6)
  })

  it('skips a public holiday and counts its eve as half a day', () => {
    expect(countWorkdays('2026-10-27', '2026-10-30', ctx)).toBe(2.5)
    expect(countWorkdays('2026-10-29', '2026-10-29', ctx)).toBe(0)
  })

  it('counts a holiday eve as a half day of leave', () => {
    expect(isWorkday('2026-10-28', ctx)).toBe(true)
    expect(countWorkdays('2026-10-28', '2026-10-28', ctx)).toBe(0.5)
    expect(countWorkdays('2026-10-28', '2026-10-28', { ...ctx, halfDays: undefined })).toBe(1)
    expect(partialHours('2026-10-28', '09:00', '13:00', ctx)).toBe(4)
    expect(partialHours('2026-10-28', '11:00', '16:00', ctx)).toBe(2)
    expect(partialHours('2026-10-28', '14:00', '18:00', ctx)).toBe(0)
    expect(partialHours('2026-10-27', '14:00', '18:00', ctx)).toBe(4)
  })

  it('excludes days already covered by approved leave', () => {
    expect(countWorkdays('2026-10-19', '2026-10-27', ctx)).toBe(3)
    expect(countWorkdays('2026-10-20', '2026-10-24', ctx)).toBe(0)
  })

  it('crosses a month boundary', () => {
    expect(countWorkdays('2026-10-30', '2026-11-03', ctx)).toBe(3)
  })

  it('crosses a year boundary and skips New Year\'s Day', () => {
    expect(countWorkdays('2025-12-31', '2026-01-02', ctx)).toBe(2)
  })

  it('gives the same result for a reversed selection', () => {
    expect(countWorkdays('2026-10-30', '2026-10-27', ctx)).toBe(countWorkdays('2026-10-27', '2026-10-30', ctx))
  })

  it('skips a multi-day holiday and counts its eve as half a day', () => {
    expect(countWorkdays('2026-05-26', '2026-06-01', ctx)).toBe(1.5)
  })
})

describe('calendar helpers', () => {
  it('places the first day of a month on the right weekday', () => {
    const cells = monthCells({ y: 2026, m: 10 })
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(cells.filter(Boolean)).toHaveLength(31)
  })

  it('addMonths rolls over the year', () => {
    expect(addMonths({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 })
    expect(addMonths({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 })
  })

  it('formatRange', () => {
    expect(formatRange('2026-10-27', '2026-10-30')).toBe('27 Eki–30 Eki')
    expect(formatRange('2026-10-30', '2026-10-27')).toBe('27 Eki–30 Eki')
    expect(formatRange('2026-10-27', '2026-10-27')).toBe('27 Eki')
  })
})

describe('hourly and half-day leave', () => {
  it('counts exactly the entered range', () => {
    expect(leaveHours('09:00', '13:00')).toBe(4)
    expect(leaveHours('14:00', '18:00')).toBe(4)
    expect(leaveHours('12:00', '15:00')).toBe(3)
    expect(leaveHours('13:30', '14:00')).toBe(0.5)
    expect(leaveHours('15:00', '14:00')).toBe(0)
  })
  it('day and hour formatting', () => {
    expect(formatLeaveDays(3)).toBe('3 gün')
    expect(formatLeaveDays(0.5)).toBe('4 saat')
    expect(formatLeaveDays(hoursToDays(3.5))).toBe('3,5 saat')
    expect(formatLeaveDays(12 + hoursToDays(3))).toBe('12 gün 3 saat')
    expect(formatLeaveDays(-0.5)).toBe('−4 saat')
  })
  it('return-to-work date skips weekends and holidays', () => {
    const ctx = { holidays: new Set(['2026-10-29']), approved: [] }
    expect(returnDate('2026-10-30', ctx)).toBe('2026-11-02')
    expect(returnDate('2026-10-28', ctx)).toBe('2026-10-30')
    expect(returnDate('2026-10-28', ctx, '13:00')).toBe('2026-10-28')
    expect(returnDate('2026-10-28', ctx, '18:00')).toBe('2026-10-30')
  })
  it('time options are in half-hour steps', () => {
    expect(TIME_SLOTS[0]).toBe('09:00')
    expect(TIME_SLOTS.at(-1)).toBe('18:00')
    expect(TIME_SLOTS).toHaveLength(19)
  })
})

describe('holidays of the following year', () => {
  it('holiday week: eve counts half, three holiday days are excluded', () => {
    expect(countWorkdays('2027-03-08', '2027-03-12', ctx)).toBe(1.5)
  })
  it('overlapping holidays count once', () => {
    expect(countWorkdays('2027-05-17', '2027-05-21', ctx)).toBe(2)
  })
})

describe('holiday calendars', () => {
  it('country switch: unknown country has no holidays and covers every year', async () => {
    const { applyRuntimeConfig } = await import('#/config/runtime')
    const { HOLIDAY_YEARS } = await import('#/data/holidays')
    applyRuntimeConfig({ holidayCountry: 'NONE' })
    try {
      expect(holidayDates.has('2026-10-29')).toBe(false)
      expect(HOLIDAY_YEARS.has(2031)).toBe(true)
    } finally {
      applyRuntimeConfig({ holidayCountry: 'TR' })
    }
    expect(holidayDates.has('2026-10-29')).toBe(true)
    expect(HOLIDAY_YEARS.has(2031)).toBe(false)
  })
  it('holiday names follow the locale', async () => {
    const { holidayByDate } = await import('#/data/holidays')
    const { setFallbackLocale } = await import('#/i18n')
    expect(holidayByDate.get('2026-10-29')?.name).toBe('Cumhuriyet Bayramı')
    setFallbackLocale('en')
    try {
      expect(holidayByDate.get('2026-10-29')?.name).toBe('Republic Day')
      expect(formatLeaveDays(1)).toBe('1 day')
      expect(formatLeaveDays(12 + hoursToDays(3.5))).toBe('12 days 3.5 hours')
    } finally {
      setFallbackLocale('tr')
    }
  })
})
