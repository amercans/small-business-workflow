import { useRouterState } from '@tanstack/react-router'
import { currentLocale, LOCALES, LOCALE_NAMES, t } from '#/i18n'

export function LanguageLinks({ className = '' }: { className?: string }) {
  const href = useRouterState({ select: (s) => s.location.href })
  const current = currentLocale()
  return (
    <nav aria-label={t('shell.language')} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-micro ${className}`}>
      {LOCALES.map((l) =>
        l === current ? (
          <span key={l} aria-current="true" lang={l} className="font-semibold text-ink">
            {LOCALE_NAMES[l]}
          </span>
        ) : (
          <form key={l} method="post" action="/lang" className="m-0 inline">
            <input type="hidden" name="to" value={l} />
            <input type="hidden" name="next" value={href} />
            <button type="submit" lang={l} className="cursor-pointer border-0 bg-transparent p-0 font-medium text-muted hover:text-ink">
              {LOCALE_NAMES[l]}
            </button>
          </form>
        ),
      )}
    </nav>
  )
}

export function PasswordLink({ className = '' }: { className?: string }) {
  return (
    <a href="/account/password" className={`text-micro font-medium text-muted no-underline hover:text-ink ${className}`}>
      {t('shell.changePassword')}
    </a>
  )
}
