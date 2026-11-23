import { describe, expect, it } from 'vitest'
import { cleanMoneyInput, formatAmount, formatMoney, formatOnBlur, parseMoney } from './money'

describe('parseMoney', () => {
  it('reads Turkish number format', () => {
    expect(parseMoney('1.234,56')).toBe(1234.56)
    expect(parseMoney('4.250,00')).toBe(4250)
    expect(parseMoney('980')).toBe(980)
    expect(parseMoney('980,5')).toBe(980.5)
  })
  it('cleans pasted text (symbols, units, US format)', () => {
    expect(parseMoney('₺ 1.234,56')).toBe(1234.56)
    expect(parseMoney('1234.56 TL')).toBe(1234.56)
    expect(parseMoney('1,234.56')).toBe(1234.56)
    expect(parseMoney('$12.50')).toBe(12.5)
  })
  it('treats a dot as thousands separator only for groups of three', () => {
    expect(parseMoney('1.234')).toBe(1234)
    expect(parseMoney('12.34')).toBe(12.34)
    expect(parseMoney('1.234.567')).toBe(1234567)
  })
  it('returns null for invalid input', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('₺')).toBeNull()
  })
})

describe('formatting', () => {
  it('formatAmount / formatMoney', () => {
    expect(formatAmount(1234.5)).toBe('1.234,50')
    expect(formatMoney(3500)).toBe('3.500,00 ₺')
    expect(formatMoney(12.5, 'USD')).toBe('12,50 $')
  })
  it('formatOnBlur formats valid input and leaves the rest untouched', () => {
    expect(formatOnBlur('1234,5')).toBe('1.234,50')
    expect(formatOnBlur('abc')).toBe('abc')
  })
  it('cleanMoneyInput keeps only digits, dots and commas', () => {
    expect(cleanMoneyInput('₺ 1.2a3,4 TL')).toBe('1.23,4')
  })
})

describe('locale', () => {
  it('English puts the symbol first and uses dot decimals', async () => {
    const { setFallbackLocale } = await import('#/i18n')
    setFallbackLocale('en')
    try {
      expect(formatMoney(3500)).toBe('₺3,500.00')
      expect(formatMoney(12.5, 'USD')).toBe('$12.50')
      expect(formatAmount(1234.5)).toBe('1,234.50')
    } finally {
      setFallbackLocale('tr')
    }
  })
})
