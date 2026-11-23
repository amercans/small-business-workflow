import { t, type MessageKey } from '#/i18n'

export function lazyLabels<K extends string>(keys: readonly K[], keyOf: (k: K) => MessageKey): Record<K, string> {
  const out = {} as Record<K, string>
  for (const k of keys) Object.defineProperty(out, k, { enumerable: true, get: () => t(keyOf(k)) })
  return out
}

export const STATUS_KEYS = ['pending', 'approved', 'rejected', 'paid', 'cancelled'] as const
export const statusLabels = () => lazyLabels(STATUS_KEYS, (k) => `server.status.${k}` as const)
