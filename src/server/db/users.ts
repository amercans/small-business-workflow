import type { Role } from '#/lib/permissions'
import type { AuthUser } from '../auth/authorize'
import type { Db } from './d1'

export interface UserRow {
  id: string
  email: string
  full_name: string
  display_name: string
  role: Role
  is_admin: number
  can_upload_invoices: number
  can_manage_jobs: number
  avatar_hue: number | null
  status: 'pending' | 'active' | 'inactive'
  locale: string | null
  can_login: number
  version: number
}

const COLS = 'id, email, full_name, display_name, role, is_admin, can_upload_invoices, can_manage_jobs, avatar_hue, status, can_login, version, locale'

export const toAuthUser = (r: UserRow): AuthUser => ({
  id: r.id,
  email: r.email,
  role: r.role,
  isAdmin: r.is_admin === 1,
  canUploadInvoices: r.can_upload_invoices === 1,
  canManageJobs: r.can_manage_jobs === 1,
  status: r.status === 'active' ? 'active' : 'inactive',
})

export const findUserByEmail = (db: Db, email: string) =>
  db.prepare(`SELECT ${COLS} FROM users WHERE email = ?`).bind(email.trim().toLowerCase()).first<UserRow>()

export const findUserById = (db: Db, id: string) => db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).bind(id).first<UserRow>()

export const allUsers = async (db: Db) =>
  (await db.prepare(`SELECT ${COLS} FROM users ORDER BY status, display_name`).all<UserRow>()).results
