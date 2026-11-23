import { describe, expect, it } from 'vitest'
import { testDb } from './db/testing'
import { hashIterations, hashPassword, MAX_PBKDF2_ITERATIONS, MIN_PBKDF2_ITERATIONS, PBKDF2_ITERATIONS, passwordIterations, verifyPassword } from './auth/password'
import {
  changePassword,
  consumeMagicLink,
  createInvite,
  createResetToken,
  createSession,
  login,
  openTokens,
  register,
  requestMagicLink,
  revokeToken,
  sessionUser,
  setPasswordFromReset,
  SESSION_TTL_MS,
  verifyEmail,
} from './auth/accounts'
import { sameOrigin } from './auth/http'
import { handleAuthRoute, MAX_FORM_BYTES, readLimitedForm, safeNext, type AuthDeps } from './auth/routes'
import { toAuthUser, type UserRow } from './db/users'
import { pickLocale } from '#/i18n/locales'
import { translate } from '#/i18n'
import type { Db } from './db/d1'

const PASS = 'correct horse battery'
const SETUP = { setupToken: 'setup-secret-123' }
const LOW = MIN_PBKDF2_ITERATIONS

async function withAdmin() {
  const db = testDb()
  const r = await register(db, { name: 'Deniz Örnek', email: 'deniz@example.com', password: PASS, setupToken: SETUP.setupToken }, SETUP)
  if (!r.ok || r.outcome !== 'admin' || !r.passwordToken) throw new Error('setup failed')
  const set = await setPasswordFromReset(db, r.passwordToken, PASS)
  if (!set.ok) throw new Error('password setup failed')
  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(r.userId).first<UserRow>()
  return { db, admin: toAuthUser(row!), adminId: r.userId! }
}

const count = async (db: Db, sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).first<{ n: number }>())!.n

describe('password hashing', () => {
  it('stores algorithm and iteration count, uses a unique salt and verifies', async () => {
    const a = await hashPassword(PASS)
    const b = await hashPassword(PASS)
    expect(a.startsWith(`pbkdf2-sha256$${PBKDF2_ITERATIONS}$`)).toBe(true)
    expect(a.split('$')).toHaveLength(4)
    expect(a).not.toBe(b)
    expect(await verifyPassword(PASS, a)).toBe(true)
    expect(await verifyPassword('wrong password!', a)).toBe(false)
    expect(await verifyPassword(PASS, null)).toBe(false)
    expect(await verifyPassword(PASS, 'md5$1$x$y')).toBe(false)
  })

  it('reads PASSWORD_ITERATIONS within the supported range', () => {
    expect(passwordIterations(undefined)).toEqual({ iterations: PBKDF2_ITERATIONS, adjusted: false })
    expect(passwordIterations('90000')).toEqual({ iterations: 90_000, adjusted: false })
    expect(passwordIterations('1000')).toEqual({ iterations: MIN_PBKDF2_ITERATIONS, adjusted: true })
    expect(passwordIterations('600000')).toEqual({ iterations: MAX_PBKDF2_ITERATIONS, adjusted: true })
  })

  it('re-hashes with the configured iteration count after a successful sign-in', async () => {
    const { db, adminId } = await withAdmin()
    await db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(PASS, LOW), adminId).run()
    expect(await login(db, 'deniz@example.com', 'wrong password!', { iterations: PBKDF2_ITERATIONS })).toMatchObject({ ok: false })
    const stored = async () => (await db.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(adminId).first<{ password_hash: string }>())!.password_hash
    expect(hashIterations(await stored())).toBe(LOW)
    expect(await login(db, 'deniz@example.com', PASS, { iterations: PBKDF2_ITERATIONS })).toMatchObject({ ok: true })
    expect(hashIterations(await stored())).toBe(PBKDF2_ITERATIONS)
    expect(await login(db, 'deniz@example.com', PASS, { iterations: PBKDF2_ITERATIONS })).toMatchObject({ ok: true })
  })
})

