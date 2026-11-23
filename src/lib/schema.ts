import { z } from 'zod'
import { isValidISO } from './leave'
import { t, type MessageKey } from '#/i18n'

export type Msg = string | (() => string)

export const msgFn = (m: Msg): (() => string) => (typeof m === 'function' ? m : () => m)

export const lt = (key: MessageKey, params?: Record<string, string | number>) => () => t(key, params)

export function labels<K extends string>(keys: readonly K[], key: (k: K) => MessageKey): Record<K, string> {
  const out = {} as Record<K, string>
  for (const k of keys) Object.defineProperty(out, k, { get: () => t(key(k)), enumerable: true })
  return out
}

export const isoDay = (msg: Msg) => z.string({ error: msgFn(msg) }).refine(isValidISO, { error: msgFn(msg) })
export const money = (msg: Msg = lt('schemas.common.amountRequired')) =>
  z
    .number({ error: msgFn(msg) })
    .positive({ error: lt('schemas.common.amountPositive') })
    .max(10_000_000_000, { error: lt('schemas.common.amountTooLarge') })
export const optText = (max: number) => z.string().trim().max(max, { error: lt('schemas.common.maxChars', { max }) }).optional()
export const reqText = (empty: Msg, max: number) =>
  z
    .string({ error: msgFn(empty) })
    .trim()
    .min(1, { error: msgFn(empty) })
    .max(max, { error: lt('schemas.common.maxChars', { max }) })
