import { AsyncLocalStorage } from 'node:async_hooks'
import { env, waitUntil } from 'cloudflare:workers'
import { createServerEntry, createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { appNameOr, cleanPanelUrl } from './config/brand'
import { applyRuntimeConfig } from './config/runtime'
import { setFallbackLocale, setLocaleResolver, translate } from './i18n'
import { isLocale, type Locale } from './i18n/locales'
import type { Currency } from './lib/money'
import type { AuthUser } from './server/auth/authorize'
import { purgeExpiredSessions, sessionUser } from './server/auth/accounts'
import { sameOrigin, sessionCookie, sessionToken } from './server/auth/http'
import { messageView } from './server/auth/pages'
import { handleAuthRoute, requestLocale } from './server/auth/routes'
import { handleActionLink } from './server/actionLink'
import { handleExportRequest } from './server/exportRoute'
import { handleFileRequest } from './server/fileRoute'
import { fxMissing, refreshFx } from './server/fx'
import { accountingConfig, authMailer, mailDelivers, mailer } from './server/mailer'
import { passwordIterations } from './server/auth/password'
import type { AuthMode } from './server/auth/pages'
import { deliverAccounting, monthEndInvoiceMails } from './server/accounting'
import { dailyMails, deliver, enqueue } from './server/notify'
import { todayISO } from './server/time'

const localeStore = new AsyncLocalStorage<Locale>()
setLocaleResolver(() => localeStore.getStore())

const startFetch = createStartHandler(defaultStreamHandler)

const NOINDEX = 'noindex, nofollow, noarchive'
const NONCE_HEADER = 'x-csp-nonce'

const BASE_HEADERS: Record<string, string> = {
  'X-Robots-Tag': NOINDEX,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}

const csp = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

function withHeaders(res: Response, nonce?: string) {
  const r = new Response(res.body, res)
  for (const [k, v] of Object.entries(BASE_HEADERS)) r.headers.set(k, v)
  if (nonce && !import.meta.env.DEV && !r.headers.has('Content-Security-Policy')) {
    r.headers.set('Content-Security-Policy', csp(nonce))
  }
  return r
}

const wantsHtml = (r: Request) => (r.headers.get('Accept') ?? '').includes('text/html')

function deny(request: Request, status: number, message: string, locale: Locale) {
  if (wantsHtml(request)) return withHeaders(messageView({ locale, app: appName(), path: '/' }, status, message))
  return withHeaders(Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }))
}

const appName = () => appNameOr(env.APP_NAME)

const authMode = (): AuthMode => (env.AUTH_MODE === 'magic_link' || env.AUTH_MODE === 'both' ? env.AUTH_MODE : 'password')

let checked = false
function startupChecks() {
  if (checked) return
  checked = true
  const problems: string[] = []
  if (!cleanPanelUrl(env.PANEL_URL)) problems.push('PANEL_URL is empty or a placeholder: links in emails use the request Host header, which is only trustworthy behind a Cloudflare Workers custom domain')
  if (!env.AUTH_LIMIT) problems.push('AUTH_LIMIT rate limit binding is missing: sign-in, registration and password reset are not rate limited')
  if (!env.ACTION_LIMIT) problems.push('ACTION_LIMIT rate limit binding is missing: email approval links are not rate limited')
  if (!(env.ADMIN_EMAIL ?? '').trim() && !(env.SETUP_TOKEN ?? '').trim()) problems.push('ADMIN_EMAIL and SETUP_TOKEN are both empty: first-time registration is closed until one is set')
  if (authMode() !== 'password' && !mailDelivers() && !import.meta.env.DEV) problems.push(`AUTH_MODE=${authMode()} needs MAIL_MODE=resend with RESEND_API_KEY and MAIL_FROM: email sign-in links cannot be delivered`)
  const it = passwordIterations(env.PASSWORD_ITERATIONS)
  if (it.adjusted) problems.push(`PASSWORD_ITERATIONS adjusted to ${it.iterations}`)
  for (const p of problems) console.warn(JSON.stringify({ at: 'startup', warning: p }))
}

function configure() {
  startupChecks()
  applyRuntimeConfig({
    appName: appName(),
    baseCurrency: (env.CURRENCY ?? 'TRY').toUpperCase() as Currency,
    booksStart: env.BOOKS_START_DATE ?? '',
    holidayCountry: env.HOLIDAY_COUNTRY ?? 'TR',
    timeZone: env.TIME_ZONE ?? 'Europe/Istanbul',
    accountingLocale: env.ACCOUNTING_LOCALE ?? env.DEFAULT_LOCALE ?? 'en',
    company: { name: env.COMPANY_NAME ?? '', address: env.COMPANY_ADDRESS ?? '', registration: env.COMPANY_REGISTRATION ?? '', contactEmail: env.COMPANY_CONTACT_EMAIL ?? '' },
  })
  setFallbackLocale(env.DEFAULT_LOCALE)
}

interface Identity {
  user: AuthUser
  locale: Locale | null
  refreshed?: boolean
}

async function resolveIdentity(request: Request, url: URL): Promise<Identity | null> {
  if (import.meta.env.DEV) {
    const { devIdentity } = await import('./server/auth/dev-identity')
    const dev = await devIdentity(request, env.DB, env.DEV_AUTH)
    if (dev) return { user: dev.user, locale: isLocale(dev.locale) ? dev.locale : null }
  }
  return sessionUser(env.DB, sessionToken(request, url))
}

const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))

