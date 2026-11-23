import { normalizeEmail } from '#/lib/email'
import type { MessageKey } from '#/i18n'
import { isLocale, type Locale } from '#/i18n/locales'
import type { Role } from '#/lib/permissions'
import { hashToken } from '../actionToken'
import { audit, ulid, type Db, type Stmt } from '../db/d1'
import { toAuthUser, type UserRow } from '../db/users'
import type { AuthUser } from './authorize'
import { constantTimeEqual, hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, needsRehash, PBKDF2_ITERATIONS, verifyPassword } from './password'

export const SESSION_TTL_MS = 30 * 24 * 3600_000
export const SESSION_REFRESH_MS = 24 * 3600_000
export const INVITE_TTL_MS = 7 * 24 * 3600_000
export const RESET_TTL_MS = 3600_000
export const ADMIN_RESET_TTL_MS = 24 * 3600_000
export const VERIFY_TTL_MS = 24 * 3600_000
export const MAGIC_TTL_MS = 15 * 60_000

export const OWNER_ROLE: Role = 'owner'
export const DEFAULT_ROLE: Role = 'employee'

const EMAIL_FORMAT = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i

export type TokenKind = 'invite' | 'reset' | 'verify' | 'magic'

export type AuthError = { ok: false; error: MessageKey; field?: 'name' | 'email' | 'password' | 'invite' | 'setup'; params?: Record<string, string | number> }

const err = (error: MessageKey, field?: AuthError['field'], params?: AuthError['params']): AuthError => ({ ok: false, error, field, params })

export const randomToken = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const iso = (d: Date) => d.toISOString()
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const enc = new TextEncoder()

export function emailAllowed(email: string, allowedDomain: string | undefined): boolean {
  const d = (allowedDomain ?? '').trim().toLowerCase().replace(/^@/, '')
  return !d || email.endsWith(`@${d}`)
}

export const validEmail = (email: string) => EMAIL_FORMAT.test(email) && email.length <= 200

function checkPassword(password: string): AuthError | null {
  if (password.length < MIN_PASSWORD_LENGTH) return err('auth.errors.passwordShort', 'password', { min: MIN_PASSWORD_LENGTH })
  if (password.length > MAX_PASSWORD_LENGTH) return err('auth.errors.passwordLong', 'password')
  return null
}

export const hasActiveAdmin = async (db: Db) => !!(await db.prepare(`SELECT 1 AS x FROM users WHERE is_admin = 1 AND status = 'active' LIMIT 1`).first<{ x: number }>())

export interface SetupConfig {
  adminEmail?: string
  setupToken?: string
}

export const setupConfigured = (s: SetupConfig) => !!((s.adminEmail ?? '').trim() || (s.setupToken ?? '').trim())

export function setupTokenMatches(expected: string | undefined, given: string | undefined): boolean {
  const e = (expected ?? '').trim()
  if (!e || !given) return false
  return constantTimeEqual(enc.encode(e), enc.encode(given.trim()))
}

interface TokenRow {
  id: string
  kind: TokenKind
  user_id: string | null
  email: string | null
  role: Role | null
  expires_at: string
  used_at: string | null
}

export async function findToken(db: Db, kind: TokenKind, raw: string, now = new Date()): Promise<TokenRow | null> {
  if (!raw || raw.length > 100) return null
  const row = await db
    .prepare(`SELECT id, kind, user_id, email, role, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = ?`)
    .bind(await hashToken(raw), kind)
    .first<TokenRow>()
  if (!row || row.used_at || row.expires_at <= iso(now)) return null
  return row
}

