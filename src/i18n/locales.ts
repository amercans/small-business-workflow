import { LANGUAGES } from './registry'

export type Locale = string
export const LOCALES: readonly Locale[] = Object.keys(LANGUAGES)
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'lang'

export const LOCALE_NAMES: Readonly<Record<Locale, string>> = Object.fromEntries(LOCALES.map((l) => [l, LANGUAGES[l].name]))
export const INTL_LOCALE: Readonly<Record<Locale, string>> = Object.fromEntries(LOCALES.map((l) => [l, LANGUAGES[l].intl]))

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && Object.hasOwn(LANGUAGES, v)

export function pickLocale(opts: { user?: string | null; cookie?: string | null; acceptLanguage?: string | null; fallback?: string | null }): Locale {
  if (isLocale(opts.user)) return opts.user
  if (isLocale(opts.cookie)) return opts.cookie
  const ranked = (opts.acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { base: tag.toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1 }
    })
    .filter((x) => x.base && x.q > 0)
    .sort((a, b) => b.q - a.q)
  for (const r of ranked) if (isLocale(r.base)) return r.base
  return isLocale(opts.fallback) ? opts.fallback : DEFAULT_LOCALE
}

export function cookieLocale(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? '').split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i) === LOCALE_COOKIE) return decodeURIComponent(part.slice(i + 1))
  }
  return null
}
