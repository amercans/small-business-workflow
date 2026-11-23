import { Link } from '@tanstack/react-router'
import { Avatar } from './Avatar'
import { LogoutButton } from './LogoutButton'
import { Icon } from './Icon'
import { navFor, type NavItem } from '#/data/nav'
import type { SessionUser } from '#/data/session'
import { BrandMark } from './BrandMark'
import { LanguageLinks, PasswordLink } from './AccountLinks'
import { runtimeConfig } from '#/config/runtime'
import { t } from '#/i18n'

const linkBase = 'kar-nav justify-center xl:justify-start'

function NavLink({ item, muted }: { item: NavItem; muted?: boolean }) {
  return (
    <Link
      to={item.to}
      title={item.label}
      aria-label={item.label}
      activeOptions={{ exact: item.to === '/', includeSearch: false }}
      className={`${linkBase} ${muted ? 'text-[0.875rem]' : ''}`}
      activeProps={{ 'aria-current': 'page' }}
    >
      <Icon name={item.icon} size={19} strokeWidth={1.7} />
      <span className="hidden xl:inline">{item.label}</span>
    </Link>
  )
}

export function Sidebar({ user }: { user: SessionUser }) {
  const nav = navFor(user)
  return (
    <aside className="kar kar-side sticky top-5.5 hidden h-[calc(100dvh-2.75rem)] flex-col rounded-[1.75rem] px-2.5 pt-5.5 pb-3.5 lg:flex xl:px-3.5">
      <Link to="/" aria-label={t('nav.home')} title={t('nav.home')} className="flex items-center gap-1.5 rounded-xl px-3 pt-1 pb-6.5 text-brand font-bold">
        <BrandMark size={28} className="-ml-[4.5px] shrink-0" />
        <span className="hidden xl:inline">{runtimeConfig().appName}</span>
      </Link>
      <nav aria-label={t('shell.mainMenu')} className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {nav.main.map((n) => (
          <NavLink key={n.key} item={n} />
        ))}
        {nav.manage.length > 0 && (
          <>
            <div className="nav-group flex items-center gap-2 px-3 pt-6.5 pb-2 text-group tracking-group text-faint">
              <span className="hidden xl:inline">{t('shell.manage')}</span>
            </div>
            {nav.manage.map((n) => (
              <NavLink key={n.key} item={n} muted />
            ))}
          </>
        )}
      </nav>
      <div className="kar-me mt-auto shrink-0 justify-center xl:justify-start">
        <Avatar name={user.name} hue={user.avatarHue} className="size-9" />
        <div className="hidden min-w-0 flex-1 xl:block">
          <b className="block truncate text-[0.875rem] font-semibold">{user.name}</b>
        </div>
      </div>
      <div className="mt-2 hidden shrink-0 flex-col gap-1.5 px-3 xl:flex">
        <PasswordLink />
        <LanguageLinks />
      </div>
      <LogoutButton full className="mt-2.5 shrink-0" />
    </aside>
  )
}
