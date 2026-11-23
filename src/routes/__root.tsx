import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'
import { AppShell } from '#/components/AppShell'
import { loadSession } from '#/data/session'
import { ErrorView, NotFoundView } from '#/components/ErrorView'
import { DEFAULT_APP_NAME } from '#/config/brand'
import { applyRuntimeConfig } from '#/config/runtime'
import { setClientLocale } from '#/i18n'

export const Route = createRootRoute({
  head: ({ match }) => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: match.context.session?.config.appName ?? DEFAULT_APP_NAME,
      },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  beforeLoad: async () => {
    const session = await loadSession()
    if (typeof window !== 'undefined') {
      setClientLocale(session.locale)
      applyRuntimeConfig(session.config)
    }
    return { session }
  },
  component: RootLayout,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-page px-5 pt-16">
      <ErrorView error={error} />
    </main>
  ),
  notFoundComponent: NotFoundView,
  shellComponent: RootDocument,
})

function RootLayout() {
  const { session } = Route.useRouteContext()
  if (typeof window !== 'undefined') {
    setClientLocale(session.locale)
    applyRuntimeConfig(session.config)
  }
  return (
    <AppShell session={session}>
      <Outlet />
    </AppShell>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const locale = Route.useRouteContext({ select: (c) => c.session?.locale })
  return (
    <html lang={locale ?? 'en'}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}

        <Scripts />
      </body>
    </html>
  )
}
