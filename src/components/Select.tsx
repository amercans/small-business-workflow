import type { SelectHTMLAttributes } from 'react'
import { Icon } from './Icon'

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...rest} className={`input appearance-none pr-9 ${className}`}>
        {children}
      </select>
      <Icon name="chev" size={14} strokeWidth={2} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 rotate-90 text-muted" />
    </span>
  )
}
