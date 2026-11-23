import { intlLocale } from '#/i18n'
import type { CSSProperties } from 'react'

export function Avatar({ name, hue, className = 'size-7.5' }: { name: string; hue: number; className?: string }) {
  const initials = name.split(' ').map((s) => s[0]).join('').slice(0, 2).toLocaleUpperCase(intlLocale())
  return (
    <span
      aria-hidden="true"
      style={{ '--avatar-hue': hue } as CSSProperties}
      className={`kar-avatar avatar ${className} text-[0.75rem]`}
    >
      {initials}
    </span>
  )
}
