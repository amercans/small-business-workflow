import type { LegalPack } from '#/legal/types'
import type { Messages } from './lang/en'

export interface Language {
  code: string
  name: string
  intl: string
  messages: Messages
  legal?: LegalPack
}

export const defineLanguage = (language: Language): Language => language
