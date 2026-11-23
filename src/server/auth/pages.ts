import { brandInitial } from '#/config/brand'
import { forLocale } from '#/i18n'
import { LOCALES, LOCALE_NAMES, type Locale } from '#/i18n/locales'
import { MIN_PASSWORD_LENGTH } from './password'

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface PageCtx {
  locale: Locale
  app: string
  path: string
}

const STYLE = `
:root{--bg:#F3EDE7;--card:#fff;--ink:#1D1D1F;--muted:#5B5B63;--line:rgba(0,0,0,.1);--accent:#F2A271;--on-accent:#2A1406;--err:#A3121D;--ok:#0B5E2C}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100dvh;display:grid;place-items:center;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
main{width:min(400px,100%);background:var(--card);border-radius:22px;padding:32px 28px;box-shadow:0 1px 0 rgba(255,255,255,.8) inset,0 24px 48px -32px rgba(60,30,10,.35),0 0 0 1px rgba(60,30,10,.05)}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:16px;margin-bottom:22px}
.mark{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--ink);color:#fff;font-size:16px;font-weight:700}
h1{font-size:24px;font-weight:650;letter-spacing:-.03em}
.lead{margin-top:8px;color:var(--muted);font-size:15px;line-height:1.45}
form{margin-top:22px;display:flex;flex-direction:column;gap:14px}
label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600}
input{font:inherit;font-size:16px;font-weight:400;padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink)}
input:focus{outline:3px solid rgba(242,162,113,.45);outline-offset:0;border-color:var(--accent)}
.hint{font-weight:400;color:var(--muted);font-size:12.5px}
button{font:inherit;font-weight:650;font-size:15.5px;margin-top:4px;padding:12px 16px;border:0;border-radius:999px;background:var(--accent);color:var(--on-accent);cursor:pointer}
button.sec{background:#EDE4DB;color:var(--ink)}
button:focus-visible,a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.msg{margin-top:16px;padding:11px 13px;border-radius:12px;font-size:14px;line-height:1.45}
.msg.err{background:#FBE9EA;color:var(--err)}
.msg.ok{background:#E6F4EA;color:var(--ok)}
.links{margin-top:18px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:14px;color:var(--muted)}
a{color:var(--ink);font-weight:600}
.langs{margin-top:22px;display:flex;gap:12px;font-size:13px;color:var(--muted)}
.langs form{margin:0;display:inline}
.langs button.lang{all:unset;cursor:pointer;color:var(--muted);font-weight:500;text-decoration:underline}
.langs button.lang:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.langs [aria-current]{color:var(--ink);font-weight:650}
.or{margin:18px 0 0;text-align:center;font-size:13px;color:var(--muted)}
.row{display:flex;gap:10px}.row>*{flex:1}
`

