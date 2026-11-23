import { t } from '#/i18n'
import type { ReactNode } from 'react'

export function Field({
  id,
  label,
  optional,
  error,
  hint,
  className = '',
  children,
}: {
  id: string
  label: string
  optional?: boolean
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2.5 block text-micro font-semibold text-muted">
        {label} {optional && <span className="font-normal">{t('forms.optional')}</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-micro text-faint">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1.5 text-micro text-status-rejected">
          {error}
        </p>
      )}
    </div>
  )
}

export const fieldA11y = (id: string, error?: string, hint?: string) => ({
  id,
  'aria-invalid': error ? (true as const) : undefined,
  'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
})
