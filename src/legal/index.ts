import { runtimeConfig } from '#/config/runtime'
import { currentLocale, type Locale } from '#/i18n'
import { LANGUAGES } from '#/i18n/registry'
import { enLegal } from './en'
import type { LegalPack, LegalText } from './types'

export type { LegalPack, LegalSection, LegalText } from './types'

const packFor = (locale: Locale): LegalPack => LANGUAGES[locale]?.legal ?? enLegal

export function fillTemplate(s: string): string {
  const c = runtimeConfig()
  const values: Record<string, string> = {
    APP_NAME: c.appName,
    COMPANY_NAME: c.company.name,
    COMPANY_ADDRESS: c.company.address,
    COMPANY_REGISTRATION: c.company.registration,
    CONTACT_EMAIL: c.company.contactEmail,
  }
  return s.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => values[k] || m)
}

const fillText = (x: LegalText): LegalText => ({
  title: fillTemplate(x.title),
  intro: x.intro ? fillTemplate(x.intro) : undefined,
  sections: x.sections.map((s) => ({ h: fillTemplate(s.h), p: s.p.map(fillTemplate) })),
})

export function legalPack(locale: Locale = currentLocale()): LegalPack {
  const p = packFor(locale)
  return { ...p, policy: fillText(p.policy), privacy: fillText(p.privacy), undertaking: { ...p.undertaking, title: fillTemplate(p.undertaking.title), items: p.undertaking.items.map(fillTemplate) } }
}
