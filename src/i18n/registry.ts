import type { Language } from './types'

const modules = import.meta.glob<{ default: Language }>('./lang/*.ts', { eager: true })

export const LANGUAGES: Readonly<Record<string, Language>> = Object.fromEntries(
  Object.values(modules)
    .map((m) => m.default)
    .sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.code.localeCompare(b.code)))
    .map((l) => [l.code, l]),
)
