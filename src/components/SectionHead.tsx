import type { ReactNode } from 'react'

export function SectionHead({ title, action }: { title: string; action: ReactNode }) {
  return (
    <h2 className="flex items-baseline justify-between gap-4 text-label font-semibold text-muted">
      <span>{title}</span>
      {action}
    </h2>
  )
}

export const headLinkClass =
  '-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink'
