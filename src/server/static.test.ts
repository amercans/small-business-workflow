import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.ts$|testkit\.ts$|testing\.ts$/.test(f) ? [p] : []
  })
const all = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }))
const isServer = (p: string) => p === 'server.ts' || p.startsWith('server/')

describe('static source checks', () => {
  it('every createServerFn starts with the authed middleware', () => {
    const bad: string[] = []
    for (const f of all) {
      for (const m of f.text.matchAll(/createServerFn\([^)]*\)/g)) {
        const after = f.text.slice(m.index! + m[0].length, m.index! + m[0].length + 40)
        if (!/^\s*\.middleware\(\[authed\]\)/.test(after)) bad.push(`${f.path}@${m.index}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('server functions are not wrapped in helpers (the handler would leak into the client bundle)', () => {
    expect(all.filter((f) => /=>\s*createServerFn\(/.test(f.text)).map((f) => f.path)).toEqual([])
  })
  it('env.DB and SQL (.prepare) appear only in the server layer', () => {
    const bad = all.filter((f) => !isServer(f.path) && /env\.DB|\.prepare\(/.test(f.text)).map((f) => f.path)
    expect(bad).toEqual([])
  })
  it("the code never deletes from R2", () => {
    const bad = all.filter((f) => /FILES\.delete/.test(f.text) && !(f.path === 'server/fn.ts' && (f.text.match(/FILES\.delete/g) ?? []).length === 1))
    expect(bad.map((f) => f.path)).toEqual([])
  })
  it('the Worker entry file only has a default export', () => {
    const entry = all.find((f) => f.path === 'server.ts')!.text
    expect(entry.match(/^export (?!default)/gm) ?? []).toEqual([])
  })
  it('the development identity module is loaded only from DEV branches', () => {
    const importers = all.filter((f) => f.text.includes('dev-identity') && !f.path.endsWith('dev-identity.ts'))
    for (const f of importers) expect(f.text, f.path).toMatch(/if \(import\.meta\.env\.DEV\)[\s\S]{0,200}import\(['"][^'"]*dev-identity['"]\)/)
  })
})
