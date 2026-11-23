import { runtimeConfig } from '#/config/runtime'
import { t } from '#/i18n'
import { defaultVatRates, normalizeVatRates } from '#/lib/vat'
import type { Db } from './db/d1'
import { readSetting } from './settings'
import { fail, type Fail } from './submit'

export const VAT_SETTING = 'vat_rates'

export { normalizeVatRates }

export async function vatRates(db: Db): Promise<number[]> {
  const stored = await readSetting<number[] | null>(db, VAT_SETTING, null)
  const list = Array.isArray(stored) ? normalizeVatRates(stored) : []
  return list.length ? list : defaultVatRates(runtimeConfig().holidayCountry)
}

export async function vatRateError(db: Db, rate: number): Promise<Fail | null> {
  const list = await vatRates(db)
  return list.includes(rate) ? null : fail(t('schemas.invoice.vatRequired'), 'vatRate')
}
