const BY_COUNTRY: Record<string, readonly number[]> = { TR: [0, 1, 10, 20] }
const GENERIC: readonly number[] = [0, 5, 10, 20]

export const MAX_VAT_RATES = 12

export const defaultVatRates = (country: string | null | undefined): number[] => [...(BY_COUNTRY[(country ?? '').toUpperCase()] ?? GENERIC)]

export const isVatRateShape = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 100 && Math.round(v * 100) === v * 100

export function normalizeVatRates(list: readonly number[]): number[] {
  return [...new Set(list.filter(isVatRateShape).map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b).slice(0, MAX_VAT_RATES)
}

export function parseVatList(input: string): number[] | null {
  const parts = input.split(/[\s,;]+/).map((p) => p.replace(/%/g, '')).filter(Boolean)
  const nums = parts.map(Number)
  if (nums.length === 0 || nums.some((n) => !isVatRateShape(n))) return null
  return normalizeVatRates(nums)
}