async function issueUserToken(db: Db, kind: 'reset' | 'verify' | 'magic', userId: string, ttlMs: number, opts: { createdBy?: string | null; now?: Date } = {}): Promise<{ token: string; expiresAt: string; stmts: Stmt[] }> {
  const now = opts.now ?? new Date()
  const raw = randomToken()
  const expiresAt = iso(new Date(now.getTime() + ttlMs))
  return {
    token: raw,
    expiresAt,
    stmts: [
      db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE kind = ? AND user_id = ? AND used_at IS NULL`).bind(iso(now), kind, userId),
      db.prepare(`INSERT INTO auth_tokens (id, token_hash, kind, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(ulid(), await hashToken(raw), kind, userId, opts.createdBy ?? null, iso(now), expiresAt),
    ],
  }
}

export interface RegisterInput {
  name: string
  email: string
  password?: string
  invite?: string
  setupToken?: string
  locale?: Locale
}

export interface RegisterOptions extends SetupConfig {
  allowedDomain?: string
  iterations?: number
  passwordRequired?: boolean
  now?: Date
}

export type RegisterResult =
  | { ok: true; outcome: 'admin' | 'active' | 'pending' | 'verify'; userId: string | null; verifyToken: string | null; passwordToken?: string }
  | AuthError

export async function register(db: Db, input: RegisterInput, opts: RegisterOptions = {}): Promise<RegisterResult> {
  const now = opts.now ?? new Date()
  const at = iso(now)
  const name = input.name.replace(/\s+/g, ' ').trim()
  const email = normalizeEmail(input.email)
  const passwordRequired = opts.passwordRequired !== false && !!input.invite
  const password = input.invite ? (input.password ?? '') : ''
  if (!name || name.length > 60) return err('auth.errors.nameRequired', 'name')
  if (!validEmail(email)) return err('auth.errors.emailInvalid', 'email')
  if (passwordRequired) {
    const bad = checkPassword(password)
    if (bad) return bad
  }
  const domain = (opts.allowedDomain ?? '').trim().toLowerCase().replace(/^@/, '')
  if (!emailAllowed(email, domain)) return err('auth.register.domainRejected', 'email', { domain })

  const hash = passwordRequired ? await hashPassword(password, opts.iterations ?? PBKDF2_ITERATIONS) : await hashPassword(randomToken(), opts.iterations ?? PBKDF2_ITERATIONS).then(() => null)
  const locale = isLocale(input.locale) ? input.locale : null
  const id = ulid()
  const hue = hueOf(name)

  const bootstrap = !(await hasActiveAdmin(db))
  if (bootstrap && !input.invite) {
    if (!setupConfigured(opts)) return err('auth.setup.missing')
    const byToken = setupTokenMatches(opts.setupToken, input.setupToken)
    const byEmail = !byToken && !!opts.adminEmail && normalizeEmail(opts.adminEmail) === email
    if (!byToken && !byEmail) return err(input.setupToken ? 'auth.setup.badToken' : 'auth.setup.closed', input.setupToken ? 'setup' : 'email')
    const existing = await db.prepare(`SELECT id, status FROM users WHERE email = ?`).bind(email).first<{ id: string; status: string }>()
    if (existing && existing.status !== 'pending') return err('auth.register.failed', 'email')
    const stmts: Stmt[] = []
    if (existing) stmts.push(db.prepare(`UPDATE users SET email = lower(id) || '@superseded.invalid', status = 'inactive', deactivated_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).bind(at, at, existing.id))
    stmts.push(
      db
        .prepare(
          `INSERT INTO users (id, email, full_name, display_name, role, is_admin, status, password_hash, password_changed_at, avatar_hue, locale, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1 AND status = 'active')`,
        )
        .bind(id, email, name, name, OWNER_ROLE, byToken ? 'active' : 'pending', hash, hash ? at : null, hue, locale, at, at),
      audit(db, { actorId: null, actorEmail: email, action: 'auth.register', entityType: 'user', entityId: id, meta: { via: byToken ? 'setup_token' : 'admin_email' } }),
    )
    const verify = await issueUserToken(db, byToken ? 'reset' : 'verify', id, byToken ? RESET_TTL_MS : VERIFY_TTL_MS, { now })
    stmts.push(...verify.stmts)
    const res = await db.batch(stmts)
    if (res[existing ? 1 : 0].meta.changes !== 1) return err('auth.register.failed', 'email')
    return byToken ? { ok: true, outcome: 'admin', userId: id, verifyToken: null, passwordToken: verify.token } : { ok: true, outcome: 'verify', userId: id, verifyToken: verify.token }
  }

  const invite = input.invite ? await findToken(db, 'invite', input.invite, now) : null
  if (input.invite && !invite) return err('auth.register.inviteInvalid', 'invite')
  if (invite?.email && invite.email !== email) return err('auth.register.inviteEmail', 'email')

  const existing = await db.prepare(`SELECT id, status, email_verified_at FROM users WHERE email = ?`).bind(email).first<{ id: string; status: string; email_verified_at: string | null }>()
  const stale = !!existing && !invite && existing.status === 'pending' && !existing.email_verified_at
  if (existing && !stale) return invite ? err('auth.register.failed', 'email') : { ok: true, outcome: 'pending', userId: null, verifyToken: null }

  const stmts: Stmt[] = []
  if (stale) stmts.push(db.prepare(`UPDATE users SET email = lower(id) || '@superseded.invalid', status = 'inactive', deactivated_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND email_verified_at IS NULL`).bind(at, at, existing!.id))
  let verifyToken: string | null = null
  if (invite) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO users (id, email, full_name, display_name, role, status, password_hash, password_changed_at, email_verified_at, avatar_hue, locale, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?)`,
        )
        .bind(id, email, name, name, invite.role, hash, hash ? at : null, invite.email ? at : null, hue, locale, at, at, invite.id, at),
      db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?)`).bind(at, invite.id, id),
      audit(db, { actorId: null, actorEmail: email, action: 'auth.register', entityType: 'user', entityId: id, meta: { via: 'invite', invite: invite.id } }),
    )
    if (!invite.email) {
      const v = await issueUserToken(db, 'verify', id, VERIFY_TTL_MS, { now })
      verifyToken = v.token
      stmts.push(...v.stmts)
    }
  } else {
    stmts.push(
      db
        .prepare(
          `INSERT INTO users (id, email, full_name, display_name, role, status, password_hash, password_changed_at, avatar_hue, locale, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, email, name, name, DEFAULT_ROLE, hash, hash ? at : null, hue, locale, at, at),
      audit(db, { actorId: null, actorEmail: email, action: 'auth.register', entityType: 'user', entityId: id, meta: { via: 'open' } }),
    )
    const v = await issueUserToken(db, 'verify', id, VERIFY_TTL_MS, { now })
    verifyToken = v.token
    stmts.push(...v.stmts)
  }
  try {
    const res = await db.batch(stmts)
    if (res[stale ? 1 : 0].meta.changes !== 1) return err(invite ? 'auth.register.inviteInvalid' : 'auth.register.failed', 'invite')
  } catch (e) {
    if (/UNIQUE/i.test(e instanceof Error ? e.message : String(e))) return invite ? err('auth.register.failed', 'email') : { ok: true, outcome: 'pending', userId: null, verifyToken: null }
    throw e
  }
  return { ok: true, outcome: invite ? 'active' : 'pending', userId: id, verifyToken }
}

