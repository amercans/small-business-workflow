import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Db, Stmt } from './d1'

const MIGRATIONS = join(import.meta.dirname, '../../../migrations')

class NodeStmt implements Stmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...values: unknown[]): Stmt {
    if (values.length > 100) throw new Error('D1_ERROR: too many SQL variables')
    return new NodeStmt(this.db, this.sql, values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)))
  }
  private s() {
    return this.db.prepare(this.sql)
  }
  async first<T>() {
    return ((this.s().get(...(this.params as never[])) as T) ?? null) as T | null
  }
  async all<T>() {
    return { results: this.s().all(...(this.params as never[])) as T[] }
  }
  async run() {
    return { meta: { changes: Number(this.s().run(...(this.params as never[])).changes) } }
  }
  runSync() {
    return { meta: { changes: Number(this.s().run(...(this.params as never[])).changes) } }
  }
}

export function testDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  return {
    raw,
    prepare: (sql: string) => new NodeStmt(raw, sql),
    async batch(stmts: Stmt[]) {
      raw.exec('BEGIN')
      try {
        const out = stmts.map((s) => (s as NodeStmt).runSync())
        raw.exec('COMMIT')
        return out
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      }
    },
  }
}
