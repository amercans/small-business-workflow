import { SESSION_TTL_MS } from './accounts'

export const sessionCookieName = (url: URL) => (url.protocol === 'https:' ? '__Host-session' : 'session')

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i) === name) {
      try {
        return decodeURIComponent(part.slice(i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

export const sessionToken = (request: Request, url: URL) => readCookie(request, sessionCookieName(url))

export const sessionCookie = (url: URL, token: string) =>
  `${sessionCookieName(url)}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; Secure; SameSite=Lax`

export const clearSessionCookie = (url: URL) => `${sessionCookieName(url)}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`

export function sameOrigin(request: Request, url: URL): boolean {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return true
  const origin = request.headers.get('Origin')
  const host = request.headers.get('Host') ?? url.host
  if (origin && origin !== 'null') {
    try {
      const o = new URL(origin)
      return o.origin === url.origin && o.host === host
    } catch {
      return false
    }
  }
  const site = request.headers.get('Sec-Fetch-Site')
  if (site) return site === 'same-origin'
  const referer = request.headers.get('Referer')
  if (referer) {
    try {
      return new URL(referer).origin === url.origin
    } catch {
      return false
    }
  }
  return false
}

export interface Limiter {
  limit(o: { key: string }): Promise<{ success: boolean }>
}

export async function underLimit(limiter: Limiter | undefined, keys: string[]): Promise<boolean> {
  if (!limiter) return true
  for (const key of keys) {
    const { success } = await limiter.limit({ key })
    if (!success) return false
  }
  return true
}

export const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP')?.slice(0, 64) ?? null
