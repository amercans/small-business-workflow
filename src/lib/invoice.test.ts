import { describe, expect, it } from 'vitest'
import { grossTotal, isOverdue, normalizeFirm, receivablesOf, vatAmount } from './invoice'

describe('VAT', () => {
  it('computes VAT and totals for each rate', () => {
    expect(vatAmount(180_650, 20)).toBe(36_130)
    expect(grossTotal(180_650, 20)).toBe(216_780)
    expect(vatAmount(100, 10)).toBe(10)
    expect(vatAmount(100, 1)).toBe(1)
    expect(grossTotal(100, 0)).toBe(100)
  })
  it('rounds to minor units', () => {
    expect(vatAmount(12_416.67, 20)).toBe(2_483.33)
    expect(grossTotal(12_416.67, 20)).toBe(14_900)
  })
})

describe('receivables', () => {
  const today = '2026-10-13'
  const list = [
    { direction: 'out' as const, net: 252_000, date: '2026-09-05', due: '2026-10-05', settledOn: null },
    { direction: 'out' as const, net: 210_000, date: '2026-09-20', due: '2026-10-20', settledOn: null },
    { direction: 'out' as const, net: 150_000, date: '2026-10-05', due: '2026-11-04', settledOn: null },
    { direction: 'out' as const, net: 80_000, date: '2026-09-28', due: '2026-10-28', settledOn: '2026-10-08' },
    { direction: 'in' as const, net: 999_999, date: '2026-09-02', due: null, settledOn: null },
  ]
  it('dashboard figures: total, count, oldest age and overdue count', () => {
    expect(receivablesOf(list, today)).toEqual({ amount: 612_000, count: 3, oldestDays: 38, overdue: 1 })
  })
  it('ignores settled and incoming invoices', () => {
    expect(receivablesOf([list[3], list[4]], today)).toEqual({ amount: 0, count: 0, oldestDays: 0, overdue: 0 })
  })
  it('due date check', () => {
    expect(isOverdue('2026-10-05', null, today)).toBe(true)
    expect(isOverdue('2026-10-05', '2026-10-06', today)).toBe(false)
    expect(isOverdue(null, null, today)).toBe(false)
    expect(isOverdue(today, null, today)).toBe(false)
  })
})

describe('company name normalization', () => {
  it('handles Turkish dotted and dotless i and whitespace', () => {
    expect(normalizeFirm('  ISPARTA   Ltd. ')).toBe('ısparta ltd.')
    expect(normalizeFirm('İstanbul A.Ş.')).toBe('istanbul a.ş.')
  })
})

describe('books start', () => {
  it('is disabled when empty and compares dates when set', async () => {
    const { applyRuntimeConfig } = await import('#/config/runtime')
    const { isBeforeBooks } = await import('./invoice')
    applyRuntimeConfig({ booksStart: '' })
    expect(isBeforeBooks('2000-01-01')).toBe(false)
    applyRuntimeConfig({ booksStart: '2026-04-01' })
    try {
      expect(isBeforeBooks('2026-03-31')).toBe(true)
      expect(isBeforeBooks('2026-04-01')).toBe(false)
    } finally {
      applyRuntimeConfig({ booksStart: '' })
    }
  })
})
