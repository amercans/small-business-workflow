import { LEGAL_VERSION } from '#/lib/legal'
import type { Role } from '#/lib/permissions'
import type { AuthUser } from './auth/authorize'
import type { Ctx, FormInput } from './ctx'
import { testDb } from './db/testing'
import type { PreparedFile } from './files'

export const TODAY = '2026-10-21'

export const PEOPLE = {
  employeeA: { role: 'employee', invoices: false },
  employeeB: { role: 'employee', invoices: true },
  manager: { role: 'manager', admin: true },
  manager2: { role: 'manager' },
  approver: { role: 'approver' },
  owner: { role: 'owner' },
  inactive: { role: 'employee', inactive: true },
} as const satisfies Record<string, { role: Role; invoices?: boolean; admin?: boolean; inactive?: boolean }>

export type Who = keyof typeof PEOPLE

const idOf = (i: number) => `1${String(i + 1).padStart(25, '0')}`

export function setup(opts: { policies?: boolean } = {}) {
  const db = testDb()
  const keys = Object.keys(PEOPLE) as Who[]
  const users = {} as Record<Who, AuthUser>
  keys.forEach((k, i) => {
    const p = PEOPLE[k] as { role: Role; invoices?: boolean; admin?: boolean; inactive?: boolean }
    const id = idOf(i)
    db.raw
      .prepare(
        `INSERT INTO users (id, email, full_name, display_name, role, is_admin, can_upload_invoices, status, deactivated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, `${k.toLowerCase()}@ornek.test`, k, k, p.role, p.admin ? 1 : 0, p.invoices ? 1 : 0, p.inactive ? 'inactive' : 'active', p.inactive ? '2026-01-01T00:00:00.000Z' : null)
    db.raw
      .prepare(`INSERT INTO leave_entitlements (id, user_id, year, entitled_days, created_by, updated_by) VALUES (?, ?, 2026, 14, ?, ?)`)
      .run(`2${String(i + 1).padStart(25, '0')}`, id, id, id)
    if (opts.policies !== false) for (const doc of ['policy', 'kvkk']) db.raw.prepare(`INSERT INTO policy_acceptances (id, user_id, doc, version) VALUES (?, ?, ?, ?)`).run(`3${doc === 'policy' ? 'P' : 'K'}${String(i + 1).padStart(24, '0')}`, id, doc, LEGAL_VERSION)
    users[k] = { id, email: `${k.toLowerCase()}@ornek.test`, role: p.role, isAdmin: !!p.admin, canUploadInvoices: !!p.invoices, canManageJobs: false, status: p.inactive ? 'inactive' : 'active' }
  })
  const stored: PreparedFile[] = []
  const ctx = (who: Who): Ctx => ({ db, user: users[who], store: { put: async (f) => void stored.push(...f), discard: async (f) => void f.forEach((x) => stored.splice(stored.indexOf(x), 1)) }, today: TODAY })
  return { db, users, ctx, stored }
}

export const pdf = (name = 'belge.pdf', size = 100) => {
  const b = new Uint8Array(size)
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d])
  return new File([b], name, { type: 'application/pdf' })
}
export const jpg = (name = 'fis.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], name, { type: 'image/jpeg' })

export function form(json: Record<string, unknown>, files: Record<string, File> = {}): FormInput {
  const map = new Map<string, File>()
  const out = JSON.parse(
    JSON.stringify(json, (_k, v) => {
      if (v instanceof File) {
        const key = `f${map.size}`
        map.set(key, v)
        return { $file: key }
      }
      return v
    }),
  )
  for (const [k, v] of Object.entries(files)) map.set(k, v)
  return { json: out, files: map }
}

export const leaveInput = (over: Record<string, unknown> = {}) => form({ kind: 'annual', start: '2026-11-02', end: '2026-11-03', note: 'Aile ziyareti', ...over })
export const IBAN = 'TR330006100519786457841326'
export const expenseInput = (amount = 1000, over: Record<string, unknown> = {}) =>
  form({ items: [{ date: '2026-10-20', amount, currency: 'TRY', category: 'meals', description: 'Ekip yemeği', fileName: 'fis.jpg', file: jpg() }], ...over })
export const advanceInput = (amount = 3500) => form({ amount, reason: 'Stüdyo ön ödeme' })
export const purchaseInput = () => form({ kind: 'equipment', name: 'Lens', unitPrice: 1000, quantity: 2, reason: 'Gerekli' })
export const travelInput = (over: Record<string, unknown> = {}) =>
  form({ place: 'Bursa', start: '2026-11-10', end: '2026-11-11', purpose: 'Müşteri ziyareti', transport: 'car', lodging: 'hotel', wantAdvance: false, ...over })

export async function invVersion(ctx: { db: Ctx['db'] }, id: string): Promise<number> {
  return (await ctx.db.prepare(`SELECT version FROM invoices WHERE id = ?`).bind(id).first<{ version: number }>())?.version ?? 0
}
