import { cleanPanelUrl } from '#/config/brand'
import { createMiddleware, createServerOnlyFn } from '@tanstack/react-start'
import { t } from '#/i18n'
import { env, waitUntil } from 'cloudflare:workers'
import { getRequest } from '@tanstack/react-start/server'
import { HttpError, type AuthUser } from './auth/authorize'
import type { Ctx } from './ctx'
import { MAX_FILES, MAX_TOTAL_BYTES } from './limits'
import { todayISO } from './time'
import { deliver } from './notify'
import { accountingConfig, mailer } from './mailer'
import { deliverAccounting } from './accounting'

const store: Ctx['store'] = {
  async put(files) {
    await Promise.all(files.map((f) => env.FILES.put(f.r2Key, f.bytes, { httpMetadata: { contentType: f.contentType } })))
  },
  async discard(files) {
    await Promise.all(files.map((f) => env.FILES.delete(f.r2Key))).catch(() => {})
  },
}

export const authed = createMiddleware({ type: 'function' }).server(async ({ next, context }) => {
  const user = (context as unknown as { user?: AuthUser } | undefined)?.user
  if (!user || user.status !== 'active') throw new HttpError(401, t('server.loginRequired'))
  const req = getRequest()
  const client = { ip: req.headers.get('CF-Connecting-IP')?.slice(0, 64) ?? null, ua: req.headers.get('User-Agent')?.slice(0, 300) ?? null }
  const ctx: Ctx = { user, db: env.DB, store, today: todayISO(), client }
  try {
    const out = await next({ context: ctx })
    const m = mailer()
    if (m && getRequest().method === 'POST') {
      waitUntil(deliver(env.DB, m, cleanPanelUrl(env.PANEL_URL)).catch(() => {}))
      waitUntil(deliverAccounting(env.DB, env.FILES, m, accountingConfig(), 1).catch(() => {}))
    }
    return out
  } catch (e) {
    if (e instanceof HttpError) throw e
    console.error(JSON.stringify({ at: 'server-fn', user: user.id, error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }))
    throw new HttpError(500, t('server.unexpected'))
  }
})

export function readForm(fd: unknown): { json: unknown; files: Map<string, File> } {
  if (!(fd instanceof FormData)) throw new HttpError(400, t('server.invalidRequest'))
  const raw = fd.get('json')
  if (typeof raw !== 'string' || raw.length > 200_000) throw new HttpError(400, t('server.invalidRequest'))
  const files = new Map<string, File>()
  let total = 0
  for (const [k, v] of fd.entries()) {
    if (k === 'json' || !(v instanceof File)) continue
    total += v.size
    if (files.size >= MAX_FILES || total > MAX_TOTAL_BYTES) throw new HttpError(413, t('server.filesTooLarge'))
    files.set(k, v)
  }
  try {
    return { json: JSON.parse(raw), files }
  } catch {
    throw new HttpError(400, t('server.invalidRequest'))
  }
}

export const panelOrigin = createServerOnlyFn((): string => cleanPanelUrl(env.PANEL_URL) || new URL(getRequest().url).origin)