export function page(ctx: PageCtx, title: string, body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const { t } = forLocale(ctx.locale)
  const langs = LOCALES.map((l) =>
    l === ctx.locale
      ? `<span aria-current="true">${esc(LOCALE_NAMES[l])}</span>`
      : `<form method="post" action="/lang"><input type="hidden" name="to" value="${esc(l)}"><input type="hidden" name="next" value="${esc(ctx.path)}"><button type="submit" class="lang" lang="${esc(l)}">${esc(LOCALE_NAMES[l])}</button></form>`,
  ).join('')
  const html = `<!doctype html><html lang="${ctx.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(t('auth.pageTitle', { page: title, app: ctx.app }))}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>${STYLE}</style></head>
<body><main><div class="brand"><span class="mark" aria-hidden="true">${esc(brandInitial(ctx.app))}</span><span>${esc(ctx.app)}</span></div>${body}<nav class="langs" aria-label="${esc(t('auth.language'))}">${langs}</nav></main></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders } })
}

const msg = (text: string | undefined, kind: 'err' | 'ok') => (text ? `<p class="msg ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${esc(text)}</p>` : '')

const field = (name: string, label: string, opts: { type?: string; value?: string; autocomplete?: string; hint?: string; autofocus?: boolean; readonly?: boolean; optional?: boolean } = {}) =>
  `<label>${esc(label)}<input name="${name}" type="${opts.type ?? 'text'}" ${opts.value ? `value="${esc(opts.value)}"` : ''} ${opts.autocomplete ? `autocomplete="${opts.autocomplete}"` : ''} ${opts.autofocus ? 'autofocus' : ''} ${opts.readonly ? 'readonly' : ''} ${opts.optional ? '' : 'required'}${opts.type === 'password' ? ` minlength="${opts.autocomplete === 'current-password' ? 1 : MIN_PASSWORD_LENGTH}" maxlength="200"` : ' maxlength="200"'}>${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''}</label>`

export type AuthMode = 'password' | 'magic_link' | 'both'

export function loginView(ctx: PageCtx, o: { next: string; email?: string; error?: string; notice?: string; mode: AuthMode; magicAvailable: boolean; resetAvailable: boolean }) {
  const { t } = forLocale(ctx.locale)
  const q = o.next !== '/' ? `?next=${encodeURIComponent(o.next)}` : ''
  const pw = o.mode !== 'magic_link'
    ? `<form method="post" action="/login${q}">${field('email', t('auth.email'), { type: 'email', value: o.email, autocomplete: 'username', autofocus: !o.email })}${field('password', t('auth.password'), { type: 'password', autocomplete: 'current-password', autofocus: !!o.email })}<button type="submit">${esc(t('auth.login.submit'))}</button></form>`
    : ''
  const magic = o.mode !== 'password'
    ? o.magicAvailable
      ? `${pw ? `<p class="or">${esc(t('auth.magic.or'))}</p>` : ''}<form method="post" action="/magic">${field('email', t('auth.email'), { type: 'email', value: pw ? undefined : o.email, autocomplete: 'username', autofocus: !pw })}<button type="submit" class="${pw ? 'sec' : ''}">${esc(t('auth.magic.request'))}</button></form>`
      : msg(t('auth.magic.unavailable'), 'err')
    : ''
  return page(
    ctx,
    t('auth.login.title'),
    `<h1>${esc(t('auth.login.title'))}</h1><p class="lead">${esc(t('auth.login.lead'))}</p>${msg(o.notice, 'ok')}${msg(o.error, 'err')}${pw}${magic}
<div class="links">${o.mode !== 'magic_link' && o.resetAvailable ? `<a href="/forgot">${esc(t('auth.login.forgot'))}</a>` : '<span></span>'}<span>${esc(t('auth.login.noAccount'))} <a href="/register">${esc(t('auth.login.register'))}</a></span></div>`,
    o.error ? 400 : 200,
  )
}

export function registerView(ctx: PageCtx, o: { bootstrap: boolean; setupToken: boolean; invite?: string; inviteEmail?: string | null; domain: string; name?: string; email?: string; error?: string; passwordRequired: boolean }) {
  const { t } = forLocale(ctx.locale)
  const lead = o.invite ? t('auth.register.leadInvite') : o.bootstrap ? t('auth.setup.lead') : t('auth.register.lead')
  const setup = o.bootstrap && !o.invite && o.setupToken ? field('setup', t('auth.setup.token'), { type: 'password', autocomplete: 'off', hint: t('auth.setup.tokenHint'), optional: true }) : ''
  return page(
    ctx,
    t('auth.register.title'),
    `<h1>${esc(o.bootstrap && !o.invite ? t('auth.setup.title') : t('auth.register.title'))}</h1><p class="lead">${esc(lead)}</p>${msg(o.error, 'err')}
<form method="post" action="/register">${o.invite ? `<input type="hidden" name="invite" value="${esc(o.invite)}">` : ''}${field('name', t('auth.name'), { value: o.name, autocomplete: 'name', autofocus: true })}${field('email', t('auth.email'), { type: 'email', value: o.inviteEmail ?? o.email, autocomplete: 'email', readonly: !!o.inviteEmail, hint: o.domain ? t('auth.register.domainOnly', { domain: o.domain }) : undefined })}${o.passwordRequired && o.invite ? field('password', t('auth.password'), { type: 'password', autocomplete: 'new-password', hint: t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH }) }) : ''}${setup}<button type="submit">${esc(t('auth.register.submit'))}</button></form>
<div class="links"><span>${esc(t('auth.register.haveAccount'))} <a href="/login">${esc(t('auth.register.signIn'))}</a></span></div>`,
    o.error ? 400 : 200,
  )
}

export function setupMissingView(ctx: PageCtx) {
  const { t } = forLocale(ctx.locale)
  return page(ctx, t('auth.setup.title'), `<h1>${esc(t('auth.setup.title'))}</h1>${msg(t('auth.setup.missing'), 'err')}<p class="lead">${esc(t('auth.setup.missingHelp'))}</p>`, 503)
}

export function checkEmailView(ctx: PageCtx, o: { email: string; logMode: boolean }) {
  const { t } = forLocale(ctx.locale)
  return page(ctx, t('auth.verify.checkTitle'), `<h1>${esc(t('auth.verify.checkTitle'))}</h1><p class="lead">${esc(t('auth.verify.checkLead', { email: o.email }))}</p>${o.logMode ? msg(t('auth.verify.logMode'), 'ok') : ''}<div class="links"><a href="/login">${esc(t('auth.forgot.back'))}</a></div>`)
}

export function verifyFormView(ctx: PageCtx, o: { token: string; email: string; askPassword: boolean; error?: string }) {
  const { t } = forLocale(ctx.locale)
  return page(
    ctx,
    t('auth.verify.title'),
    `<h1>${esc(t('auth.verify.title'))}</h1><p class="lead">${esc(o.askPassword ? t('auth.verify.setPasswordLead', { email: o.email }) : t('auth.verify.confirmLead', { email: o.email }))}</p>${msg(o.error, 'err')}
<form method="post" action="/verify/${encodeURIComponent(o.token)}">${o.askPassword ? `<input type="email" name="username" value="${esc(o.email)}" autocomplete="username" hidden>${field('password', t('auth.newPassword'), { type: 'password', autocomplete: 'new-password', autofocus: true, hint: t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH }) })}` : ''}<button type="submit">${esc(o.askPassword ? t('auth.verify.submitPassword') : t('auth.verify.submit'))}</button></form>`,
    o.error ? 400 : 200,
  )
}

