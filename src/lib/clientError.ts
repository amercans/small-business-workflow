import { LOCALES, t, translate, type MessageKey } from '#/i18n'

const SERVER_KEYS = ['server.filesTooLarge', 'server.forbidden', 'server.recordNotFound', 'server.unexpected', 'server.invalidRequest'] as const satisfies readonly MessageKey[]

const matches = (msg: string, key: MessageKey) => LOCALES.some((l) => translate(l, key) === msg)

export function clientError(e: unknown): string {
  const msg = e instanceof Error ? e.message : ''
  for (const key of SERVER_KEYS) if (matches(msg, key)) return t(key)
  if (matches(msg, 'server.loginRequired')) return t('forms.errors.sessionExpired')
  return t('forms.errors.network')
}

export function notFoundOrThrow(e: unknown): null {
  const msg = e instanceof Error ? e.message : ''
  if (matches(msg, 'server.recordNotFound') || matches(msg, 'server.forbidden') || /"code"\s*:\s*"(invalid_string|too_small|too_big|invalid_format)"/.test(msg)) return null
  throw e
}
