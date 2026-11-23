import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  autoFocusFirst,
  invalid,
  className = '',
}: {
  label: string
  options: readonly { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  autoFocusFirst?: boolean
  invalid?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<'' | 'r' | 'l' | 'lr'>('')
  const check = () => {
    const el = ref.current
    if (!el) return
    const l = el.scrollLeft > 2
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setFade(l && r ? 'lr' : l ? 'l' : r ? 'r' : '')
  }
  useEffect(() => {
    check()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [options.length])
  useEffect(() => {
    const el = ref.current
    const b = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!el || !b) return
    if (b.offsetLeft < el.scrollLeft) el.scrollLeft = b.offsetLeft - 8
    else if (b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = b.offsetLeft + b.offsetWidth - el.clientWidth + 8
  }, [value])
  const mask = fade === 'r' ? 'linear-gradient(to right, #000 calc(100% - 2.5rem), transparent)' : fade === 'l' ? 'linear-gradient(to left, #000 calc(100% - 2.5rem), transparent)' : fade === 'lr' ? 'linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent)' : undefined
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onScroll={check}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={`inline-flex max-w-full self-start overflow-x-auto rounded-full bg-wash p-0.75 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          data-autofocus={autoFocusFirst && i === 0 ? '' : undefined}
          aria-pressed={value === o.value}
          aria-invalid={invalid && i === 0 ? true : undefined}
          onClick={() => onChange(o.value)}
          className={`min-h-9 shrink-0 rounded-full px-3 py-1.75 text-link font-medium sm:min-h-0 sm:px-4 whitespace-nowrap transition-[background-color,color] duration-200 ${
            value === o.value ? 'bg-surface text-ink shadow-seg-on' : 'text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