export function verifyResultView(ctx: PageCtx, o: { ok: boolean; activated?: boolean; active?: boolean }) {
  const { t } = forLocale(ctx.locale)
  const text = !o.ok ? t('auth.verify.invalid') : o.activated ? t('auth.verify.doneAdmin') : o.active ? t('auth.verify.doneActive') : t('auth.verify.done')
  return page(ctx, t('auth.verify.title'), `<h1>${esc(t('auth.verify.title'))}</h1>${msg(text, o.ok ? 'ok' : 'err')}<div class="links"><a href="/login">${esc(t('auth.register.signIn'))}</a></div>`, o.ok ? 200 : 400)
}

export function magicSentView(ctx: PageCtx) {
  const { t } = forLocale(ctx.locale)
  return page(ctx, t('auth.magic.sentTitle'), `<h1>${esc(t('auth.magic.sentTitle'))}</h1>${msg(t('auth.magic.sent'), 'ok')}<div class="links"><a href="/login">${esc(t('auth.forgot.back'))}</a></div>`)
}

export function magicConfirmView(ctx: PageCtx, o: { token: string; invalid?: boolean }) {
  const { t } = forLocale(ctx.locale)
  if (o.invalid) return page(ctx, t('auth.magic.title'), `<h1>${esc(t('auth.magic.title'))}</h1>${msg(t('auth.magic.invalid'), 'err')}<div class="links"><a href="/login">${esc(t('auth.forgot.back'))}</a></div>`, 400)
  return page(ctx, t('auth.magic.title'), `<h1>${esc(t('auth.magic.title'))}</h1><p class="lead">${esc(t('auth.magic.confirmLead'))}</p><form method="post" action="/magic/${encodeURIComponent(o.token)}"><button type="submit">${esc(t('auth.magic.confirm'))}</button></form>`)
}