async function serveApp(request: Request, id: Identity, locale: Locale, opts: Parameters<typeof startFetch>[1]) {
  if (env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return withHeaders(asset)
  }
  const nonce = newNonce()
  const headers = new Headers(request.headers)
  headers.set(NONCE_HEADER, nonce)
  const inner = new Request(request, { headers })
  const res = await startFetch(inner, { ...opts, context: { ...opts?.context, nonce, user: id.user, locale } as never })
  const out = withHeaders(res, nonce)
  out.headers.set('Cache-Control', 'private, no-store')
  return out
}

const PUBLIC_FILES = new Set(['/favicon.svg'])

async function handle(request: Request, url: URL, opts: Parameters<typeof startFetch>[1]): Promise<Response> {
  const isGet = request.method === 'GET' || request.method === 'HEAD'
  const guestLocale = requestLocale(request, env.DEFAULT_LOCALE)
  if (url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': NOINDEX } })
  }
  if (url.pathname === '/favicon.ico' && isGet) return withHeaders(Response.redirect(`${url.origin}/favicon.svg`, 301))
  if (PUBLIC_FILES.has(url.pathname) && isGet && env.ASSETS) {
    const r = withHeaders(await env.ASSETS.fetch(request))
    r.headers.set('Cache-Control', 'public, max-age=86400')
    return r
  }
  if (/^\/a\/[^/]*$/.test(url.pathname)) {
    if (env.ACTION_LIMIT) {
      const { success } = await env.ACTION_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' })
      if (!success) return new Response(translate(guestLocale, 'auth.errors.rateLimited'), { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' } })
    }
    const res = withHeaders(await handleActionLink(request, url, { db: env.DB, panelUrl: cleanPanelUrl(env.PANEL_URL) || url.origin }))
    res.headers.set('Referrer-Policy', 'strict-origin')
    res.headers.set('Cache-Control', 'no-store')
    const m = request.method === 'POST' && res.status === 200 ? mailer() : null
    if (m) {
      waitUntil(deliver(env.DB, m, cleanPanelUrl(env.PANEL_URL)).catch(() => {}))
      waitUntil(deliverAccounting(env.DB, env.FILES, m, accountingConfig(), 1).catch(() => {}))
    }
    return res
  }
  const auth = await handleAuthRoute(request, url, {
    db: env.DB,
    app: appName(),
    allowedDomain: env.ALLOWED_EMAIL_DOMAIN ?? '',
    defaultLocale: env.DEFAULT_LOCALE,
    mode: authMode(),
    iterations: passwordIterations(env.PASSWORD_ITERATIONS).iterations,
    adminEmail: env.ADMIN_EMAIL,
    setupToken: env.SETUP_TOKEN,
    mailer: authMailer(),
    mailDelivers: mailDelivers() || import.meta.env.DEV,
    panelUrl: cleanPanelUrl(env.PANEL_URL),
    limiter: env.AUTH_LIMIT,
    defer: (p) => waitUntil(p),
  })
  if (auth) {
    const r = withHeaders(auth)
    r.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    return r
  }
  if (!sameOrigin(request, url)) return deny(request, 403, translate(guestLocale, 'auth.errors.forbidden'), guestLocale)

  const id = await resolveIdentity(request, url)
  if (!id) {
    if (isGet && wantsHtml(request)) {
      const next = url.pathname === '/' && !url.search ? '' : `?next=${encodeURIComponent(url.pathname + url.search)}`
      return withHeaders(Response.redirect(`${url.origin}/login${next}`, 302))
    }
    return deny(request, 401, translate(guestLocale, 'auth.errors.loginRequired'), guestLocale)
  }
  const locale = id.locale ?? guestLocale
  return localeStore.run(locale, async () => {
    let res: Response
    if (url.pathname.startsWith('/files/')) res = withHeaders(await handleFileRequest(request, url, id.user))
    else if (url.pathname.startsWith('/exports/')) res = withHeaders(await handleExportRequest(request, url, id.user))
    else res = await serveApp(request, id, locale, opts)
    if (id.refreshed) {
      const token = sessionToken(request, url)
      if (token) res.headers.append('Set-Cookie', sessionCookie(url, token))
    }
    return res
  })
}

const entry = createServerEntry({
  async fetch(request, opts) {
    configure()
    const url = new URL(request.url)
    return localeStore.run(requestLocale(request, env.DEFAULT_LOCALE), () => handle(request, url, opts))
  },
})

const MONTH_END_CRON = '0 14 28-31 * *'
async function scheduled(event: { cron: string }) {
  configure()
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      console.error(`cron ${name} failed`, e instanceof Error ? e.message : e)
    }
  }
  if (event.cron === '0 6 * * *') {
    await step('dailyMails', async () => {
      const list = await dailyMails(env.DB, todayISO())
      if (list.length) await env.DB.batch(enqueue(env.DB, list))
    })
    await step('purgeSessions', () => purgeExpiredSessions(env.DB).then(() => undefined))
    await step('refreshFx', () => refreshFx(env.DB).then(() => undefined))
  } else if (event.cron === MONTH_END_CRON) {
    await step('monthEndInvoiceMails', async () => {
      const inv = await monthEndInvoiceMails(env.DB, todayISO())
      if (inv.length) await env.DB.batch(inv)
    })
  } else if (await fxMissing(env.DB)) {
    await refreshFx(env.DB)
  }
  const m = mailer()
  if (m) {
    await deliver(env.DB, m, cleanPanelUrl(env.PANEL_URL), 50)
    await deliverAccounting(env.DB, env.FILES, m, accountingConfig(), 20)
  }
}

export default { ...entry, scheduled }