describe('first administrator setup', () => {
  it('is closed when neither ADMIN_EMAIL nor SETUP_TOKEN is configured', async () => {
    const db = testDb()
    expect(await register(db, { name: 'Deniz Örnek', email: 'deniz@example.com', password: PASS })).toMatchObject({ ok: false, error: 'auth.setup.missing' })
    expect(await count(db, `SELECT COUNT(*) AS n FROM users`)).toBe(0)
  })

  it('accepts only the configured ADMIN_EMAIL and activates it after email verification', async () => {
    const db = testDb()
    const opts = { adminEmail: 'Owner@Example.com' }
    expect(await register(db, { name: 'Someone', email: 'someone@example.com', password: PASS }, opts)).toMatchObject({ ok: false, error: 'auth.setup.closed' })
    const r = await register(db, { name: 'Deniz Örnek', email: 'owner@example.com', password: PASS }, opts)
    expect(r).toMatchObject({ ok: true, outcome: 'verify' })
    if (!r.ok) return
    expect(await db.prepare(`SELECT status, is_admin, role, email_verified_at FROM users`).first()).toEqual({ status: 'pending', is_admin: 1, role: 'owner', email_verified_at: null })
    expect(await db.prepare(`SELECT password_hash FROM users`).first()).toEqual({ password_hash: null })
    expect(await login(db, 'owner@example.com', PASS)).toMatchObject({ ok: false, error: 'auth.login.invalid' })
    expect(await verifyEmail(db, r.verifyToken!, { password: 'short' })).toMatchObject({ ok: false, error: 'auth.errors.passwordShort' })
    expect(await verifyEmail(db, r.verifyToken!, { password: PASS })).toMatchObject({ ok: true, activated: true })
    expect(await verifyEmail(db, r.verifyToken!, { password: PASS })).toMatchObject({ ok: false, error: 'auth.verify.invalid' })
    expect(await login(db, 'owner@example.com', PASS)).toMatchObject({ ok: true })
  })

  it('makes the holder of the SETUP_TOKEN the administrator immediately', async () => {
    const db = testDb()
    expect(await register(db, { name: 'A', email: 'a@example.com', password: PASS, setupToken: 'wrong' }, SETUP)).toMatchObject({ ok: false, error: 'auth.setup.badToken' })
    const r = await register(db, { name: 'A', email: 'a@example.com', password: PASS, setupToken: SETUP.setupToken }, SETUP)
    expect(r).toMatchObject({ ok: true, outcome: 'admin' })
    expect(await db.prepare(`SELECT status, is_admin, role, password_hash FROM users`).first()).toEqual({ status: 'active', is_admin: 1, role: 'owner', password_hash: null })
    if (!r.ok) return
    expect(await setPasswordFromReset(db, r.passwordToken!, PASS)).toMatchObject({ ok: true })
    expect(await login(db, 'a@example.com', PASS)).toMatchObject({ ok: true })
  })

  it('shows a setup error page instead of the registration form when unconfigured', async () => {
    const db = testDb()
    const req = new Request('https://panel.example.com/register', { headers: { 'Accept-Language': 'en' } })
    const res = await handleAuthRoute(req, new URL(req.url), { db, app: 'Test Panel', allowedDomain: '', mailer: null, panelUrl: '', defer: () => {} })
    expect(res!.status).toBe(503)
    expect(await res!.text()).toContain('Setup is not configured')
  })
})