export function forgotView(ctx: PageCtx, o: { mailEnabled: boolean; sent?: boolean; error?: string }) {
  const { t } = forLocale(ctx.locale)
  const form = o.mailEnabled && !o.sent ? `<form method="post" action="/forgot">${field('email', t('auth.email'), { type: 'email', autocomplete: 'username', autofocus: true })}<button type="submit">${esc(t('auth.forgot.submit'))}</button></form>` : ''
  return page(
    ctx,
    t('auth.forgot.title'),
    `<h1>${esc(t('auth.forgot.title'))}</h1><p class="lead">${esc(o.mailEnabled ? t('auth.forgot.lead') : t('auth.forgot.leadNoMail'))}</p>${msg(o.sent ? t('auth.forgot.sent') : undefined, 'ok')}${msg(o.error, 'err')}${form}
<div class="links"><a href="/login">${esc(t('auth.forgot.back'))}</a></div>`,
  )
}

export function resetView(ctx: PageCtx, o: { token: string; email?: string; error?: string; invalid?: boolean }) {
  const { t } = forLocale(ctx.locale)
  if (o.invalid)
    return page(ctx, t('auth.reset.title'), `<h1>${esc(t('auth.reset.title'))}</h1>${msg(t('auth.reset.invalid'), 'err')}<div class="links"><a href="/forgot">${esc(t('auth.forgot.title'))}</a><a href="/login">${esc(t('auth.forgot.back'))}</a></div>`, 400)
  return page(
    ctx,
    t('auth.reset.title'),
    `<h1>${esc(t('auth.reset.title'))}</h1><p class="lead">${esc(t('auth.reset.lead', { email: o.email ?? '' }))}</p>${msg(o.error, 'err')}
<form method="post" action="/reset/${encodeURIComponent(o.token)}"><input type="email" name="username" value="${esc(o.email ?? '')}" autocomplete="username" hidden>${field('password', t('auth.newPassword'), { type: 'password', autocomplete: 'new-password', autofocus: true, hint: t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH }) })}<button type="submit">${esc(t('auth.reset.submit'))}</button></form>`,
    o.error ? 400 : 200,
  )
}

export function changeView(ctx: PageCtx, o: { error?: string }) {
  const { t } = forLocale(ctx.locale)
  return page(
    ctx,
    t('auth.change.title'),
    `<h1>${esc(t('auth.change.title'))}</h1><p class="lead">${esc(t('auth.change.lead'))}</p>${msg(o.error, 'err')}
<form method="post" action="/account/password">${field('current', t('auth.currentPassword'), { type: 'password', autocomplete: 'current-password', autofocus: true })}${field('password', t('auth.newPassword'), { type: 'password', autocomplete: 'new-password', hint: t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH }) })}<button type="submit">${esc(t('auth.change.submit'))}</button></form>
<div class="links"><a href="/">${esc(t('auth.change.back'))}</a></div>`,
    o.error ? 400 : 200,
  )
}

export function logoutView(ctx: PageCtx) {
  const { t } = forLocale(ctx.locale)
  return page(
    ctx,
    t('auth.logout.title'),
    `<h1>${esc(t('auth.logout.title'))}</h1><p class="lead">${esc(t('auth.logout.lead', { app: ctx.app }))}</p><form method="post" action="/logout"><div class="row"><button type="submit">${esc(t('auth.logout.submit'))}</button></div></form><div class="links"><a href="/">${esc(t('auth.logout.cancel'))}</a></div>`,
  )
}

export function messageView(ctx: PageCtx, status: number, message: string) {
  return page(ctx, message, `<p class="lead">${esc(message)}</p><div class="links"><a href="/">${esc(ctx.app)}</a></div>`, status)
}
