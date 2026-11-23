import { t } from '#/i18n'
import { useRef, useState } from 'react'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
const FILE_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'heic']
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic'

export function validateFile(f: { name: string; size: number }, pdfOnly = false): string {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  if (pdfOnly && ext !== 'pdf') return t('ui.file.pdfOnly')
  if (!FILE_EXT.includes(ext)) return t('ui.file.types')
  if (f.size > MAX_FILE_BYTES) return t('ui.file.tooLarge', { mb: MAX_FILE_BYTES / 1024 / 1024 })
  return ''
}

export function FileField({
  file,
  onChange,
  error,
  capture,
  emptyText,
  id,
  invalid,
  pdfOnly,
}: {
  file: File | null
  onChange: (f: File | null) => void
  error?: string
  capture?: boolean
  emptyText?: string
  id?: string
  invalid?: boolean
  pdfOnly?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState('')
  const shown = localError || error
  const placeholder = emptyText ?? (pdfOnly ? t('ui.file.placeholderPdf', { mb: MAX_FILE_BYTES / 1024 / 1024 }) : t('ui.file.placeholder', { mb: MAX_FILE_BYTES / 1024 / 1024 }))

  function pick(f: File | undefined) {
    if (!f) return
    const msg = validateFile(f, pdfOnly)
    setLocalError(msg)
    onChange(msg ? null : f)
    if (msg && input.current) input.current.value = ''
  }

  return (
    <div>
      <div className="input flex items-center justify-between gap-3 !py-2.5" data-invalid={invalid || !!shown || undefined}>
        <span className={`min-w-0 truncate text-link ${file ? 'text-ink' : 'text-faint'}`}>{file ? file.name : placeholder}</span>
        <span className="flex shrink-0 gap-2">
          {file && (
            <button
              type="button"
              onClick={() => {
                onChange(null)
                setLocalError('')
                if (input.current) input.current.value = ''
              }}
              className="rounded-full bg-wash px-3 py-1.5 text-micro font-medium text-muted"
            >
              {t('ui.file.remove')}
            </button>
          )}
          <button
            type="button"
            id={id}
            aria-invalid={invalid || !!shown || undefined}
            aria-describedby={shown ? `${id}-err` : undefined}
            onClick={() => input.current?.click()}
            className="btn-tint rounded-full px-3 py-1.5 text-micro"
          >
            {file ? t('ui.file.change') : capture ? t('ui.file.capture') : t('ui.file.choose')}
          </button>
        </span>
        <input
          ref={input}
          type="file"
          hidden
          accept={pdfOnly ? '.pdf,application/pdf' : ACCEPT}
          {...(capture ? { capture: 'environment' as const } : {})}
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      {shown && (
        <p id={id ? `${id}-err` : undefined} role="alert" className="mt-1.5 text-micro text-status-rejected">
          {shown}
        </p>
      )}
    </div>
  )
}
