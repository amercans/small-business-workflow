import { Icon } from './Icon'
import { t } from '#/i18n'

export const LOGOUT_URL = '/logout'

export function LogoutButton({ full = false, className = '' }: { full?: boolean; className?: string }) {
  return (
    <form method="post" action={LOGOUT_URL} className={`${full ? 'w-full' : ''} ${className}`}>
      <button type="submit" className={`kar-logout ${full ? 'w-full justify-center' : ''}`}>
        <Icon name="logout" size={16} strokeWidth={1.9} />
        <span>{t('shell.signOut')}</span>
      </button>
    </form>
  )
}
