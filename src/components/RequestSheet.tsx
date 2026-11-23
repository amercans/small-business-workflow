import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from './Icon'
import { spr } from '#/lib/motion'
import { useMediaQuery } from '#/lib/useMediaQuery'
import { t } from '#/i18n'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function RequestSheet({
  open,
  onClose,
  returnFocusKey,
  children,
}: {
  open: boolean
  onClose: () => void
  returnFocusKey: string
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  const scrimRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const isDesktop = useMediaQuery('(min-width: 64rem)', true)

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !mounted || !scrimRef.current || !dialogRef.current) return
    spr(scrimRef.current, [{ opacity: 0 }, { opacity: 1 }], 320, 'settle')
    spr(
      dialogRef.current,
      isDesktop
        ? [{ opacity: 0, transform: 'translateY(6%) scale(.96)' }, { opacity: 1, transform: 'none' }]
        : [{ transform: 'translateY(100%)' }, { transform: 'none' }],
      620,
      'spring',
    )
    const dlg = dialogRef.current
    const first = dlg.querySelector<HTMLElement>('[data-autofocus]') ?? (isDesktop ? dlg.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea') : null)
    ;(first ?? dlg).focus()
  }, [open, mounted, isDesktop])

  useEffect(() => {
    if (open || !mounted || !scrimRef.current || !dialogRef.current) return
    const a = spr(scrimRef.current, [{ opacity: 1 }, { opacity: 0 }], 280, 'settle')
    const b = spr(
      dialogRef.current,
      isDesktop
        ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4%) scale(.97)' }]
        : [{ transform: 'none' }, { transform: 'translateY(100%)' }],
      360,
      'settle',
    )
    let cancelled = false
    Promise.all([a.finished, b.finished])
      .then(() => {
        if (cancelled) return
        setMounted(false)
        document.querySelector<HTMLElement>(`[data-k="${returnFocusKey}"]`)?.focus()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, mounted, isDesktop, returnFocusKey])

  useEffect(() => {
    if (!mounted) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mounted])

  if (!mounted) return null

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
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

  return (
    <div className="fixed inset-0 z-30" onKeyDown={onKeyDown}>
      <div ref={scrimRef} aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-scrim backdrop-blur-scrim" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        className="sheet-flow outline-none absolute inset-x-0 bottom-0 top-[max(var(--height-sheet-gap),env(safe-area-inset-top))] flex flex-col overflow-y-auto overscroll-contain rounded-t-sheet bg-surface px-5 shadow-sheet lg:inset-auto lg:top-1/2 lg:left-1/2 lg:max-h-[calc(100dvh-2rem)] lg:w-[min(var(--width-sheet),calc(100%-2rem))] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:grid lg:grid-cols-[1fr_var(--width-sheet-side)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden lg:rounded-sheet lg:px-0"
      >
        <div aria-hidden="true" className="order-0 mx-auto mt-2.5 mb-1 h-1.25 w-10 shrink-0 rounded-full bg-wash lg:hidden" />
        {children}
      </div>
    </div>
  )
}

export function SheetLayout({
  title,
  subtitle,
  summary,
  aside,
  onSubmit,
  onCancel,
  busy,
  disabled,
  submitLabel = t('forms.submit'),
  hideSubmit,
  cancelLabel = t('forms.cancel'),
  footer,
  children,
}: {
  title: string
  subtitle?: string
  submitLabel?: string
  hideSubmit?: boolean
  cancelLabel?: string
  footer?: ReactNode
  summary: ReactNode
  aside: ReactNode
  onSubmit: () => void
  onCancel: () => void
  busy?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="contents"
    >
      <div className="contents lg:block lg:overflow-y-auto lg:px-8.5 lg:py-7.5">
        <div className="order-1 mb-4 flex items-center justify-between pt-3 lg:order-none lg:mb-0 lg:pt-0">
          <div>
            <h3 id="sheet-title" className="text-sheet-title font-semibold">
              {title}
            </h3>
            {subtitle && <p className="mt-1 text-link text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('forms.close')}
            className="grid size-8.5 shrink-0 place-items-center rounded-full bg-wash text-muted"
          >
            <Icon name="x" size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="order-3 flex flex-col lg:order-none">{children}</div>
      </div>

      <div className="contents lg:flex lg:flex-col lg:gap-4 lg:overflow-y-auto lg:border-l lg:border-hairline lg:bg-panel lg:px-7 lg:py-7.5">
        <div className="order-2 lg:order-none">{summary}</div>
        <div className="order-8 mt-5.5 lg:order-none lg:mt-0">{aside}</div>
        {footer && <div className="order-9 mt-4 lg:order-none lg:mt-auto">{footer}</div>}
        <div className={`sticky bottom-0 order-9 -mx-5 mt-4 flex gap-2 border-t border-hairline bg-surface px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:order-none lg:static lg:mx-0 ${footer ? 'lg:mt-4' : 'lg:mt-auto'} lg:flex-col lg:border-0 lg:bg-transparent lg:p-0`}>
          {!hideSubmit && (
            <button type="submit" disabled={busy || disabled} className="btn btn-pri h-12 flex-1 max-lg:order-2 lg:w-full lg:flex-none">
              {submitLabel}
            </button>
          )}
          <button type="button" onClick={onCancel} className={`btn btn-sec h-12 px-5 max-lg:order-1 lg:w-full ${hideSubmit ? 'max-lg:flex-1' : ''}`}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </form>
  )
}

export function SheetAside({ onay, warning, extra }: { onay?: string; warning?: string; extra?: ReactNode }) {
  return (
    <>
      {onay && (
        <p className="text-small leading-normal text-muted">
          <b className="font-medium text-ink">{t('forms.whatHappens')}</b> {onay}
        </p>
      )}
      {extra}
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-small text-status-rejected">
        {warning}
      </p>
    </>
  )
}