export interface VerifyTarget {
  tokenId: string
  userId: string
  email: string
  name: string
  hasPassword: boolean
  locale: Locale | null
}

export async function verifyTarget(db: Db, raw: string, now = new Date()): Promise<VerifyTarget | null> {
  const tok = await findToken(db, 'verify', raw, now)
  if (!tok?.user_id) return null
  const u = await db.prepare(`SELECT id, email, display_name, status, password_hash, locale FROM users WHERE id = ?`).bind(tok.user_id).first<{ id: string; email: string; display_name: string; status: string; password_hash: string | null; locale: string | null }>()
  if (!u || u.status === 'inactive') return null
  return { tokenId: tok.id, userId: u.id, email: u.email, name: u.display_name, hasPassword: !!u.password_hash, locale: isLocale(u.locale) ? u.locale : null }
}

export type VerifyResult = { ok: true; userId: string; activated: boolean; active: boolean; email: string; name: string; locale: Locale | null } | AuthError

export async function verifyEmail(db: Db, raw: string, opts: { password?: string; passwordRequired?: boolean; iterations?: number; now?: Date } = {}): Promise<VerifyResult> {
  const now = opts.now ?? new Date()
  const target = await verifyTarget(db, raw, now)
  if (!target) return err('auth.verify.invalid')
  const setPassword = opts.passwordRequired !== false && !target.hasPassword
  if (setPassword) {
    const bad = checkPassword(opts.password ?? '')
    if (bad) return bad
  }
  const at = iso(now)
  const hash = setPassword ? await hashPassword(opts.password!, opts.iterations ?? PBKDF2_ITERATIONS) : null
  const res = await db.batch([
    db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?`).bind(at, target.tokenId, at),
    db
      .prepare(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), password_hash = COALESCE(?, password_hash), password_changed_at = CASE WHEN ? IS NULL THEN password_changed_at ELSE ? END, updated_at = ? WHERE id = ? AND status <> 'inactive' AND EXISTS (SELECT 1 FROM auth_tokens WHERE id = ? AND used_at = ?)`)
      .bind(at, hash, hash, at, at, target.userId, target.tokenId, at),
    db
      .prepare(`UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending' AND is_admin = 1 AND email_verified_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1 AND status = 'active')`)
      .bind(at, target.userId),
    audit(db, { actorId: target.userId, action: 'auth.email_verified', entityType: 'user', entityId: target.userId, meta: { passwordSet: !!hash } }),
  ])
  if (res[0].meta.changes !== 1 || res[1].meta.changes !== 1) return err('auth.verify.invalid')
  const st = await db.prepare(`SELECT status FROM users WHERE id = ?`).bind(target.userId).first<{ status: string }>()
  return { ok: true, userId: target.userId, activated: res[2].meta.changes === 1, active: st?.status === 'active', email: target.email, name: target.name, locale: target.locale }
}

