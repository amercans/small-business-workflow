export interface Stmt {
  bind(...values: unknown[]): Stmt
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}

export interface Db {
  prepare(sql: string): Stmt
  batch(stmts: Stmt[]): Promise<{ meta: { changes: number } }[]>
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now = Date.now()): string {
  let t = now
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time
    t = Math.floor(t / 32)
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16))
  let rand = ''
  for (let i = 0; i < 16; i++) rand += B32[rnd[i] % 32]
  return time + rand
}

export const nowIso = () => new Date().toISOString()

export function assertion(db: Db, code: string, where: string, ...params: unknown[]): Stmt {
  return db.prepare(`INSERT INTO assertions (code) SELECT ? WHERE ${where}`).bind(code, ...params)
}

export function failedAssertion(err: unknown, codes: readonly string[]): string | null {
  const msg = err instanceof Error ? err.message : String(err)
  return codes.find((c) => msg.includes(c)) ?? null
}

export const isUniqueViolation = (err: unknown) => /UNIQUE constraint failed/i.test(err instanceof Error ? err.message : String(err))

export type EntityType =
  | 'user' | 'leave_entitlement' | 'request' | 'request_item' | 'advance_allocation' | 'attachment'
  | 'agreement' | 'invoice' | 'invoice_item' | 'asset' | 'assignment' | 'fixed_cost' | 'auth' | 'export' | 'settings'

export interface AuditInput {
  actorId: string | null
  actorEmail?: string
  action: string
  entityType: EntityType
  entityId?: string | null
  before?: unknown
  after?: unknown
  meta?: unknown
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v))

export function audit(db: Db, a: AuditInput): Stmt {
  return db
    .prepare(
      `INSERT INTO audit_log (id, actor_user_id, actor_email, action, entity_type, entity_id, before_json, after_json, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ulid(), a.actorId, a.actorEmail ?? null, a.action, a.entityType, a.entityId ?? null, json(a.before), json(a.after), json(a.meta))
}

export const toMinor = (tl: number) => Math.round(tl * 100)
export const fromMinor = (k: number | null | undefined) => (k == null ? 0 : k / 100)

export function toBaseMinor(amountMinor: number, fxRateMicro: number): number {
  const p = BigInt(amountMinor) * BigInt(fxRateMicro)
  return Number((p + 500_000n) / 1_000_000n)
}
