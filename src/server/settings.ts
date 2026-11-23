import type { Db, Stmt } from './db/d1'

export async function readSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await db.prepare(`SELECT value_json FROM app_settings WHERE key = ?`).bind(key).first<{ value_json: string }>()
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

export const writeSetting = (db: Db, key: string, value: unknown, actorId: string | null, now = new Date().toISOString()): Stmt =>
  db
    .prepare(`INSERT INTO app_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, JSON.stringify(value), now, actorId)
