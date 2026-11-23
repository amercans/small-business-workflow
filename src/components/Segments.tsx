import { t } from '#/i18n'
export function Segments({
  total,
  on,
  pending = 0,
  label,
  className = 'max-w-84',
}: {
  total: number
  on: number
  pending?: number
  label?: string
  className?: string
}) {
  return (
    <div className={`flex w-full gap-1 ${className}`} role="img" aria-label={label ?? t('ui.segments.left', { on, total })}>
      {Array.from({ length: total }, (_, i) => {
        const isOn = i < on
        const isPend = !isOn && i < on + pending
        return (
          <i
            key={i}
            style={isPend ? { transitionDelay: `${300 + (i - on) * 90}ms` } : undefined}
            className={`block h-1.5 max-w-5 min-w-0 flex-1 rounded-seg transition-[background-color,box-shadow] duration-300 ${
              isOn ? 'bg-on-dark' : isPend ? 'bg-seg-pend shadow-seg-pend' : 'bg-seg-off'
            }`}
          />
        )
      })}
    </div>
  )
}
