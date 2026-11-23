import { useLayoutEffect, useRef, type RefObject } from 'react'
import { spr } from './motion'

export function useFlip(ref: RefObject<HTMLElement | null>, dep: unknown) {
  const prev = useRef<Map<string, number> | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rows = [...el.querySelectorAll<HTMLElement>(':scope > [data-id]')]
    const next = new Map(rows.map((r) => [r.dataset.id as string, r.getBoundingClientRect().top + window.scrollY]))
    const before = prev.current
    prev.current = next
    if (!before) return
    for (const row of rows) {
      const was = before.get(row.dataset.id as string)
      if (was === undefined) continue
      const dy = was - (next.get(row.dataset.id as string) as number)
      if (dy) spr(row, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], 620, 'spring', { fill: 'none' })
    }
  }, [dep, ref])
}
