import { t, tn } from '#/i18n'
import { isHot } from '#/lib/agreements'

export function DaysBadge({ left }: { left: number | null }) {
  const text = left === null ? t('ui.daysBadge.open') : left < 0 ? t('ui.daysBadge.ended') : tn('ui.daysBadge.left', left)
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-micro font-semibold whitespace-nowrap ${isHot(left) ? 'bg-pill-hot-bg text-pill-hot' : 'bg-wash text-ink'}`}>
      {text}
    </span>
  )
}
