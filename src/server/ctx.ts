import type { AuthUser } from './auth/authorize'
import type { Db } from './db/d1'
import type { PreparedFile } from './files'

export interface Ctx {
  db: Db
  user: AuthUser
  store: {
    put(files: PreparedFile[]): Promise<void>
    discard(files: PreparedFile[]): Promise<void>
  }
  today?: string
  fetcher?: typeof fetch
  client?: { ip: string | null; ua: string | null }
}

export interface FormInput {
  json: unknown
  files: Map<string, File>
}
