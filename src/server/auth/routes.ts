import { forLocale } from '#/i18n'
import { cookieLocale, isLocale, LOCALE_COOKIE, pickLocale, type Locale } from '#/i18n/locales'
import type { Db } from '../db/d1'
import type { Mailer } from '../notify'
import {
  changePassword,
  consumeMagicLink,
  createResetToken,
  createSession,
  destroySession,
  findToken,
  hasActiveAdmin,
  login,
  register,
  requestMagicLink,
  resetTarget,
  sessionUser,
  setPasswordFromReset,
  setupConfigured,
  verifyEmail,
  verifyTarget,
  type AuthError,
} from './accounts'
import { clearSessionCookie, clientIp, sameOrigin, sessionCookie, sessionToken, underLimit, type Limiter } from './http'
import { changeView, checkEmailView, forgotView, verifyFormView, loginView, logoutView, magicConfirmView, magicSentView, messageView, registerView, resetView, setupMissingView, verifyResultView, type AuthMode, type PageCtx } from './pages'

export const MAX_FORM_BYTES = 10 * 1024

export interface AuthDeps {
  db: Db
  app: string
  allowedDomain: string
  defaultLocale?: string
  mode?: AuthMode
  iterations?: number
  adminEmail?: string
  setupToken?: string
  mailer: Mailer | null
  mailDelivers?: boolean
  panelUrl: string
  limiter?: Limiter
  defer: (p: Promise<unknown>) => void
}

const AUTH_PATHS = new Set(['/login', '/register', '/forgot', '/logout', '/lang', '/account/password', '/magic'])

export const isAuthPath = (pathname: string) => AUTH_PATHS.has(pathname) || /^\/(reset|verify|magic)\/[^/]+$/.test(pathname)

export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || /[\x00-\x1f\\]/.test(raw)) return '/'
  const base = 'https://panel.invalid'
  let u: URL
  try {
    u = new URL(raw, base)
  } catch {
    return '/'
  }
  if (u.origin !== base || isAuthPath(u.pathname)) return '/'
  const out = u.pathname + u.search + u.hash
  if (out.startsWith('//') || new URL(out, base).origin !== base) return '/'
  return out
}

function safeReturn(raw: string | undefined): string {
  const v = raw ?? '/'
  if (!v.startsWith('/') || v.startsWith('//') || /[\x00-\x1f\\]/.test(v)) return '/'
  try {
    const u = new URL(v, 'https://panel.invalid')
    if (u.origin !== 'https://panel.invalid' || u.pathname === '/lang') return '/'
    return u.pathname + u.search
  } catch {
    return '/'
  }
}

export const requestLocale = (request: Request, fallback?: string): Locale =>
  pickLocale({ cookie: cookieLocale(request.headers.get('Cookie')), acceptLanguage: request.headers.get('Accept-Language'), fallback })

export async function readLimitedForm(request: Request, limit = MAX_FORM_BYTES): Promise<Record<string, string> | null> {
  const type = request.headers.get('Content-Type') ?? ''
  if (!request.body) return {}
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    body.set(c, off)
    off += c.byteLength
  }
  const text = new TextDecoder().decode(body)
  const out: Record<string, string> = {}
  try {
    if (type.startsWith('application/x-www-form-urlencoded') || !type) {
      for (const [k, v] of new URLSearchParams(text)) out[k] = v.slice(0, 500)
      return out
    }
    const fd = await new Response(body, { headers: { 'Content-Type': type } }).formData()
    for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v.slice(0, 500)
    return out
  } catch {
    return {}
  }
}

function tokenFromPath(pathname: string, prefix: string): string | null {
  try {
    return decodeURIComponent(pathname.slice(prefix.length))
  } catch {
    return null
  }
}

const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store', ...headers } })