describe('registration and email verification', () => {
  it('creates later accounts as pending with a verification link, and they cannot sign in', async () => {
    const { db } = await withAdmin()
    const r = await register(db, { name: 'Ece Demo', email: 'ece@example.com', password: PASS })
    expect(r).toMatchObject({ ok: true, outcome: 'pending' })
    if (!r.ok) return
    expect(r.verifyToken).toBeTruthy()
    expect(await db.prepare(`SELECT status, is_admin, role, email_verified_at FROM users WHERE email = 'ece@example.com'`).first()).toEqual({ status: 'pending', is_admin: 0, role: 'employee', email_verified_at: null })
    expect(await login(db, 'ece@example.com', PASS)).toMatchObject({ ok: false, error: 'auth.login.invalid' })
    expect(await verifyEmail(db, r.verifyToken!, { password: PASS })).toMatchObject({ ok: true, activated: false, active: false })
    expect(await login(db, 'ece@example.com', PASS)).toMatchObject({ ok: false, error: 'auth.login.pending' })
    expect(await db.prepare(`SELECT status, email_verified_at IS NOT NULL AS v FROM users WHERE email = 'ece@example.com'`).first()).toEqual({ status: 'pending', v: 1 })
  })

  it('expires verification links after 24 hours', async () => {
    const { db } = await withAdmin()
    const t0 = new Date()
    const r = await register(db, { name: 'Ece Demo', email: 'ece@example.com', password: PASS }, { now: t0 })
    if (!r.ok) throw new Error('register failed')
    expect(await verifyEmail(db, r.verifyToken!, { password: PASS, now: new Date(t0.getTime() + 25 * 3600_000) })).toMatchObject({ ok: false })
  })

  it('does not reveal whether an email is already registered', async () => {
    const { db } = await withAdmin()
    const r = await register(db, { name: 'Someone Else', email: 'deniz@example.com', password: 'another password' })
    expect(r).toEqual({ ok: true, outcome: 'pending', userId: null, verifyToken: null })
    expect(await count(db, `SELECT COUNT(*) AS n FROM users`)).toBe(1)
    expect(await login(db, 'deniz@example.com', PASS)).toMatchObject({ ok: true })
  })

  it('validates name, email and password length', async () => {
    const { db, admin } = await withAdmin()
    expect(await register(db, { name: ' ', email: 'a@example.com', password: PASS })).toMatchObject({ ok: false, error: 'auth.errors.nameRequired' })
    expect(await register(db, { name: 'A', email: 'not-an-email', password: PASS })).toMatchObject({ ok: false, error: 'auth.errors.emailInvalid' })
    const { token } = await createInvite(db, admin, { role: 'employee' })
    expect(await register(db, { name: 'A', email: 'a@example.com', password: 'short', invite: token })).toMatchObject({ ok: false, error: 'auth.errors.passwordShort' })
  })

  it('enforces the optional email domain restriction', async () => {
    const { db } = await withAdmin()
    expect(await register(db, { name: 'A', email: 'a@other.test', password: PASS }, { allowedDomain: 'example.com' })).toMatchObject({ ok: false, error: 'auth.register.domainRejected' })
    expect(await register(db, { name: 'A', email: 'a@example.com', password: PASS }, { allowedDomain: '@example.com' })).toMatchObject({ ok: true, outcome: 'pending' })
  })

  it('allows passwordless registration in magic link mode', async () => {
    const { db } = await withAdmin()
    const r = await register(db, { name: 'Can Test', email: 'can@example.com' }, { passwordRequired: false })
    expect(r).toMatchObject({ ok: true, outcome: 'pending' })
    expect(await db.prepare(`SELECT password_hash FROM users WHERE email = 'can@example.com'`).first()).toEqual({ password_hash: null })
  })
})

describe('invitations', () => {
  it('activates the invited account with the chosen role and works only once', async () => {
    const { db, admin } = await withAdmin()
    const { token } = await createInvite(db, admin, { role: 'approver' })
    const r = await register(db, { name: 'Can Test', email: 'can@example.com', password: PASS, invite: token })
    expect(r).toMatchObject({ ok: true, outcome: 'active' })
    expect(await db.prepare(`SELECT status, role, is_admin FROM users WHERE email = 'can@example.com'`).first()).toEqual({ status: 'active', role: 'approver', is_admin: 0 })
    expect(await login(db, 'can@example.com', PASS)).toMatchObject({ ok: true })
    expect(await register(db, { name: 'Ada Test', email: 'ada@example.com', password: PASS, invite: token })).toMatchObject({ ok: false, error: 'auth.register.inviteInvalid' })
  })

  it('rejects expired invitations and email mismatches', async () => {
    const { db, admin } = await withAdmin()
    const old = await createInvite(db, admin, { role: 'employee' }, new Date(Date.now() - 8 * 24 * 3600_000))
    expect(await register(db, { name: 'A', email: 'a@example.com', password: PASS, invite: old.token })).toMatchObject({ ok: false, error: 'auth.register.inviteInvalid' })
    const bound = await createInvite(db, admin, { role: 'employee', email: 'b@example.com' })
    expect(await register(db, { name: 'C', email: 'c@example.com', password: PASS, invite: bound.token })).toMatchObject({ ok: false, error: 'auth.register.inviteEmail' })
  })

  it('invalidates an unverified pending registration for the invited address', async () => {
    const { db, admin } = await withAdmin()
    const squatter = await register(db, { name: 'Imposter', email: 'mina@example.com', password: PASS })
    if (!squatter.ok) throw new Error('register failed')
    const { token } = await createInvite(db, admin, { role: 'employee', email: 'mina@example.com' })
    expect(await db.prepare(`SELECT status, email LIKE '%@superseded.invalid' AS gone FROM users WHERE id = ?`).bind(squatter.userId).first()).toEqual({ status: 'inactive', gone: 1 })
    const r = await register(db, { name: 'Mina Deneme', email: 'mina@example.com', password: PASS, invite: token })
    expect(r).toMatchObject({ ok: true, outcome: 'active' })
    expect(await db.prepare(`SELECT email_verified_at IS NOT NULL AS v FROM users WHERE email = 'mina@example.com'`).first()).toEqual({ v: 1 })
  })

  it('lets an administrator revoke unused invite and reset links', async () => {
    const { db, admin, adminId } = await withAdmin()
    const inv = await createInvite(db, admin, { role: 'employee' })
    const reset = await createResetToken(db, adminId)
    const open = await openTokens(db)
    expect(open.map((x) => x.kind).sort()).toEqual(['invite', 'reset'])
    for (const x of open) expect(await revokeToken(db, admin, x.id)).toBe(true)
    expect(await openTokens(db)).toEqual([])
    expect(await register(db, { name: 'A', email: 'a@example.com', password: PASS, invite: inv.token })).toMatchObject({ ok: false, error: 'auth.register.inviteInvalid' })
    expect(await setPasswordFromReset(db, reset.token, 'fresh password 1')).toMatchObject({ ok: false })
  })
})

