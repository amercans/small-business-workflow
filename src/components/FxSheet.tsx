import { useState } from 'react'
import { Field, fieldA11y } from './Field'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { SummaryCard } from './SummaryCard'
import { submitFx, type FxRates } from '#/data/digital'
import { dateLabel } from '#/data/invoices'
import { fxSchema } from '#/lib/manageSchemas'
import { baseCurrency, currencyLabel, foreignCurrencies, formatAmount, parseMoney, type Currency } from '#/lib/money'
import { configuredVatRates } from '#/lib/invoice'
import { parseVatList } from '#/lib/vat'
import { useSubmit } from '#/lib/useSubmit'
import { t } from '#/i18n'

type Fx = FxRates & { updatedOn: string | null }

export function FxSheet({ open, fx, onClose, onSaved }: { open: boolean; fx: Fx; onClose: () => void; onSaved: () => void }) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="fx">
      {open && <FxForm fx={fx} onClose={onClose} onSaved={onSaved} />}
    </RequestSheet>
  )
}

function FxForm({ fx, onClose, onSaved }: { fx: Fx; onClose: () => void; onSaved: () => void }) {
  const base = baseCurrency()
  const others = foreignCurrencies()
  const [rates, setRates] = useState<Partial<Record<Currency, string>>>(() => Object.fromEntries(others.map((c) => [c, fx[c] ? formatAmount(fx[c]!) : ''])))
  const [vat, setVat] = useState(configuredVatRates().join(', '))
  const [vatError, setVatError] = useState('')
  const { errors, warning, busy, run, clear } = useSubmit({
    schema: fxSchema,
    submit: submitFx,
    onClose,
    onSubmitted: () => onSaved(),
    build: () => {
      const list = parseVatList(vat)
      setVatError(list ? '' : t('schemas.fx.vatInvalid'))
      return { rates: Object.fromEntries(others.map((c) => [c, parseMoney(rates[c] ?? '') ?? null])), vatRates: list ?? [] }
    },
  })
  const first = others[0]
  return (
    <SheetLayout
      title={t('fx.title')}
      subtitle={t('fx.subtitleAuto', { base: currencyLabel(base) })}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      submitLabel={t('fx.save')}
      summary={
        <SummaryCard
          tone="advance"
          kicker={t('fx.kicker')}
          headline={fx.updatedOn ? t('fx.updated', { date: dateLabel(fx.updatedOn) }) : t('fx.notSet')}
          big={first && rates[first] ? `1 ${first} = ${rates[first]} ${currencyLabel(base)}` : '—'}
          rows={others.slice(1).map((c) => ({ label: `1 ${c}`, value: rates[c] ? `${rates[c]} ${currencyLabel(base)}` : '—' }))}
        />
      }
      aside={<SheetAside onay={t('fx.aside')} warning={warning} />}
    >
      <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
        {others.map((c) => {
          const err = errors[`rates.${c}`]
          return (
            <Field key={c} id={`fx-${c}`} label={t('fx.rateLabel', { currency: c, base: currencyLabel(base) })} error={err}>
              <MoneyInput {...fieldA11y(`fx-${c}`, err)} value={rates[c] ?? ''} onChange={(v) => { setRates((r) => ({ ...r, [c]: v })); clear(`rates.${c}`) }} />
            </Field>
          )
        })}
      </div>
      <Field id="fx-vat" label={t('fx.vatLabel')} hint={t('fx.vatHint')} error={vatError || errors.vatRates} className="mt-5.5">
        <input {...fieldA11y('fx-vat', vatError || errors.vatRates, 'x')} type="text" inputMode="decimal" maxLength={80} value={vat} onChange={(e) => { setVat(e.target.value); setVatError(''); clear('vatRates') }} className="input num" />
      </Field>
    </SheetLayout>
  )
}
