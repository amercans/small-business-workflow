import { useLayoutEffect, useRef, useState } from 'react'
import { spr } from '#/lib/motion'
import type { MyRequest } from '#/data/home'

export function useFlipRows<T extends HTMLElement>(requests: MyRequest[], view = '') {
  const ref = useRef<T>(null)
  const prev = useRef<Map<string, number> | null>(null)
  const prevView = useRef(view)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  useLayoutEffect(() => {
    const ul = ref.current
    if (!ul) { prev.current = null; prevView.current = view; return }
    const rows = [...ul.children] as HTMLElement[]
    const next = new Map(rows.map((r) => [r.dataset.id as string, r.getBoundingClientRect().top + window.scrollY]))
    const before = prev.current
    prev.current = next
    const sameView = prevView.current === view
    prevView.current = view
    if (!before || !sameView) return
    const fresh: HTMLElement[] = []
    for (const row of rows) {
      const id = row.dataset.id as string
      const was = before.get(id)
      if (was === undefined) {
        fresh.push(row)
        continue
      }
      const dy = was - (next.get(id) as number)
      if (dy) spr(row, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], 640, 'spring', { fill: 'none' })
    }
    if (fresh.length) {
      fresh.forEach((row, i) =>
        spr(row, [{ opacity: 0, transform: 'translateY(-24px) scale(.97)' }, { opacity: 1, transform: 'none' }], 640, 'spring', { delay: 120 + i * 90 }),
      )
      setHighlightId(fresh[0].dataset.id as string)
      const t = setTimeout(() => setHighlightId(null), 1800)
      return () => clearTimeout(t)
    }
  }, [requests, view])
  return { ref, highlightId }
}
