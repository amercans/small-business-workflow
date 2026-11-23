import { t } from '#/i18n'
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { spr } from '#/lib/motion'

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = t('forms.cancel'),
  onConfirm,
  onCancel,
  busy,
  danger,
  children,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  danger?: boolean
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const cancelBtn = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    if (scrim.current) spr(scrim.current, [{ opacity: 0 }, { opacity: 1 }], 240, 'settle')
    if (ref.current) spr(ref.current, [{ opacity: 0, transform: 'translateY(8px) scale(.97)' }, { opacity: 1, transform: 'none' }], 420, 'spring')
    const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? cancelBtn.current
    target?.focus()
  }, [open])

  if (!open) return null

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Tab') {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, select') ?? [])]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center px-5" onKeyDown={onKeyDown}>
      <div ref={scrim} aria-hidden="true" onClick={onCancel} className="absolute inset-0 bg-scrim backdrop-blur-scrim" />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="relative w-full max-w-md rounded-sheet bg-surface p-6 shadow-sheet"
      >
        <h2 id="confirm-title" className="text-sheet-title font-semibold">
          {title}
        </h2>
        <p id="confirm-body" className="mt-2 text-label text-muted">
          {body}
        </p>
        {children}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelBtn} type="button" onClick={onCancel} className="btn btn-sec">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`btn ${danger ? 'btn-danger' : 'btn-pri'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