const USER_COLS = 'id, email, full_name, display_name, role, is_admin, can_upload_invoices, can_manage_jobs, avatar_hue, status, can_login, version, locale'

export type LoginResult = { ok: true; userId: string } | AuthError

export async function login(db: Db, emailIn: string, password: string, opts: { iterations?: number } = {}): Promise<LoginResult> {
  const email = normalizeEmail(emailIn)
  const row = validEmail(email)
    ? await db.prepare(`SELECT id, status, can_login, password_hash FROM users WHERE email = ?`).bind(email).first<{ id: string; status: string; can_login: number; password_hash: string | null }>()
    : null
  const valid = await verifyPassword(password, row?.password_hash)
  if (!row || !valid) {
    if (row) await audit(db, { actorId: row.id, actorEmail: email, action: 'auth.login_failed', entityType: 'auth' }).run()
    return err('auth.login.invalid')
  }
  if (row.status === 'pending') return err('auth.login.pending')
  if (row.status !== 'active' || row.can_login !== 1) {
    await audit(db, { actorId: row.id, actorEmail: email, action: 'auth.denied', entityType: 'auth', meta: { reason: row.status !== 'active' ? 'inactive' : 'no_login' } }).run()
    return err('auth.login.invalid')
  }
  const target = opts.iterations ?? PBKDF2_ITERATIONS
  if (needsRehash(row.password_hash, target)) {
    await db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?`).bind(await hashPassword(password, target), row.id, row.password_hash).run()
  }
  return { ok: true, userId: row.id }
}

export async function requestMagicLink(db: Db, emailIn: string, now = new Date()): Promise<{ token: string; userId: string; name: string; locale: Locale | null } | null> {
  const email = normalizeEmail(emailIn)
  if (!validEmail(email)) return null
  const u = await db.prepare(`SELECT id, display_name, locale FROM users WHERE email = ? AND status = 'active' AND can_login = 1`).bind(email).first<{ id: string; display_name: string; locale: string | null }>()
  if (!u) return null
  const t = await issueUserToken(db, 'magic', u.id, MAGIC_TTL_MS, { now })
  await db.batch([...t.stmts, audit(db, { actorId: u.id, action: 'auth.magic_issued', entityType: 'auth' })])
  return { token: t.token, userId: u.id, name: u.display_name, locale: isLocale(u.locale) ? u.locale : null }
}

export async function consumeMagicLink(db: Db, raw: string, now = new Date()): Promise<{ ok: true; userId: string } | AuthError> {
  const tok = await findToken(db, 'magic', raw, now)
  if (!tok?.user_id) return err('auth.magic.invalid')
  const at = iso(now)
  const res = await db.batch([
    db
      .prepare(`UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' AND can_login = 1)`)
      .bind(at, tok.id, at, tok.user_id),
    db.prepare(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? AND EXISTS (SELECT 1 FROM auth_tokens WHERE id = ? AND used_at = ?)`).bind(at, tok.user_id, tok.id, at),
  ])
  if (res[0].meta.changes !== 1) return err('auth.magic.invalid')
  return { ok: true, userId: tok.user_id }
}

export async function createSession(db: Db, userId: string, meta: { ip?: string | null; ua?: string | null } = {}, now = new Date()): Promise<string> {
  const raw = randomToken()
  await db.batch([
    db
      .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(await hashToken(raw), userId, iso(now), iso(new Date(now.getTime() + SESSION_TTL_MS)), meta.ip?.slice(0, 64) ?? null, meta.ua?.slice(0, 300) ?? null),
    audit(db, { actorId: userId, action: 'auth.login', entityType: 'auth', meta: { ip: meta.ip?.slice(0, 64) ?? null } }),
  ])
  return raw
}

export interface SessionInfo {
  user: AuthUser
  locale: Locale | null
  refreshed: boolean
}

export async function sessionUser(db: Db, raw: string | null | undefined, now = new Date()): Promise<SessionInfo | null> {
  if (!raw || raw.length > 100) return null
  const id = await hashToken(raw)
  const row = await db
    .prepare(`SELECT s.expires_at AS session_expires, ${USER_COLS.split(', ').map((c) => `u.${c}`).join(', ')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
    .bind(id)
    .first<UserRow & { session_expires: string; locale: string | null }>()
  if (!row) return null
  if (row.session_expires <= iso(now) || row.status !== 'active' || row.can_login !== 1) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run()
    return null
  }
  let refreshed = false
  if (Date.parse(row.session_expires) - now.getTime() < SESSION_TTL_MS - SESSION_REFRESH_MS) {
    await db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).bind(iso(new Date(now.getTime() + SESSION_TTL_MS)), id).run()
    refreshed = true
  }
  return { user: toAuthUser(row), locale: isLocale(row.locale) ? row.locale : null, refreshed }
}

export async function destroySession(db: Db, raw: string | null | undefined): Promise<void> {
  if (!raw || raw.length > 100) return
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(await hashToken(raw)).run()
}

export const dropUserSessions = (db: Db, userId: string): Stmt => db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId)