describe('sessions', () => {
  it('stores only a hash of the token and resolves the user', async () => {
    const { db, adminId } = await withAdmin()
    const token = await createSession(db, adminId)
    expect(token.length).toBeGreaterThanOrEqual(43)
    const stored = await db.prepare(`SELECT id FROM sessions`).first<{ id: string }>()
    expect(stored!.id).toHaveLength(64)
    expect(stored!.id).not.toContain(token)
    expect((await sessionUser(db, token))?.user.id).toBe(adminId)
    expect(await sessionUser(db, 'forged-token')).toBeNull()
  })

  it('drops the session as soon as the user is deactivated', async () => {
    const { db, adminId } = await withAdmin()
    const token = await createSession(db, adminId)
    await db.prepare(`UPDATE users SET status = 'inactive', deactivated_at = ? WHERE id = ?`).bind(new Date().toISOString(), adminId).run()
    expect(await sessionUser(db, token)).toBeNull()
    expect(await count(db, `SELECT COUNT(*) AS n FROM sessions`)).toBe(0)
  })

  it('expires after 30 days and slides forward when used', async () => {
    const { db, adminId } = await withAdmin()
    const t0 = new Date('2030-01-01T00:00:00Z')
    const token = await createSession(db, adminId, {}, t0)
    const later = new Date(t0.getTime() + 10 * 24 * 3600_000)
    expect((await sessionUser(db, token, later))?.refreshed).toBe(true)
    const exp = (await db.prepare(`SELECT expires_at FROM sessions`).first<{ expires_at: string }>())!.expires_at
    expect(exp).toBe(new Date(later.getTime() + SESSION_TTL_MS).toISOString())
    expect(await sessionUser(db, token, new Date(later.getTime() + SESSION_TTL_MS + 1000))).toBeNull()
  })

  it('signs out every session and cancels email approval links when the password changes', async () => {
    const { db, adminId } = await withAdmin()
    const a = await createSession(db, adminId)
    const b = await createSession(db, adminId)
    await db.prepare(`INSERT INTO action_tokens (id, token_hash, entity_type, entity_id, user_id, expires_at) VALUES (?, ?, 'request', ?, ?, ?)`).bind('9'.repeat(26), 'a'.repeat(64), '8'.repeat(26), adminId, new Date(Date.now() + 3600_000).toISOString()).run()
    expect(await changePassword(db, adminId, 'wrong password!', 'new password 123')).toMatchObject({ ok: false, error: 'auth.change.wrongCurrent' })
    expect(await changePassword(db, adminId, PASS, 'new password 123')).toEqual({ ok: true })
    expect(await sessionUser(db, a)).toBeNull()
    expect(await sessionUser(db, b)).toBeNull()
    expect(await count(db, `SELECT COUNT(*) AS n FROM action_tokens WHERE used_at IS NULL`)).toBe(0)
    expect(await login(db, 'deniz@example.com', 'new password 123')).toMatchObject({ ok: true })
  })
})

