import { useState } from 'react'
import { Field, fieldA11y } from './Field'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { SummaryCard } from './SummaryCard'
import { fixedCostSchema, submitFixedCosts, type MonthData, type OverviewData } from '#/data/finance'
import { hourlyRate, monthLong, type Breakdown } from '#/lib/finance'
import type { FixedKind } from '#/lib/manageSchemas'
import { formatAmount, formatMoneyRounded, parseMoney } from '#/lib/money'
import { useSubmit } from '#/lib/useSubmit'
import { t, type MessageKey } from '#/i18n'
import { formatNumber } from '#/i18n/format'

export function FixedCostSheet({ month, rate, digitalMonthly, digitalMissingFx = 0, onClose, onSaved }: { month: MonthData | null; rate: OverviewData['rate']; digitalMonthly: number; digitalMissingFx?: number; onClose: () => void; onSaved: () => void }) {
  return (
    <RequestSheet open={!!month} onClose={onClose} returnFocusKey="fixed-costs">
      {month && <FixedCostForm month={month} rate={rate} digitalMonthly={digitalMonthly} digitalMissingFx={digitalMissingFx} onClose={onClose} onSaved={onSaved} />}
    </RequestSheet>
  )
}

const KINDS: [FixedKind, keyof Breakdown][] = [
  ['personnel', 'personnel'],
  ['office', 'office'],
  ['software', 'software'],
  ['equipment', 'equipment'],
  ['professional', 'professional'],
  ['other', 'otherFixed'],
]

const kindText = (k: FixedKind, part: 'label' | 'hint') => t(`finance.fixed.kinds.${k}.${part}` as MessageKey)

const initial = (n: number, missing: boolean) => (missing && n === 0 ? '' : formatAmount(n))
const int = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[^\d]/g, '')))

function FixedCostForm({ month, rate, digitalMonthly, digitalMissingFx, onClose, onSaved }: { month: MonthData; rate: OverviewData['rate']; digitalMonthly: number; digitalMissingFx: number; onClose: () => void; onSaved: () => void }) {
  const b = month.breakdown
  const [vals, setVals] = useState<Record<FixedKind, string>>(() => {
    const v = Object.fromEntries(KINDS.map(([k, bk]) => [k, initial(b[bk], month.fixedMissing)])) as Record<FixedKind, string>
    if (b.software === 0 && digitalMonthly > 0) v.software = formatAmount(digitalMonthly)
    return v
  })
  const [people, setPeople] = useState(rate.peopleAuto ? '' : String(rate.people))
  const [hours, setHours] = useState(String(rate.hours))
  const [util, setUtil] = useState(String(rate.utilization))
  const [margin, setMargin] = useState(String(rate.margin))
  const name = `${monthLong(month.month)} ${month.year}`
  const amount = (k: FixedKind) => parseMoney(vals[k])
  const { errors, warning, busy, run, clear } = useSubmit({
    schema: fixedCostSchema,
    submit: submitFixedCosts,
    onClose,
    onSubmitted: () => onSaved(),
    build: () => ({
      month: month.key,
      personnel: amount('personnel') ?? undefined,
      office: amount('office') ?? undefined,
      software: amount('software') ?? 0,
      equipment: amount('equipment') ?? 0,
      professional: amount('professional') ?? 0,
      other: amount('other') ?? 0,
      people: int(people),
      hours: int(hours) ?? undefined,
      utilization: int(util) ?? undefined,
      margin: int(margin) ?? undefined,
    }),
  })
  const total = KINDS.reduce((s, [k]) => s + (amount(k) ?? 0), 0)
  const preview = hourlyRate(
    { ...b, personnel: amount('personnel') ?? 0, office: amount('office') ?? 0, software: amount('software') ?? 0, equipment: amount('equipment') ?? 0, professional: amount('professional') ?? 0, otherFixed: amount('other') ?? 0 },
    { people: int(people) ?? rate.people, hours: int(hours) ?? 0, utilization: int(util) ?? 0, margin: int(margin) ?? 0 },
  )
  const intField = (id: string, label: string, value: string, set: (v: string) => void, key: string, hint?: string, placeholder?: string) => (
    <Field id={id} label={label} error={errors[key]} hint={hint}>
      <input
        {...fieldA11y(id, errors[key], hint)}
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          set(e.target.value.replace(/[^\d]/g, '').slice(0, 3))
          clear(key)
        }}
        className="input num"
      />
    </Field>
  )

  return (
    <SheetLayout
      title={t('finance.fixed.title')}
      subtitle={t('finance.fixed.subtitle', { month: name })}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      submitLabel={t('finance.save')}
      summary={
        <SummaryCard
          tone="expense"
          kicker={t('finance.fixed.kicker', { month: name })}
          headline={t('finance.fixed.perHour')}
          big={preview ? formatMoneyRounded(preview.cost) : '—'}
          rows={[
            { label: t('finance.fixed.suggested'), value: preview ? t('finance.fixed.ratePerHour', { amount: formatMoneyRounded(preview.rate) }) : '—' },
            { label: t('finance.fixed.billableHours'), value: preview ? formatNumber(Math.round(preview.billableHours)) : '—' },
            { label: t('finance.fixed.title'), value: formatMoneyRounded(total) },
          ]}
        />
      }
      aside={
        <SheetAside
          onay={t('finance.fixed.aside')}
          warning={warning}
        />
      }
    >
      {KINDS.map(([k], i) => {
        const label = kindText(k, 'label')
        const baseHint = kindText(k, 'hint')
        const fromDigital = k === 'software' && digitalMonthly > 0
        const fxNote = k === 'software' && digitalMissingFx > 0 ? t('finance.fixed.fxMissing', { count: digitalMissingFx }) : ''
        const hint = [fromDigital ? t('finance.fixed.fromDigital', { amount: formatMoneyRounded(digitalMonthly) }) : '', fxNote, baseHint].filter(Boolean).join(' ')
        return (
        <Field key={k} id={`fc-${k}`} label={label} hint={hint} error={errors[k]} optional={i > 1} className={i ? 'mt-5.5' : 'mt-5'}>
          <MoneyInput
            {...fieldA11y(`fc-${k}`, errors[k], hint)}
            value={vals[k]}
            onChange={(v) => {
              setVals((s) => ({ ...s, [k]: v }))
              clear(k)
            }}
          />
          {fromDigital && parseMoney(vals.software) !== digitalMonthly && (
            <button type="button" onClick={() => setVals((s) => ({ ...s, software: formatAmount(digitalMonthly) }))} className="btn-tint mt-2 rounded-full px-3 py-1 text-micro">
              {t('finance.fixed.useDigital')}
            </button>
          )}
        </Field>
        )
      })}

      <h3 className="mt-8 text-label font-semibold">{t('finance.fixed.rateTitle')}</h3>
      <p className="mt-1 text-micro text-faint">{t('finance.fixed.allMonths')}</p>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
        {intField('fc-people', t('finance.fixed.people'), people, setPeople, 'people', rate.peopleAuto ? t('finance.fixed.peopleHint', { count: rate.people }) : undefined, String(rate.people))}
        {intField('fc-hours', t('finance.fixed.hours'), hours, setHours, 'hours')}
        {intField('fc-util', t('finance.fixed.util'), util, setUtil, 'utilization', t('finance.fixed.utilHint'))}
        {intField('fc-margin', t('finance.fixed.margin'), margin, setMargin, 'margin')}
      </div>
    </SheetLayout>
  )
}
