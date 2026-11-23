import { tn } from '#/i18n'
import { isBaseCurrency, round2, type Currency } from './money'

export interface ExpenseLine {
  amount: number
  currency: Currency
  rate?: number
}

export function toBase({ amount, currency, rate }: ExpenseLine): number {
  if (isBaseCurrency(currency)) return round2(amount)
  if (!rate || rate <= 0) return 0
  return round2(amount * rate)
}

export const totalBase = (lines: ExpenseLine[]): number => round2(lines.reduce((s, l) => s + toBase(l), 0))

export interface CurrencyGroup {
  currency: Currency
  amount: number
  base: number | null
}

export function estimateExpense(lines: ExpenseLine[], known: Partial<Record<Currency, number | null>> = {}): { total: number; groups: CurrencyGroup[]; unconverted: boolean } {
  const groups = new Map<Currency, CurrencyGroup>()
  let total = 0
  let unconverted = false
  for (const l of lines) {
    if (!l.amount) continue
    const rate = isBaseCurrency(l.currency) ? 1 : l.rate && l.rate > 0 ? l.rate : known[l.currency] && known[l.currency]! > 0 ? known[l.currency]! : null
    const base = rate === null ? null : round2(l.amount * rate)
    if (base === null) unconverted = true
    else total += base
    const g = groups.get(l.currency) ?? { currency: l.currency, amount: 0, base: 0 }
    g.amount = round2(g.amount + l.amount)
    g.base = g.base === null || base === null ? null : round2(g.base + base)
    groups.set(l.currency, g)
  }
  return { total: round2(total), groups: [...groups.values()], unconverted }
}

export interface AdvanceOffset {
  offset: number
  payable: number
  advanceLeft: number
}

export function advanceOffset(total: number, advanceOpen: number): AdvanceOffset {
  const open = Math.max(advanceOpen, 0)
  const offset = Math.min(total, open)
  return { offset: round2(offset), payable: round2(Math.max(total - open, 0)), advanceLeft: round2(Math.max(open - total, 0)) }
}

export function multiItemTitle(first: string, count: number, max = 60): string {
  const f = first.trim()
  const t = f.length > max ? `${f.slice(0, max - 1)}…` : f
  return count > 1 ? `${t} ${tn('expense.moreItems', count - 1)}` : t
}