describe('password reset', () => {
  it('is single use, clears sessions and sets the new password', async () => {
    const { db, adminId } = await withAdmin()
    const session = await createSession(db, adminId)
    const { token } = await createResetToken(db, adminId)
    expect(await setPasswordFromReset(db, token, 'fresh password 1')).toEqual({ ok: true, userId: adminId })
    expect(await sessionUser(db, session)).toBeNull()
    expect(await setPasswordFromReset(db, token, 'fresh password 2')).toMatchObject({ ok: false, error: 'auth.reset.invalid' })
    expect(await login(db, 'deniz@example.com', 'fresh password 1')).toMatchObject({ ok: true })
  })

  it('expires after one hour and a newer token replaces older ones', async () => {
    const { db, adminId } = await withAdmin()
    const t0 = new Date()
    const { token } = await createResetToken(db, adminId, { now: t0 })
    expect(await setPasswordFromReset(db, token, 'fresh password 1', { now: new Date(t0.getTime() + 61 * 60_000) })).toMatchObject({ ok: false, error: 'auth.reset.invalid' })
    const first = await createResetToken(db, adminId)
    const second = await createResetToken(db, adminId)
    expect(await setPasswordFromReset(db, first.token, 'fresh password 1')).toMatchObject({ ok: false })
    expect(await setPasswordFromReset(db, second.token, 'fresh password 1')).toMatchObject({ ok: true })
  })
})

describe('magic links', () => {
  it('signs in once and expires after 15 minutes', async () => {
    const { db, adminId } = await withAdmin()
    const t0 = new Date()
    const a = await requestMagicLink(db, 'Deniz@example.com', t0)
    expect(a?.userId).toBe(adminId)
    expect(await consumeMagicLink(db, a!.token, new Date(t0.getTime() + 16 * 60_000))).toMatchObject({ ok: false, error: 'auth.magic.invalid' })
    const b = await requestMagicLink(db, 'deniz@example.com')
    expect(await consumeMagicLink(db, b!.token)).toEqual({ ok: true, userId: adminId })
    expect(await consumeMagicLink(db, b!.token)).toMatchObject({ ok: false })
    expect(await requestMagicLink(db, 'nobody@example.com')).toBeNull()
  })

  it('is refused for pending or inactive users', async () => {
    const { db } = await withAdmin()
    await register(db, { name: 'Ece Demo', email: 'ece@example.com', password: PASS })
    expect(await requestMagicLink(db, 'ece@example.com')).toBeNull()
  })
})

