import { lazy, Suspense, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'
import { PolicyGate } from './legal/PolicyGate'
import { AssetGate } from './legal/AssetGate'
import type { Session } from '#/data/session'

const UserSwitcher = import.meta.env.DEV ? lazy(() => import('./DevUserSwitcher')) : null

export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[var(--width-rail)_1fr] lg:gap-5.5 lg:p-5.5 lg:pr-6.5 xl:grid-cols-[var(--width-side)_1fr]">
      <div className="kar-world" aria-hidden="true">
        <i className="b1" />
        <i className="b2" />
        <i className="b3" />
        <i className="b4" />
      </div>
      <Sidebar user={session.user} />
      <div className="min-w-0 px-3.5 pb-[calc(var(--height-tabbar)+2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-0 lg:pb-0">
        <div className="mx-auto w-full max-w-page">
          <TopBar user={session.user} />
          <main className="relative pt-1 lg:pt-2.5">
            {session.pendingPolicies.length > 0 ? (
              <PolicyGate pending={session.pendingPolicies} name={session.user.name} />
            ) : session.pendingAssets.length > 0 ? (
              <AssetGate items={session.pendingAssets} name={session.user.name} />
            ) : (
              children
            )}
          </main>
        </div>
      </div>
      <TabBar user={session.user} />
      {UserSwitcher && session.devUsers && (
        <Suspense fallback={null}>
          <UserSwitcher current={session.devCurrent ?? ''} options={session.devUsers} />
        </Suspense>
      )}
    </div>
  )
}
