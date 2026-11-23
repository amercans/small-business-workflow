import { useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Icon } from './Icon'
import { navFor } from '#/data/nav'
import type { SessionUser } from '#/data/session'
import { LanguageLinks, PasswordLink } from './AccountLinks'
import { t } from '#/i18n'

export function TabBar({ user }: { user: SessionUser }) {
  const nav = navFor(user)
  const PRIMARY = ['home', 'mine', 'approve']
  const tabs = nav.main.filter((n) => PRIMARY.includes(n.key))
  const more_ = [...nav.main.filter((n) => !PRIMARY.includes(n.key)), ...nav.manage]
  const [more, setMore] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const ref = useRef<HTMLElement>(null)
  const manageActive = more_.some((m) => pathname.startsWith(m.to))

  useEffect(() => setMore(false), [pathname])
  useEffect(() => {
    if (!more) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false)
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMore(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [more])

  return (
    <nav
      ref={ref}
      aria-label={t('shell.mainMenu')}
      className="kar fixed inset-x-3.5 bottom-[calc(0.875rem+env(safe-area-inset-bottom))] z-10 rounded-3xl p-2 lg:hidden"
    >
      {more && (
        <ul id="more-menu" className="kar absolute right-0 bottom-[calc(100%+0.625rem)] m-0 flex min-w-52 list-none flex-col gap-1 rounded-3xl p-2">
          {more_.map((m) => (
            <li key={m.key}>
              <Link
                to={m.to}
                className="kar-nav"
                activeProps={{ 'aria-current': 'page' }}
              >
                <Icon name={m.icon} size={18} strokeWidth={1.7} />
                {m.label}
              </Link>
            </li>
          ))}
          <li className="flex flex-col gap-1.5 border-t border-hairline px-3 pt-2.5 pb-1.5">
            <PasswordLink />
            <LanguageLinks />
          </li>
        </ul>
      )}
      <ul className="m-0 flex list-none gap-1.5 p-0">
        {tabs.map((n) => (
          <li key={n.key} className="flex-1">
            <Link
              to={n.to}
              activeOptions={{ exact: n.to === '/', includeSearch: false }}
              className="kar-tab"
              activeProps={{ 'aria-current': 'page' }}
            >
              <Icon name={n.icon} size={21} strokeWidth={1.7} />
              {n.short}
            </Link>
          </li>
        ))}
        {(
          <li className="flex-1">
            <button
              type="button"
              aria-expanded={more}
              aria-controls="more-menu"
              onClick={() => setMore((v) => !v)}
              data-on={manageActive ? '' : undefined}
              className="kar-tab w-full"
            >
              <Icon name="more" size={21} strokeWidth={3.2} />
              {t('shell.more')}
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}