describe('HTTP layer', () => {
  const sent: { to: string; subject: string; text: string }[] = []
  const mailer = { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }
  const deps = (db: AuthDeps['db'], over: Partial<AuthDeps> = {}): AuthDeps => ({ db, app: 'Test Panel', allowedDomain: '', mailer: null, panelUrl: '', defer: (p) => void p, ...over })
  const post = (path: string, body: Record<string, string> | string, headers: Record<string, string> = {}) =>
    new Request(`https://panel.example.com${path}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : new URLSearchParams(body),
      headers: { Origin: 'https://panel.example.com', Host: 'panel.example.com', 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    })
  const run = (req: Request, d: AuthDeps) => handleAuthRoute(req, new URL(req.url), d)

  it('rejects cross-site POSTs (CSRF)', async () => {
    const { db } = await withAdmin()
    const res = await run(post('/login', { email: 'deniz@example.com', password: PASS }, { Origin: 'https://evil.example' }), deps(db))
    expect(res!.status).toBe(403)
    expect(res!.headers.get('Set-Cookie')).toBeNull()
    const noOrigin = new Request('https://panel.example.com/login', { method: 'POST', body: new URLSearchParams({ email: 'x' }) })
    expect(sameOrigin(noOrigin, new URL(noOrigin.url))).toBe(false)
    const sameSite = new Request('https://panel.example.com/login', { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } })
    expect(sameOrigin(sameSite, new URL(sameSite.url))).toBe(true)
  })

  it('signs in with a secure, HttpOnly session cookie', async () => {
    const { db } = await withAdmin()
    const res = await run(post('/login?next=/requests', { email: 'deniz@example.com', password: PASS }), deps(db))
    expect(res!.status).toBe(303)
    expect(res!.headers.get('Location')).toBe('/requests')
    const cookie = res!.headers.get('Set-Cookie')!
    expect(cookie).toMatch(/^__Host-session=/)
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(cookie).toContain(part)
  })

  it('uses one generic message for unknown emails and wrong passwords', async () => {
    const { db } = await withAdmin()
    const ta = await (await run(post('/login', { email: 'nobody@example.com', password: PASS }, { 'Accept-Language': 'en' }), deps(db)))!.text()
    const tb = await (await run(post('/login', { email: 'deniz@example.com', password: 'wrong password!' }, { 'Accept-Language': 'en' }), deps(db)))!.text()
    expect(ta).toContain('Email or password is incorrect.')
    expect(tb).toContain('Email or password is incorrect.')
  })

  it('rate limits by IP and by the IP and email pair', async () => {
    const { db } = await withAdmin()
    const keys: string[] = []
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: !key.startsWith('ipemail:') }) }
    const res = await run(post('/login', { email: 'Deniz@example.com', password: PASS }, { 'CF-Connecting-IP': '203.0.113.7', 'Accept-Language': 'en' }), deps(db, { limiter }))
    expect(res!.status).toBe(400)
    expect(await res!.text()).toContain('Too many attempts')
    expect(keys).toEqual(['ip:203.0.113.7', 'ipemail:203.0.113.7|deniz@example.com'])
  })

  it('caps the form body by bytes actually read, whatever Content-Length says', async () => {
    const big = `email=${'a'.repeat(MAX_FORM_BYTES)}&password=x`
    expect(await readLimitedForm(post('/login', big, { 'Content-Length': '20' }))).toBeNull()
    expect(await readLimitedForm(post('/login', { email: 'a@example.com' }))).toEqual({ email: 'a@example.com' })
    const { db } = await withAdmin()
    const res = await run(post('/login', big, { 'Content-Length': '20' }), deps(db))
    expect(res!.status).toBe(413)
  })

  it('answers malformed token paths with 400', async () => {
    const { db } = await withAdmin()
    for (const path of ['/reset/%E0%A4%A', '/verify/%E0%A4%A', '/magic/%E0%A4%A']) {
      const req = new Request(`https://panel.example.com${path}`)
      expect((await run(req, deps(db)))!.status).toBe(400)
    }
  })

  it('changes language only by same-origin POST', async () => {
    const { db } = await withAdmin()
    const get = new Request('https://panel.example.com/lang?to=tr&next=/')
    expect((await run(get, deps(db)))!.status).toBe(405)
    const res = await run(post('/lang', { to: 'tr', next: '/requests' }), deps(db))
    expect(res!.status).toBe(303)
    expect(res!.headers.get('Location')).toBe('/requests')
    expect(res!.headers.get('Set-Cookie')).toContain('lang=tr')
    expect((await run(post('/lang', { to: 'tr', next: '//evil.example' }), deps(db)))!.headers.get('Location')).toBe('/')
  })

  it('registers through the ADMIN_EMAIL flow and mails the verification link', async () => {
    const db = testDb()
    sent.length = 0
    const d = deps(db, { adminEmail: 'owner@example.com', mailer, mailDelivers: false })
    const res = await run(post('/register', { name: 'Deniz Örnek', email: 'owner@example.com', password: PASS }, { 'Accept-Language': 'en' }), d)
    expect(res!.status).toBe(200)
    expect(await res!.text()).toContain('written to the Worker log')
    expect(sent).toHaveLength(1)
    const link = sent[0].text.match(/https:\/\/panel\.example\.com\/verify\/(\S+)/)!
    const form = await run(new Request(`https://panel.example.com/verify/${link[1]}`, { headers: { 'Accept-Language': 'en' } }), d)
    expect(await form!.text()).toContain('name="password"')
    expect(await db.prepare(`SELECT status FROM users`).first()).toEqual({ status: 'pending' })
    const verified = await run(post(`/verify/${link[1]}`, { password: PASS }, { 'Accept-Language': 'en' }), d)
    expect(await verified!.text()).toContain('administrator account is active')
    expect(await login(db, 'owner@example.com', PASS)).toMatchObject({ ok: true })
  })

  it('offers magic links only when email can be delivered', async () => {
    const { db, adminId } = await withAdmin()
    sent.length = 0
    const off = await run(post('/magic', { email: 'deniz@example.com' }), deps(db, { mode: 'magic_link', mailer: null }))
    expect(off!.status).toBe(503)
    const d = deps(db, { mode: 'magic_link', mailer, mailDelivers: true })
    expect((await run(post('/login', { email: 'deniz@example.com', password: PASS }), d))!.status).toBe(400)
    await run(post('/magic', { email: 'deniz@example.com' }), d)
    const token = sent[0].text.match(/\/magic\/(\S+)/)![1]
    expect((await run(new Request(`https://panel.example.com/magic/${token}`), d))!.status).toBe(200)
    const signed = await run(post(`/magic/${token}`, {}), d)
    expect(signed!.status).toBe(303)
    expect(signed!.headers.get('Set-Cookie')).toMatch(/^__Host-session=/)
    expect((await sessionUser(db, decodeURIComponent(signed!.headers.get('Set-Cookie')!.split(';')[0].split('=')[1])))?.user.id).toBe(adminId)
    expect((await run(post(`/magic/${token}`, {}), d))!.status).toBe(400)
  })

  it('keeps redirects inside the panel', () => {
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/login', '/logout', '/\t/evil.example', '/reset/abc'])
      expect(safeNext(bad)).toBe('/')
    expect(safeNext('/requests/01ABC?tab=x')).toBe('/requests/01ABC?tab=x')
  })
})