export const revokeActionTokens = (db: Db, userId: string, at: string): Stmt => db.prepare(`UPDATE action_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(at, userId)

export const revokeSignInTokens = (db: Db, userId: string, at: string): Stmt => db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind IN ('magic','reset') AND used_at IS NULL`).bind(at, userId)

export const purgeExpiredSessions = (db: Db, now = new Date()) => db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).bind(iso(now)).run()

export async function createInvite(db: Db, actor: AuthUser, input: { role: Role; email?: string | null }, now = new Date()): Promise<{ token: string; expiresAt: string }> {
  const raw = randomToken()
  const at = iso(now)
  const expiresAt = iso(new Date(now.getTime() + INVITE_TTL_MS))
  const email = input.email ? normalizeEmail(input.email) : null
  const id = ulid()
  const stmts: Stmt[] = [
    db
      .prepare(`INSERT INTO auth_tokens (id, token_hash, kind, email, role, created_by, created_at, expires_at) VALUES (?, ?, 'invite', ?, ?, ?, ?, ?)`)
      .bind(id, await hashToken(raw), email, input.role, actor.id, at, expiresAt),
    audit(db, { actorId: actor.id, action: 'auth.invite', entityType: 'auth', entityId: id, meta: { role: input.role, email } }),
  ]
  if (email) {
    stmts.push(
      db
        .prepare(`UPDATE users SET email = lower(id) || '@superseded.invalid', status = 'inactive', deactivated_at = ?, deactivated_by = ?, updated_at = ? WHERE email = ? AND status = 'pending' AND email_verified_at IS NULL`)
        .bind(at, actor.id, at, email),
    )
  }
  await db.batch(stmts)
  return { token: raw, expiresAt }
}

export async function createResetToken(db: Db, userId: string, opts: { createdBy?: string | null; ttlMs?: number; now?: Date } = {}): Promise<{ token: string; expiresAt: string }> {
  const t = await issueUserToken(db, 'reset', userId, opts.ttlMs ?? RESET_TTL_MS, opts)
  await db.batch([...t.stmts, audit(db, { actorId: opts.createdBy ?? null, action: 'auth.reset_issued', entityType: 'user', entityId: userId, meta: { by: opts.createdBy ? 'admin' : 'self' } })])
  return { token: t.token, expiresAt: t.expiresAt }
}

export interface OpenToken {
  id: string
  kind: TokenKind
  email: string | null
  role: Role | null
  userId: string | null
  userName: string | null
  createdAt: string
  expiresAt: string
}

