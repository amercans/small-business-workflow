import { describe, expect, it } from 'vitest'
import { advanceOffset, multiItemTitle, toBase, totalBase } from './expense'
import { nights } from './trip'

describe('toBase / totalBase', () => {
  it('keeps base-currency lines as they are, rounded to minor units', () => {
    expect(toBase({ amount: 2840, currency: 'TRY' })).toBe(2840)
    expect(toBase({ amount: 10.005, currency: 'TRY' })).toBe(10.01)
  })
  it('converts foreign lines with the rate and returns 0 without one', () => {
    expect(toBase({ amount: 100, currency: 'USD', rate: 34.2 })).toBe(3420)
    expect(toBase({ amount: 12.5, currency: 'EUR', rate: 37.45 })).toBe(468.13)
    expect(toBase({ amount: 100, currency: 'USD' })).toBe(0)
    expect(toBase({ amount: 100, currency: 'USD', rate: 0 })).toBe(0)
  })
  it('totals lines in mixed currencies', () => {
    expect(
      totalBase([
        { amount: 2840, currency: 'TRY' },
        { amount: 980, currency: 'TRY' },
        { amount: 430, currency: 'TRY' },
        { amount: 50, currency: 'USD', rate: 34 },
      ]),
    ).toBe(5950)
  })
})

describe('advanceOffset', () => {
  it('uses up the advance and pays the remainder when the total is higher', () => {
    expect(advanceOffset(4250, 3500)).toEqual({ offset: 3500, payable: 750, advanceLeft: 0 })
  })
  it('deducts the expense from the advance and shows what is left when the advance is higher', () => {
    expect(advanceOffset(1260, 3500)).toEqual({ offset: 1260, payable: 0, advanceLeft: 2240 })
  })
  it('pays everything when there is no advance', () => {
    expect(advanceOffset(980, 0)).toEqual({ offset: 0, payable: 980, advanceLeft: 0 })
  })
  it('handles an exact match', () => {
    expect(advanceOffset(3500, 3500)).toEqual({ offset: 3500, payable: 0, advanceLeft: 0 })
  })
})

describe('nights', () => {
  it('counts nights between two dates', () => {
    expect(nights('2026-11-02', '2026-11-05')).toBe(3)
    expect(nights('2026-11-02', '2026-11-02')).toBe(0)
    expect(nights('2026-11-05', '2026-11-02')).toBe(3)
  })
  it('handles month and year boundaries', () => {
    expect(nights('2026-10-30', '2026-11-02')).toBe(3)
    expect(nights('2026-12-30', '2027-01-02')).toBe(3)
  })
})

describe('multi-line expense title', () => {
  it('uses the first line plus the number of others and shortens long descriptions', () => {
    expect(multiItemTitle('Ekip yemeği', 2)).toBe('Ekip yemeği +1 kalem')
    expect(multiItemTitle(' Taksi ', 4)).toBe('Taksi +3 kalem')
    expect(multiItemTitle('x'.repeat(100), 2)).toBe(`${'x'.repeat(59)}… +1 kalem`)
  })
})

describe('expense summary estimate', () => {
  it('converts foreign lines with the entered rate, then the stored rate, and flags lines without any rate', async () => {
    const { estimateExpense } = await import('./expense')
    const { applyRuntimeConfig } = await import('#/config/runtime')
    applyRuntimeConfig({ baseCurrency: 'TRY' })
    const r = estimateExpense(
      [
        { amount: 100, currency: 'TRY' },
        { amount: 10, currency: 'USD', rate: 40 },
        { amount: 20, currency: 'USD' },
        { amount: 5, currency: 'EUR' },
      ],
      { USD: 50 },
    )
    expect(r.total).toBe(1500)
    expect(r.unconverted).toBe(true)
    expect(r.groups).toEqual([
      { currency: 'TRY', amount: 100, base: 100 },
      { currency: 'USD', amount: 30, base: 1400 },
      { currency: 'EUR', amount: 5, base: null },
    ])
  })
})
