import { parseISO } from './leave'

const MS_DAY = 86_400_000

export function nights(a: string, b: string): number {
  const [from, to] = a <= b ? [a, b] : [b, a]
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / MS_DAY)
}