describe('i18n', () => {
  it('picks the locale from user, cookie, then Accept-Language', () => {
    expect(pickLocale({ user: 'tr', cookie: 'en' })).toBe('tr')
    expect(pickLocale({ cookie: 'tr', acceptLanguage: 'en' })).toBe('tr')
    expect(pickLocale({ acceptLanguage: 'de-DE,tr;q=0.8,en;q=0.5' })).toBe('tr')
    expect(pickLocale({ acceptLanguage: 'de-DE' })).toBe('en')
  })

  it('translates with parameters in both languages', () => {
    expect(translate('en', 'auth.errors.passwordShort', { min: 10 })).toBe('Password must be at least 10 characters.')
    expect(translate('tr', 'auth.errors.passwordShort', { min: 10 })).toBe('Şifre en az 10 karakter olmalı.')
  })
})

describe('user administration', () => {
  async function pendingUser() {
    const { setup } = await import('./testkit')
    const manage = await import('./services/manage')
    const s = setup()
    const r = await register(s.db, { name: 'Ece Demo', email: 'ece.demo@example.com', password: PASS })
    if (!r.ok || !r.userId) throw new Error('register failed')
    const base = { id: r.userId, displayName: 'Ece Demo', email: 'ece.demo@example.com', canLogin: true, isAdmin: false, canUploadInvoices: false, canManageJobs: false, leaveEntitlement: 14, role: 'approver' }
    return { s, manage, id: r.userId, verifyToken: r.verifyToken!, base }
  }

  it('does not approve an unverified account while email delivery works', async () => {
    const { s, manage, verifyToken, base } = await pendingUser()
    await expect(manage.saveUser(s.ctx('employeeA'), { ...base, status: 'active' }, '', { mailDelivers: true })).rejects.toThrow()
    expect(await manage.saveUser(s.ctx('manager'), { ...base, status: 'active' }, '', { mailDelivers: true })).toMatchObject({ ok: false, error: translate('tr', 'users.approve.unverified') })
    expect(await verifyEmail(s.db, verifyToken, { password: PASS })).toMatchObject({ ok: true })
    expect(await manage.saveUser(s.ctx('manager'), { ...base, status: 'active' }, '', { mailDelivers: true })).toMatchObject({ ok: true, user: { status: 'active', role: 'approver', emailVerified: true } })
  })

  it('needs an explicit confirmation to approve an unverified account when email is not delivered', async () => {
    const { s, manage, id, base } = await pendingUser()
    expect(await manage.saveUser(s.ctx('manager'), { ...base, status: 'active' }, '', { mailDelivers: false })).toMatchObject({ ok: false })
    expect(await manage.saveUser(s.ctx('manager'), { ...base, status: 'active', approveUnverified: true }, '', { mailDelivers: false })).toMatchObject({ ok: true })
    expect(await s.db.prepare(`SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'user.%'`).bind(id).first()).toEqual({ action: 'user.approve' })
  })

  it('signs a user out as soon as an admin deactivates them', async () => {
    const { s, manage, id, base } = await pendingUser()
    await manage.saveUser(s.ctx('manager'), { ...base, status: 'active', approveUnverified: true }, '')
    expect(await login(s.db, 'ece.demo@example.com', PASS)).toMatchObject({ ok: false })
    const reset = await createResetToken(s.db, id, { createdBy: s.users.manager.id })
    expect(await setPasswordFromReset(s.db, reset.token, PASS)).toMatchObject({ ok: true })
    expect(await login(s.db, 'ece.demo@example.com', PASS)).toMatchObject({ ok: true })
    const token = await createSession(s.db, id)
    expect(await sessionUser(s.db, token)).not.toBeNull()
    expect(await manage.saveUser(s.ctx('manager'), { ...base, status: 'inactive' }, '')).toMatchObject({ ok: true })
    expect(await count(s.db, `SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`, id)).toBe(0)
    expect(await sessionUser(s.db, token)).toBeNull()
  })
})

