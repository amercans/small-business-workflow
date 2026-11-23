import type { Db } from '../db/d1'
import { findUserByEmail, toAuthUser } from '../db/users'
import type { AuthUser } from './authorize'

export const DEV_AUTH_MARKER = 'DEV_AUTH_BYPASS'
export const DEV_COOKIE = 'dev_user'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

function cookie(request: Request, name: string): string | null {
  const c = (request.headers.get('Cookie') ?? '').split(/;\s*/).find((x) => x.startsWith(name + '='))
  return c ? decodeURIComponent(c.slice(name.length + 1)) : null
}

export async function devIdentity(request: Request, db: Db, devAuth: string | undefined): Promise<{ user: AuthUser; locale: string | null } | null> {
  if (devAuth !== '1') return null
  if (!LOCAL_HOSTS.has(new URL(request.url).hostname)) return null
  const email = cookie(request, DEV_COOKIE) ?? (await db.prepare(`SELECT email FROM users WHERE status = 'active' AND can_login = 1 ORDER BY role = 'employee' DESC, can_upload_invoices DESC, display_name LIMIT 1`).first<{ email: string }>())?.email
  if (!email) return null
  const row = await findUserByEmail(db, email)
  if (!row || row.status !== 'active' || row.can_login !== 1) return null
  return { user: toAuthUser(row), locale: row.locale }
}

export async function devUserOptions(db: Db) {
  return (await db.prepare(`SELECT email, display_name, role, status FROM users WHERE can_login = 1 AND status <> 'pending' ORDER BY status, display_name`).all<{ email: string; display_name: string; role: string; status: string }>()).results
}
