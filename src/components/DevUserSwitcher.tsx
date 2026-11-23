import { useRouter } from '@tanstack/react-router'
import type { DevUserOption } from '#/data/session'
import { t } from '#/i18n'

export const DEV_USER_SWITCHER_MARKER = 'DEV_USER_SWITCHER'

export default function DevUserSwitcher({ current, options }: { current: string; options: DevUserOption[] }) {
  const router = useRouter()
  return (
    <label
      data-marker={DEV_USER_SWITCHER_MARKER}
      className="fixed right-3 bottom-20 z-50 flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-micro text-on-dark shadow-sheet lg:bottom-3"
    >
      <span className="opacity-70">{t('shell.devLocal')}</span>
      <select
        aria-label={t('shell.devSwitcher')}
        value={current}
        onChange={(e) => {
          document.cookie = `dev_user=${encodeURIComponent(e.target.value)}; path=/; SameSite=Lax`
          if (options.find((o) => o.email === e.target.value)?.inactive) location.reload()
          else void router.invalidate()
        }}
        className="bg-transparent text-on-dark outline-none"
      >
        {options.map((o) => (
          <option key={o.email} value={o.email} className="text-ink">
            {o.label}
            {o.inactive ? ` (${t('shell.devInactive')})` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
