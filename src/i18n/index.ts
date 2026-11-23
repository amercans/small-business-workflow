import type { Messages } from './lang/en'
import { LANGUAGES } from './registry'
import { DEFAULT_LOCALE, INTL_LOCALE, isLocale, type Locale } from './locales'

export type { Locale } from './locales'
export { LOCALES, LOCALE_NAMES, DEFAULT_LOCALE, isLocale } from './locales'

export const DICTIONARIES: Readonly<Record<Locale, Messages>> = Object.fromEntries(Object.entries(LANGUAGES).map(([k, v]) => [k, v.messages]))

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>
}[keyof T & string]

export type MessageKey = Paths<Messages>
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never
export type Params = Record<string, string | number>

let fallbackLocale: Locale = DEFAULT_LOCALE
let resolver: (() => Locale | undefined) | null = null

export function setLocaleResolver(fn: () => Locale | undefined): void {
  resolver = fn
}

export function setFallbackLocale(locale: string | undefined | null): void {
  if (isLocale(locale)) fallbackLocale = locale
}

export function setClientLocale(locale: string | undefined | null): void {
  if (typeof window !== 'undefined') setFallbackLocale(locale)
}

export function currentLocale(): Locale {
  return resolver?.() ?? fallbackLocale
}

export const intlLocale = (locale: Locale = currentLocale()): string => INTL_LOCALE[locale] ?? INTL_LOCALE[DEFAULT_LOCALE]

function lookup(dict: Messages, key: string): unknown {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

const fill = (s: string, params?: Params) => (params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s)

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const v = lookup(DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE], key) ?? lookup(DICTIONARIES[DEFAULT_LOCALE], key)
  return typeof v === 'string' ? fill(v, params) : key
}

export function t(key: MessageKey, params?: Params): string {
  return translate(currentLocale(), key, params)
}

export function translatePlural(locale: Locale, key: PluralKey, count: number, params?: Params): string {
  const rule = new Intl.PluralRules(INTL_LOCALE[locale] ?? INTL_LOCALE[DEFAULT_LOCALE]).select(count)
  const k = (lookup(DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE], `${key}.${rule}`) !== undefined ? `${key}.${rule}` : `${key}.other`) as MessageKey
  return translate(locale, k, { count, ...params })
}

export function tn(key: PluralKey, count: number, params?: Params): string {
  return translatePlural(currentLocale(), key, count, params)
}

export function forLocale(locale: Locale) {
  return {
    locale,
    t: (key: MessageKey, params?: Params) => translate(locale, key, params),
    tn: (key: PluralKey, count: number, params?: Params) => translatePlural(locale, key, count, params),
  }
}