export async function handleAuthRoute(request: Request, url: URL, deps: AuthDeps): Promise<Response | null> {
  if (!isAuthPath(url.pathname)) return null
  const method = request.method
  const isGet = method === 'GET' || method === 'HEAD'
  if (!isGet && method !== 'POST') return new Response(null, { status: 405 })
  const locale = requestLocale(request, deps.defaultLocale)
  const ctx: PageCtx = { locale, app: deps.app, path: url.pathname + url.search }
  const { t } = forLocale(locale)
  const errText = (e: AuthError) => t(e.error, e.params)
  if (!sameOrigin(request, url)) return messageView(ctx, 403, t('auth.errors.forbidden'))
  const mode: AuthMode = deps.mode ?? 'password'
  const passwordOn = mode !== 'magic_link'
  const magicOn = mode !== 'password'
  const magicAvailable = magicOn && !!deps.mailer && deps.mailDelivers !== false
  const resetAvailable = passwordOn && !!deps.mailer && deps.mailDelivers !== false
  const ip = clientIp(request) ?? 'unknown'
  const limited = async (email?: string) => !(await underLimit(deps.limiter, [`ip:${ip}`, ...(email ? [`ipemail:${ip}|${email.trim().toLowerCase().slice(0, 200)}`] : [])]))
  const form = async () => (isGet ? {} : await readLimitedForm(request))
  const tooLarge = () => messageView(ctx, 413, t('auth.errors.tooLarge'))
  const base = (deps.panelUrl || url.origin).replace(/\/$/, '')
  const send = (to: string, subject: string, text: string) => {
    if (!deps.mailer) return
    deps.defer(deps.mailer.send({ to, subject, text }).catch((e) => console.error(JSON.stringify({ at: 'auth-mail', error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }))))
  }
  const sendVerify = (to: string, name: string, token: string, l: Locale) => {
    const m = forLocale(l)
    send(to, m.t('auth.verify.mailSubject', { app: deps.app }), m.t('auth.verify.mailBody', { name, link: `${base}/verify/${token}`, app: deps.app }))
  }

  if (url.pathname === '/lang') {
    if (isGet) return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    const f = await form()
    if (!f) return tooLarge()
    const to = f.to
    const headers: Record<string, string> = isLocale(to) ? { 'Set-Cookie': `${LOCALE_COOKIE}=${to}; Max-Age=31536000; Path=/; Secure; SameSite=Lax` } : {}
    const token = sessionToken(request, url)
    if (isLocale(to) && token) {
      const s = await sessionUser(deps.db, token)
      if (s) await deps.db.prepare(`UPDATE users SET locale = ? WHERE id = ?`).bind(to, s.user.id).run()
    }
    return redirect(safeReturn(f.next), headers)
  }

  if (url.pathname === '/logout') {
    if (isGet) return logoutView(ctx)
    await destroySession(deps.db, sessionToken(request, url))
    return redirect('/login?out=1', { 'Set-Cookie': clearSessionCookie(url) })
  }

  if (url.pathname === '/account/password') {
    const s = await sessionUser(deps.db, sessionToken(request, url))
    if (!s) return redirect(`/login?next=${encodeURIComponent('/account/password')}`)
    const c: PageCtx = { ...ctx, locale: s.locale ?? locale }
    if (isGet) return changeView(c, {})
    const f = await form()
    if (!f) return tooLarge()
    if (await limited(s.user.email)) return changeView(c, { error: forLocale(c.locale).t('auth.errors.rateLimited') })
    const r = await changePassword(deps.db, s.user.id, f.current ?? '', f.password ?? '', { iterations: deps.iterations })
    if (!r.ok) return changeView(c, { error: forLocale(c.locale).t(r.error, r.params) })
    return redirect('/login?changed=1', { 'Set-Cookie': clearSessionCookie(url) })
  }

  if (url.pathname === '/login') {
    const next = safeNext(url.searchParams.get('next'))
    const view = (o: { email?: string; error?: string; notice?: string }) => loginView(ctx, { next, mode, magicAvailable, resetAvailable, ...o })
    if (isGet) {
      if (await sessionUser(deps.db, sessionToken(request, url))) return redirect(next)
      const reg = url.searchParams.get('registered')
      const notice = url.searchParams.has('changed') ? t('auth.login.passwordChanged') : url.searchParams.has('out') ? t('auth.login.signedOut') : reg === 'pending' ? t('auth.login.registeredPending') : reg ? t('auth.login.registered') : undefined
      return view({ notice })
    }
    if (!passwordOn) return view({ error: t('auth.magic.passwordOff') })
    const f = await form()
    if (!f) return tooLarge()
    if (await limited(f.email)) return view({ email: f.email, error: t('auth.errors.rateLimited') })
    const r = await login(deps.db, f.email ?? '', f.password ?? '', { iterations: deps.iterations })
    if (!r.ok) return view({ email: f.email, error: errText(r) })
    const token = await createSession(deps.db, r.userId, { ip, ua: request.headers.get('User-Agent') })
    return redirect(next, { 'Set-Cookie': sessionCookie(url, token) })
  }

  if (url.pathname === '/magic') {
    if (isGet) return redirect('/login')
    if (!magicAvailable) return messageView(ctx, 503, t('auth.magic.unavailable'))
    const f = await form()
    if (!f) return tooLarge()
    if (await limited(f.email)) return messageView(ctx, 429, t('auth.errors.rateLimited'))
    const issued = await requestMagicLink(deps.db, f.email ?? '')
    if (issued) {
      const m = forLocale(issued.locale ?? locale)
      send((f.email ?? '').trim().toLowerCase(), m.t('auth.magic.mailSubject', { app: deps.app }), m.t('auth.magic.mailBody', { name: issued.name, link: `${base}/magic/${issued.token}`, app: deps.app }))
    }
    return magicSentView(ctx)
  }

  if (url.pathname.startsWith('/magic/')) {
    const raw = tokenFromPath(url.pathname, '/magic/')
    if (raw === null) return messageView(ctx, 400, t('auth.errors.badRequest'))
    if (isGet) return magicConfirmView(ctx, { token: raw, invalid: !(await findToken(deps.db, 'magic', raw)) })
    if (await limited()) return messageView(ctx, 429, t('auth.errors.rateLimited'))
    const r = await consumeMagicLink(deps.db, raw)
    if (!r.ok) return magicConfirmView(ctx, { token: raw, invalid: true })
    const token = await createSession(deps.db, r.userId, { ip, ua: request.headers.get('User-Agent') })
    return redirect('/', { 'Set-Cookie': sessionCookie(url, token) })
  }

  if (url.pathname.startsWith('/verify/')) {
    const raw = tokenFromPath(url.pathname, '/verify/')
    if (raw === null) return messageView(ctx, 400, t('auth.errors.badRequest'))
    const target = await verifyTarget(deps.db, raw)
    if (!target) return verifyResultView(ctx, { ok: false })
    const vctx: PageCtx = { ...ctx, locale: target.locale ?? locale }
    const askPassword = passwordOn && !target.hasPassword
    if (isGet) return verifyFormView(vctx, { token: raw, email: target.email, askPassword })
    const f = await form()
    if (!f) return tooLarge()
    if (await limited(target.email)) return verifyFormView(vctx, { token: raw, email: target.email, askPassword, error: t('auth.errors.rateLimited') })
    const r = await verifyEmail(deps.db, raw, { password: f.password, passwordRequired: passwordOn, iterations: deps.iterations })
    if (!r.ok) return r.error === 'auth.verify.invalid' ? verifyResultView(vctx, { ok: false }) : verifyFormView(vctx, { token: raw, email: target.email, askPassword, error: forLocale(vctx.locale).t(r.error, r.params) })
    return verifyResultView(vctx, { ok: true, activated: r.activated, active: r.active })
  }

  if (url.pathname === '/register') {
    const bootstrap = !(await hasActiveAdmin(deps.db))
    const setup = { adminEmail: deps.adminEmail, setupToken: deps.setupToken }
    const domain = deps.allowedDomain.trim().toLowerCase().replace(/^@/, '')
    const invite = (isGet ? url.searchParams.get('invite') : null) ?? undefined
    if (bootstrap && !invite && !setupConfigured(setup)) return setupMissingView(ctx)
    const common = { bootstrap, setupToken: !!deps.setupToken, domain, passwordRequired: passwordOn }
    if (isGet) {
      if (invite) {
        const tok = await findToken(deps.db, 'invite', invite)
        if (!tok) return registerView(ctx, { ...common, error: t('auth.register.inviteInvalid') })
        return registerView(ctx, { ...common, invite, inviteEmail: tok.email })
      }
      return registerView(ctx, common)
    }
    const f = await form()
    if (!f) return tooLarge()
    if (await limited(f.email)) return registerView(ctx, { ...common, invite: f.invite, name: f.name, email: f.email, error: t('auth.errors.rateLimited') })
    const r = await register(
      deps.db,
      { name: f.name ?? '', email: f.email ?? '', password: passwordOn && f.invite ? (f.password ?? '') : undefined, invite: f.invite || undefined, setupToken: f.setup || undefined, locale },
      { allowedDomain: domain, iterations: deps.iterations, passwordRequired: passwordOn, ...setup },
    )
    if (!r.ok) return registerView(ctx, { ...common, invite: f.invite, name: f.name, email: f.email, error: errText(r) })
    const email = (f.email ?? '').trim().toLowerCase()
    if (r.verifyToken) sendVerify(email, (f.name ?? '').trim(), r.verifyToken, locale)
    if (r.outcome === 'verify') return checkEmailView(ctx, { email, logMode: deps.mailDelivers === false })
    if (r.outcome === 'pending') return redirect('/login?registered=pending')
    if (r.outcome === 'admin' && r.passwordToken) return redirect(`/reset/${encodeURIComponent(r.passwordToken)}`)
    const token = await createSession(deps.db, r.userId!, { ip, ua: request.headers.get('User-Agent') })
    return redirect('/', { 'Set-Cookie': sessionCookie(url, token) })
  }

  if (url.pathname === '/forgot') {
    if (isGet) return forgotView(ctx, { mailEnabled: resetAvailable })
    const f = await form()
    if (!f) return tooLarge()
    if (await limited(f.email)) return forgotView(ctx, { mailEnabled: resetAvailable, error: t('auth.errors.rateLimited') })
    if (resetAvailable) {
      const email = (f.email ?? '').trim().toLowerCase()
      const u = await deps.db.prepare(`SELECT id, display_name, locale FROM users WHERE email = ? AND status = 'active' AND can_login = 1`).bind(email).first<{ id: string; display_name: string; locale: string | null }>()
      if (u) {
        const { token } = await createResetToken(deps.db, u.id)
        const ml = forLocale(isLocale(u.locale) ? u.locale : locale)
        send(email, ml.t('auth.forgot.mailSubject', { app: deps.app }), ml.t('auth.forgot.mailBody', { name: u.display_name, link: `${base}/reset/${token}`, app: deps.app }))
      }
    }
    return forgotView(ctx, { mailEnabled: resetAvailable, sent: true })
  }

  const raw = tokenFromPath(url.pathname, '/reset/')
  if (raw === null) return messageView(ctx, 400, t('auth.errors.badRequest'))
  if (isGet) {
    const target = await resetTarget(deps.db, raw)
    return target ? resetView({ ...ctx, locale: target.locale ?? locale }, { token: raw, email: target.email }) : resetView(ctx, { token: raw, invalid: true })
  }
  const f = await form()
  if (!f) return tooLarge()
  if (await limited()) return resetView(ctx, { token: raw, error: t('auth.errors.rateLimited') })
  const r = await setPasswordFromReset(deps.db, raw, f.password ?? '', { iterations: deps.iterations })
  if (!r.ok) {
    if (r.error === 'auth.reset.invalid') return resetView(ctx, { token: raw, invalid: true })
    const target = await resetTarget(deps.db, raw)
    return resetView(ctx, { token: raw, email: target?.email, error: errText(r) })
  }
  return redirect('/login?changed=1', { 'Set-Cookie': clearSessionCookie(url) })
}
