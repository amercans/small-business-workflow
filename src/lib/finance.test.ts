import { describe, expect, it } from 'vitest'
import { barPercents, breakdownTotal, clampIndex, closingPhrase, headline, hourlyRate, net, pnl, position } from './finance'
import { agreementState, daysLeft, isHot } from './agreements'
import { formatMillions, formatSignedRounded, formatMoneyRounded } from './money'

describe('result and headline', () => {
  it('computes result as income minus expenses', () => {
    const months: Record<string, { income: number; expense: number }> = {
      '2026-10': { income: 1_520_000, expense: 1_334_000 },
      '2026-09': { income: 1_760_000, expense: 1_448_000 },
      '2026-01': { income: 980_000, expense: 1_240_000 },
      '2025-11': { income: 1_180_000, expense: 1_210_000 },
    }
    const by = (key: string) => months[key]
    expect(net(by('2026-10'))).toBe(186_000)
    expect(net(by('2026-09'))).toBe(312_000)
    expect(net(by('2026-01'))).toBe(-260_000)
    expect(net(by('2025-11'))).toBe(-30_000)
  })
  it('uses present tense for the current month, past tense for earlier months, and handles losses and break-even', () => {
    expect(headline(10, 186_000, true)).toBe("Ekim'de artıdayız.")
    expect(headline(9, 312_000, false)).toBe("Eylül'de artıdaydık.")
    expect(headline(10, -50_000, true)).toBe("Ekim'de eksideyiz.")
    expect(headline(1, -260_000, false)).toBe("Ocak'ta eksideydik.")
    expect(headline(3, 0, false)).toBe("Mart'ta başabaştık.")
    expect(position(0)).toBe('even')
  })
  it('closing phrase', () => {
    expect(closingPhrase(9, formatSignedRounded(312_000))).toBe('Eylül +312.000 ₺ ile kapandı')
    expect(closingPhrase(1, formatSignedRounded(-260_000))).toBe('Ocak −260.000 ₺ ile kapandı')
  })
})

describe('expense breakdown', () => {
  const b = {
    personnel: 760_000, office: 128_000, software: 38_000, equipment: 24_000, professional: 20_000, otherFixed: 0,
    invoicesDirect: 190_800, invoicesOverhead: 127_200, employeeExpenses: 46_000,
  }
  it('breakdown adds up to total expenses', () => {
    expect(breakdownTotal(b)).toBe(1_334_000)
  })
  it('P&L shows net income after direct costs and profit as income minus total expenses', () => {
    const p = pnl(1_520_000, b)
    expect(p.direct).toBe(236_800)
    expect(p.netRevenue).toBe(1_283_200)
    expect(p.overhead).toBe(337_200)
    expect(p.profit).toBe(1_520_000 - breakdownTotal(b))
    expect(p.margin).toBeCloseTo(186_000 / 1_283_200)
    expect(pnl(0, b).margin).toBeNull()
  })
  it('hourly cost and suggested rate', () => {
    const r = hourlyRate(b, { people: 8, hours: 160, utilization: 65, margin: 25 })!
    expect(r.billableHours).toBeCloseTo(832)
    expect(r.cost).toBeCloseTo(1_097_200 / 832)
    expect(r.rate).toBeCloseTo(1_097_200 / 832 / 0.75)
    expect(hourlyRate(b, { people: 8, hours: 160, utilization: 65, margin: 100 })).toBeNull()
  })
  it('bar percentages are relative to the largest value', () => {
    expect(barPercents([760, 318, 128, 82, 46])).toEqual([100, 42, 17, 11, 6])
  })
  it('clampIndex', () => {
    expect(clampIndex(-1, 12)).toBe(0)
    expect(clampIndex(12, 12)).toBe(11)
  })
})

describe('formatting', () => {
  it('rounded, signed and million amounts', () => {
    expect(formatMoneyRounded(1_520_000)).toBe('1.520.000 ₺')
    expect(formatSignedRounded(186_000)).toBe('+186.000 ₺')
    expect(formatSignedRounded(-30_000)).toBe('−30.000 ₺')
    expect(formatMoneyRounded(-0.3)).toBe('0 ₺')
    expect(formatSignedRounded(-0.4)).toBe('0 ₺')
    expect(formatMoneyRounded(-1234)).toBe('−1.234 ₺')
    expect(formatMillions(1_520_000)).toBe('1,52M')
  })
})

describe('agreement duration', () => {
  const today = '2026-10-13'
  it('days remaining', () => {
    expect(daysLeft('2026-10-31', today)).toBe(18)
    expect(daysLeft('2026-11-15', today)).toBe(33)
    expect(daysLeft('2026-11-30', today)).toBe(48)
    expect(daysLeft(null, today)).toBeNull()
  })
  it('status and the red badge threshold (30 days or less)', () => {
    expect(agreementState('2026-10-31', today)).toBe('expiring')
    expect(agreementState('2027-04-30', today)).toBe('active')
    expect(agreementState('2026-08-31', today)).toBe('ended')
    expect(agreementState(null, today)).toBe('active')
    expect(isHot(18)).toBe(true)
    expect(isHot(30)).toBe(true)
    expect(isHot(31)).toBe(false)
    expect(isHot(-3)).toBe(false)
  })
})

describe('english copy', () => {
  it('headline and closing phrase follow the locale', async () => {
    const { setFallbackLocale } = await import('#/i18n')
    setFallbackLocale('en')
    try {
      expect(headline(10, 186_000, true)).toBe("We're ahead in October.")
      expect(headline(1, -260_000, false)).toBe('We were behind in January.')
      expect(closingPhrase(9, '+312,000')).toBe('September closed at +312,000')
    } finally {
      setFallbackLocale('tr')
    }
  })
})