describe('pre-registration takeover regression', () => {
  it('ignores passwords at registration so a squatter cannot pre-set the account password', async () => {
    const db = testDb()
    const opts = { adminEmail: 'owner@example.com' }
    const squatter = await register(db, { name: 'Real Owner', email: 'owner@example.com', password: 'attacker password 1' }, opts)
    expect(squatter).toMatchObject({ ok: true, outcome: 'verify' })
    if (!squatter.ok) return
    expect(await db.prepare(`SELECT password_hash FROM users WHERE email = 'owner@example.com'`).first()).toEqual({ password_hash: null })
    const real = await register(db, { name: 'Real Owner', email: 'owner@example.com', password: 'ignored as well' }, opts)
    if (!real.ok) throw new Error('register failed')
    expect(await verifyEmail(db, squatter.verifyToken!, { password: 'attacker password 1' })).toMatchObject({ ok: false, error: 'auth.verify.invalid' })
    expect(await login(db, 'owner@example.com', 'attacker password 1')).toMatchObject({ ok: false })
    expect(await verifyEmail(db, real.verifyToken!, { password: 'real owner password' })).toMatchObject({ ok: true, activated: true })
    expect(await login(db, 'owner@example.com', 'real owner password')).toMatchObject({ ok: true })
    expect(await login(db, 'owner@example.com', 'attacker password 1')).toMatchObject({ ok: false })
    expect(await db.prepare(`SELECT is_admin, role, status FROM users WHERE email = 'owner@example.com'`).first()).toEqual({ is_admin: 1, role: 'owner', status: 'active' })
  })

  it('gives a later open registration for an unverified address a fresh link instead of a silent dead end', async () => {
    const { db } = await withAdmin()
    const first = await register(db, { name: 'Squatter', email: 'mina@example.com' })
    const second = await register(db, { name: 'Mina Deneme', email: 'mina@example.com' })
    if (!first.ok || !second.ok) throw new Error('register failed')
    expect(second.verifyToken).toBeTruthy()
    expect(await verifyEmail(db, first.verifyToken!, { password: PASS })).toMatchObject({ ok: false })
    expect(await verifyEmail(db, second.verifyToken!, { password: PASS })).toMatchObject({ ok: true })
    expect(await db.prepare(`SELECT display_name, status FROM users WHERE email = 'mina@example.com'`).first()).toEqual({ display_name: 'Mina Deneme', status: 'pending' })
  })

  it('does not consume a verification link on GET', async () => {
    const { db } = await withAdmin()
    const r = await register(db, { name: 'Can Test', email: 'can@example.com' })
    if (!r.ok) throw new Error('register failed')
    const req = new Request(`https://panel.example.com/verify/${r.verifyToken}`)
    await handleAuthRoute(req, new URL(req.url), { db, app: 'Test Panel', allowedDomain: '', mailer: null, panelUrl: '', defer: () => {} })
    expect(await verifyEmail(db, r.verifyToken!, { password: PASS })).toMatchObject({ ok: true })
  })

  it('cancels open magic and reset links when the password changes', async () => {
    const { db, adminId } = await withAdmin()
    const magic = await requestMagicLink(db, 'deniz@example.com')
    const reset = await createResetToken(db, adminId)
    expect(await changePassword(db, adminId, PASS, 'new password 123')).toEqual({ ok: true })
    expect(await consumeMagicLink(db, magic!.token)).toMatchObject({ ok: false })
    expect(await setPasswordFromReset(db, reset.token, 'another password 1')).toMatchObject({ ok: false })
  })

  it('treats a placeholder PANEL_URL as unset', async () => {
    const { cleanPanelUrl } = await import('#/config/brand')
    expect(cleanPanelUrl('https://<your-panel-domain>')).toBe('')
    expect(cleanPanelUrl('https://panel.example.com/x')).toBe('https://panel.example.com')
  })
})

describe('finance settings permissions', () => {
  it('lets only administrators change stored exchange rates and VAT rates', async () => {
    const { setup } = await import('./testkit')
    const manage = await import('./services/manage')
    const s = setup()
    const input = { rates: { USD: 40, EUR: 45 }, vatRates: [0, 10, 20] }
    await expect(manage.saveFx(s.ctx('manager2'), input)).rejects.toThrow()
    await expect(manage.saveFx(s.ctx('approver'), input)).rejects.toThrow()
    expect(await manage.saveFx(s.ctx('manager'), input)).toEqual({ ok: true })
  })
})
