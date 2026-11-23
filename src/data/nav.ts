import { t } from '#/i18n'
import { canAccess, roleLabel, type Actor, type Area } from '#/lib/permissions'

export type NavTo = '/' | '/requests' | '/my-records' | '/calendar' | '/all-requests' | '/invoices' | '/approvals' | '/overview' | '/reports' | '/agreements' | '/inventory' | '/jobs' | '/users' | '/settings'

export interface NavItem {
  key: string
  label: string
  short: string
  icon: 'home' | 'mine' | 'calendar' | 'team' | 'paper' | 'my-invoices' | 'approve' | 'overview' | 'reports' | 'agreements' | 'invoices' | 'inventory' | 'jobs' | 'users' | 'settings'
  to: NavTo
  area?: Area
  onlyRole?: 'employee' | 'management'
}

const main: Omit<NavItem, 'label' | 'short'>[] = [
  { key: 'home', icon: 'home', to: '/' },
  { key: 'mine', icon: 'mine', to: '/requests' },
  { key: 'records', icon: 'paper', to: '/my-records' },
  { key: 'calendar', icon: 'calendar', to: '/calendar' },
  { key: 'jobs-mine', icon: 'jobs', to: '/jobs', onlyRole: 'employee' },
  { key: 'approve', icon: 'approve', to: '/approvals', area: 'approvals' },
  { key: 'all', icon: 'team', to: '/all-requests', area: 'allRequests' },
]

const manage: Omit<NavItem, 'label' | 'short'>[] = [
  { key: 'overview', icon: 'overview', to: '/overview', area: 'overview' },
  { key: 'jobs', icon: 'jobs', to: '/jobs', area: 'jobs', onlyRole: 'management' },
  { key: 'reports', icon: 'reports', to: '/reports', area: 'reports' },
  { key: 'invoices', icon: 'invoices', to: '/invoices', area: 'invoices', onlyRole: 'management' },
  { key: 'inventory', icon: 'inventory', to: '/inventory', area: 'inventory' },
  { key: 'users', icon: 'users', to: '/users', area: 'users' },
  { key: 'settings', icon: 'settings', to: '/settings', area: 'settings' },
]

const LABELS = {
  home: () => t('nav.home'),
  mine: () => t('nav.mine'),
  records: () => t('nav.records'),
  calendar: () => t('nav.calendar'),
  jobs_mine: () => t('nav.jobs'),
  approve: () => t('nav.approve'),
  all: () => t('nav.all'),
  overview: () => t('nav.overview'),
  jobs: () => t('nav.jobs'),
  reports: () => t('nav.reports'),
  invoices: () => t('nav.invoices'),
  inventory: () => t('nav.inventory'),
  users: () => t('nav.users'),
  settings: () => t('nav.settings'),
}

const SHORT: Partial<Record<keyof typeof LABELS, () => string>> = {
  approve: () => t('nav.approveShort'),
  all: () => t('nav.allShort'),
}

const visible = (user: Actor) => (n: Omit<NavItem, 'label' | 'short'>) => {
  if (n.area && !canAccess(user, n.area)) return false
  if (n.onlyRole === 'employee' && user.role !== 'employee') return false
  if (n.onlyRole === 'management' && user.role === 'employee') return false
  return true
}

export function navFor(user: Actor): { main: NavItem[]; manage: NavItem[] } {
  const label = (n: Omit<NavItem, 'label' | 'short'>): NavItem => {
    const k = n.key.replace('-', '_') as keyof typeof LABELS
    return { ...n, label: LABELS[k](), short: SHORT[k]?.() ?? LABELS[k]() }
  }
  return { main: main.filter(visible(user)).map(label), manage: manage.filter(visible(user)).map(label) }
}

export { roleLabel }
