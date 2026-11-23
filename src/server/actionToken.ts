import { ulid, type Db } from './db/d1'

export const TOKEN_TTL_MS = 7 * 24 * 3600_000

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function hashToken(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export async function issueToken(db: Db, t: { entityType: 'request' | 'invoice'; entityId: string; userId: string }, now = new Date()): Promise<string> {
  const raw = b64url(crypto.getRandomValues(new Uint8Array(32)))
  await db
    .prepare(`INSERT INTO action_tokens (id, token_hash, entity_type, entity_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(ulid(), await hashToken(raw), t.entityType, t.entityId, t.userId, now.toISOString(), new Date(now.getTime() + TOKEN_TTL_MS).toISOString())
    .run()
  return raw
}

