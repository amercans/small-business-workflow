import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = join(import.meta.dirname, '../dist')
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
const files = walk(DIST).filter((f) => /\.(js|mjs|html|css|map)$/.test(f))

const everywhere = ['DEV_AUTH_BYPASS', 'DEV_USER_SWITCHER', 'dev_user', 'devIdentity', 'ornek.test', 'example.test']
const clientOnly = ['FROM requests', 'INSERT INTO', 'cloudflare:workers', 'password_hash', 'r2_key', 'token_hash']

const hits = []
for (const f of files) {
  const t = readFileSync(f, 'utf8')
  for (const m of everywhere) if (t.includes(m)) hits.push(`${f}: ${m}`)
  if (f.includes('/client/')) for (const m of clientOnly) if (t.includes(m)) hits.push(`${f}: ${m}`)
  if (f.endsWith('.map')) hits.push(`${f}: source map in build output`)
}
for (const f of walk(DIST).filter((f) => /\/\.dev\.vars/.test(f))) rmSync(f)
if (walk(DIST).some((f) => /\/\.(dev\.vars|env)/.test(f))) hits.push('dist: .dev.vars/.env in build output')
if (hits.length) {
  console.error('check-dist failed:\n' + hits.join('\n'))
  process.exit(1)
}
console.log(`check-dist: ${files.length} files clean`)