export async function openTokens(db: Db, now = new Date()): Promise<OpenToken[]> {
  const rows = await db
    .prepare(
      `SELECT t.id, t.kind, t.email, t.role, t.user_id, u.display_name, t.created_at, t.expires_at FROM auth_tokens t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.kind IN ('invite','reset') AND t.used_at IS NULL AND t.expires_at > ? ORDER BY t.created_at DESC LIMIT 200`,
    )
    .bind(iso(now))
    .all<{ id: string; kind: TokenKind; email: string | null; role: Role | null; user_id: string | null; display_name: string | null; created_at: string; expires_at: string }>()
  return rows.results.map((r) => ({ id: r.id, kind: r.kind, email: r.email, role: r.role, userId: r.user_id, userName: r.display_name, createdAt: r.created_at, expiresAt: r.expires_at }))
}

export async function revokeToken(db: Db, actor: AuthUser, id: string, now = new Date()): Promise<boolean> {
  const res = await db.batch([
    db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE id = ? AND kind IN ('invite','reset') AND used_at IS NULL`).bind(iso(now), id),
    audit(db, { actorId: actor.id, action: 'auth.token_revoked', entityType: 'auth', entityId: id }),
  ])
  return res[0].meta.changes === 1
}

export async function resetTarget(db: Db, raw: string, now = new Date()): Promise<{ tokenId: string; userId: string; email: string; name: string; locale: Locale | null } | null> {
  const tok = await findToken(db, 'reset', raw, now)
  if (!tok?.user_id) return null
  const u = await db.prepare(`SELECT id, email, display_name, status, can_login, locale FROM users WHERE id = ?`).bind(tok.user_id).first<{ id: string; email: string; display_name: string; status: string; can_login: number; locale: string | null }>()
  if (!u || u.status !== 'active' || u.can_login !== 1) return null
  return { tokenId: tok.id, userId: u.id, email: u.email, name: u.display_name, locale: isLocale(u.locale) ? u.locale : null }
}

export async function setPasswordFromReset(db: Db, raw: string, password: string, opts: { iterations?: number; now?: Date } = {}): Promise<{ ok: true; userId: string } | AuthError> {
  const now = opts.now ?? new Date()
  const bad = checkPassword(password)
  if (bad) return bad
  const target = await resetTarget(db, raw, now)
  if (!target) return err('auth.reset.invalid')
  const at = iso(now)
  const hash = await hashPassword(password, opts.iterations ?? PBKDF2_ITERATIONS)
  const res = await db.batch([
    db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?`).bind(at, target.tokenId, at),
    db
      .prepare(`UPDATE users SET password_hash = ?, password_changed_at = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?, version = version + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM auth_tokens WHERE id = ? AND used_at = ?)`)
      .bind(hash, at, at, at, target.userId, target.tokenId, at),
    dropUserSessions(db, target.userId),
    revokeActionTokens(db, target.userId, at),
    revokeSignInTokens(db, target.userId, at),
    audit(db, { actorId: target.userId, action: 'auth.password_reset', entityType: 'user', entityId: target.userId }),
  ])
  if (res[0].meta.changes !== 1 || res[1].meta.changes !== 1) return err('auth.reset.invalid')
  return { ok: true, userId: target.userId }
}

export async function changePassword(db: Db, userId: string, current: string, next: string, opts: { iterations?: number; now?: Date } = {}): Promise<{ ok: true } | AuthError> {
  const now = opts.now ?? new Date()
  const row = await db.prepare(`SELECT password_hash FROM users WHERE id = ? AND status = 'active'`).bind(userId).first<{ password_hash: string | null }>()
  if (!(await verifyPassword(current, row?.password_hash))) return err('auth.change.wrongCurrent', 'password')
  const bad = checkPassword(next)
  if (bad) return bad
  const at = iso(now)
  await db.batch([
    db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`).bind(await hashPassword(next, opts.iterations ?? PBKDF2_ITERATIONS), at, at, userId),
    dropUserSessions(db, userId),
    revokeActionTokens(db, userId, at),
    revokeSignInTokens(db, userId, at),
    audit(db, { actorId: userId, action: 'auth.password_change', entityType: 'user', entityId: userId }),
  ])
  return { ok: true }
}

export async function setUserLocale(db: Db, userId: string, locale: Locale): Promise<void> {
  await db.prepare(`UPDATE users SET locale = ? WHERE id = ?`).bind(locale, userId).run()
}
