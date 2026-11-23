import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { routeTree } from './routeTree.gen'
import { ErrorView, NotFoundView } from './components/ErrorView'

const cspNonce = createIsomorphicFn()
  .server(() => getRequestHeader('x-csp-nonce' as never) ?? undefined)
  .client(() => undefined)

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    ssr: { nonce: cspNonce() },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ErrorView,
    defaultNotFoundComponent: NotFoundView,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
