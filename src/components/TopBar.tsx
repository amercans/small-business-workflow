import { Link } from '@tanstack/react-router'
import { Avatar } from './Avatar'
import { BrandMark } from './BrandMark'
import { LogoutButton } from './LogoutButton'
import type { SessionUser } from '#/data/session'
import { runtimeConfig } from '#/config/runtime'
import { t } from '#/i18n'

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header className="flex h-topbar items-center justify-between gap-3 lg:hidden">
      <Link to="/" aria-label={t('nav.home')} className="flex shrink-0 items-center gap-2 rounded-xl px-1.5 text-brand font-bold whitespace-nowrap">
        <BrandMark size={26} className="shrink-0" />
        <span className="hidden min-[430px]:inline">{runtimeConfig().appName}</span>
      </Link>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="kar-advance min-w-0 gap-2.5 py-1 pl-1 text-ui font-medium whitespace-nowrap text-ink">
          <Avatar name={user.name} hue={user.avatarHue} />
          <span className="truncate">{user.name}</span>
        </div>
        <LogoutButton />
      </div>
    </header>
  )
}
