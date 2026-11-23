import { useState } from 'react'
import { Field, fieldA11y } from './Field'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Segmented } from './Segmented'
import { Select } from './Select'
import { SummaryCard } from './SummaryCard'
import type { AssignableUser } from './AssetSheets'
import { DIGITAL_KIND_LABEL, DIGITAL_PERIOD_LABEL, digitalSchema, monthlyCost, submitDigital, type DigitalAsset, type DigitalCurrency, type DigitalKind, type DigitalPeriod } from '#/data/digital'
import { Switch } from './Switch'
import { LinkedInvoices } from './LinkedInvoices'
import { dateLabel } from '#/data/invoices'
import { formatAmount, formatMoney, parseMoney, baseCurrency, CURRENCY_SYMBOL } from '#/lib/money'
import { useSubmit } from '#/lib/useSubmit'
import { t, tn } from '#/i18n'

export function DigitalSheet({ item, users, onClose, onSaved }: { item: DigitalAsset | 'new' | null; users: AssignableUser[]; onClose: () => void; onSaved: () => void }) {
  return (
    <RequestSheet open={!!item} onClose={onClose} returnFocusKey="add-digital">
      {item && <DigitalForm key={item === 'new' ? 'new' : item.id} item={item === 'new' ? null : item} users={users} onClose={onClose} onSaved={onSaved} />}
    </RequestSheet>
  )
}

const kindOptions = () => (Object.keys(DIGITAL_KIND_LABEL) as DigitalKind[]).map((k) => ({ value: k, label: k === 'domain' ? t('digital.kindShort.domain') : DIGITAL_KIND_LABEL[k] }))
const periodOptions = () => (Object.keys(DIGITAL_PERIOD_LABEL) as DigitalPeriod[]).map((p) => ({ value: p, label: DIGITAL_PERIOD_LABEL[p] }))
const nameHint = (k: DigitalKind) => t(`digital.nameHint.${k}`)

function DigitalForm({ item, users, onClose, onSaved }: { item: DigitalAsset | null; users: AssignableUser[]; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<DigitalKind>(item?.kind ?? 'software')
  const [name, setName] = useState(item?.name ?? '')
  const [vendor, setVendor] = useState(item?.vendor ?? '')
  const [plan, setPlan] = useState(item?.plan ?? '')
  const [seats, setSeats] = useState(item?.seats ? String(item.seats) : '')
  const [email, setEmail] = useState(item?.accountEmail ?? '')
  const [owner, setOwner] = useState(item?.ownerId ?? '')
  const [renews, setRenews] = useState(item?.renewsOn ?? '')
  const [period, setPeriod] = useState<DigitalPeriod>(item?.period ?? 'yearly')
  const [cost, setCost] = useState(item?.cost != null ? formatAmount(item.cost) : '')
  const [picked, setPicked] = useState<string[]>(item?.users.map((u) => u.id) ?? [])
  const [status, setStatus] = useState<'active' | 'cancelled'>(item?.status ?? 'active')
  const [note, setNote] = useState(item?.note ?? '')
  const [purpose, setPurpose] = useState(item?.purpose ?? '')
  const [currency, setCurrency] = useState<DigitalCurrency>(item?.currency ?? baseCurrency())
  const [verified, setVerified] = useState(item?.verified ?? true)
  const [source, setSource] = useState(item?.source ?? '')
  const [lastPaidOn, setLastPaidOn] = useState(item?.lastPaidOn ?? '')
  const [lastPaid, setLastPaid] = useState(item?.lastPaid != null ? formatAmount(item.lastPaid) : '')
  const [paidBy, setPaidBy] = useState(item?.paidBy ?? '')
  const paid = period === 'monthly' || period === 'yearly'

  const { errors, warning, busy, run, clear } = useSubmit({
    schema: digitalSchema,
    submit: submitDigital,
    onClose,
    onSubmitted: () => onSaved(),
    build: () => ({
      id: item?.id,
      kind,
      name,
      vendor: vendor || undefined,
      plan: plan || undefined,
      seats: seats ? Number(seats) : null,
      accountEmail: email || undefined,
      ownerId: owner || null,
      renewsOn: renews || undefined,
      period,
      cost: period === 'free' ? null : (parseMoney(cost) ?? null),
      userIds: picked,
      status,
      note: note || undefined,
      purpose: purpose.trim() || undefined,
      currency,
      verified,
      source: source || undefined,
      lastPaidOn: lastPaidOn || undefined,
      lastPaid: parseMoney(lastPaid) ?? null,
      paidBy: paidBy || undefined,
    }),
  })
  const c = parseMoney(cost)
  const monthly = monthlyCost(period, c)
  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
    clear('userIds')
  }

  return (
    <SheetLayout
      title={item ? t('digital.sheet.editTitle') : t('digital.sheet.addTitle')}
      subtitle={t('digital.sheet.subtitle')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      submitLabel={t('digital.sheet.save')}
      summary={
        <SummaryCard
          tone="advance"
          kicker={DIGITAL_KIND_LABEL[kind]}
          headline={name.trim() || t('digital.sheet.name')}
          big={paid && c != null ? formatMoney(c, currency) : DIGITAL_PERIOD_LABEL[period]}
          rows={[
            ...(paid && c != null ? [{ label: t('digital.sheet.monthly'), value: formatMoney(monthly, currency) }] : []),
            ...(!verified ? [{ label: t('digital.sheet.status'), value: t('digital.unverified') }] : []),
            ...(renews ? [{ label: t('digital.sheet.renewal'), value: dateLabel(renews) }] : []),
            ...(seats ? [{ label: t('digital.sheet.seats'), value: t('digital.sheet.seatsValue', { people: picked.length, seats }) }] : picked.length ? [{ label: t('digital.sheet.usedBy'), value: tn('digital.sheet.people', picked.length) }] : []),
          ]}
        />
      }
      aside={
        <SheetAside
          onay={t('digital.sheet.aside')}
          warning={warning}
        />
      }
    >
      <div className="mt-5">
        <span className="mb-2.5 block text-micro font-semibold text-muted">{t('digital.sheet.kind')}</span>
        <Segmented label={t('digital.sheet.kind')} value={kind} options={kindOptions()} onChange={setKind} />
      </div>

      <Field id="dg-name" label={t('digital.sheet.name')} error={errors.name} className="mt-5.5">
        <input {...fieldA11y('dg-name', errors.name)} type="text" maxLength={200} value={name} placeholder={nameHint(kind)} onChange={(e) => { setName(e.target.value); clear('name') }} className="input" />
      </Field>
      <Field id="dg-purpose" label={t('digital.sheet.purpose')} optional className="mt-4" hint={t('digital.sheet.purposeHint')}>
        <input id="dg-purpose" type="text" maxLength={200} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('digital.sheet.purposePlaceholder')} className="input" />
      </Field>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-2">
        <Field id="dg-vendor" label={t('digital.sheet.vendor')} optional error={errors.vendor}>
          <input {...fieldA11y('dg-vendor', errors.vendor)} type="text" maxLength={120} value={vendor} onChange={(e) => setVendor(e.target.value)} className="input" />
        </Field>
        <Field id="dg-plan" label={t('digital.sheet.plan')} optional error={errors.plan}>
          <input {...fieldA11y('dg-plan', errors.plan)} type="text" maxLength={120} value={plan} placeholder={t('digital.sheet.planPlaceholder')} onChange={(e) => setPlan(e.target.value)} className="input" />
        </Field>
      </div>

      <div className="mt-5.5">
        <span className="mb-2.5 block text-micro font-semibold text-muted">{t('digital.sheet.payment')}</span>
        <Segmented label={t('digital.sheet.paymentPeriod')} value={period} options={periodOptions()} onChange={(v) => { setPeriod(v); clear('cost'); clear('renewsOn') }} />
      </div>

      {period !== 'free' && (
        <div className="mt-5.5 grid gap-3.5 sm:grid-cols-2">
          <Field id="dg-cost" label={period === 'monthly' ? t('digital.sheet.costMonthly') : period === 'yearly' ? t('digital.sheet.costYearly') : t('digital.sheet.costOnce')} optional error={errors.cost} hint={t('digital.sheet.costHint')}>
            <div className="flex gap-2">
              <MoneyInput {...fieldA11y('dg-cost', errors.cost, 'x')} className="min-w-0 flex-1" suffix="" value={cost} onChange={(v) => { setCost(v); clear('cost') }} />
              <Segmented label={t('digital.sheet.currency')} className="shrink-0" value={currency} options={[{ value: 'TRY', label: CURRENCY_SYMBOL.TRY }, { value: 'USD', label: CURRENCY_SYMBOL.USD }, { value: 'EUR', label: CURRENCY_SYMBOL.EUR }]} onChange={setCurrency} />
            </div>
          </Field>
          <Field id="dg-renews" label={t('digital.sheet.renewsOn')} optional={!paid} error={errors.renewsOn}>
            <input {...fieldA11y('dg-renews', errors.renewsOn)} type="date" value={renews} onChange={(e) => { setRenews(e.target.value); clear('renewsOn') }} className="input" />
          </Field>
        </div>
      )}

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-2">
        <Field id="dg-email" label={t('digital.sheet.account')} optional error={errors.accountEmail} hint={t('digital.sheet.accountHint')}>
          <input {...fieldA11y('dg-email', errors.accountEmail, 'x')} type="text" maxLength={200} value={email} onChange={(e) => { setEmail(e.target.value); clear('accountEmail') }} className="input" />
        </Field>
        <Field id="dg-owner" label={t('digital.sheet.owner')} optional>
          <Select id="dg-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('digital.sheet.choose')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-[8rem_1fr]">
        <Field id="dg-seats" label={t('digital.sheet.seatCount')} optional error={errors.seats}>
          <input {...fieldA11y('dg-seats', errors.seats)} type="text" inputMode="numeric" value={seats} onChange={(e) => { setSeats(e.target.value.replace(/[^\d]/g, '').slice(0, 4)); clear('seats'); clear('userIds') }} className="input num" />
        </Field>
        <div>
          <span className="mb-2.5 block text-micro font-semibold text-muted">{t('digital.sheet.users')} <span className="font-normal">{t('digital.sheet.optional')}</span></span>
          <div role="group" aria-label={t('digital.sheet.users')} className="flex flex-wrap gap-2">
            {users.map((u) => {
              const on = picked.includes(u.id)
              return (
                <button key={u.id} type="button" aria-pressed={on} onClick={() => toggle(u.id)} className={`rounded-full px-3 py-1.5 text-micro font-medium transition-colors ${on ? 'bg-blue text-on-accent' : 'bg-wash text-ink hover:bg-wash-hover'}`}>
                  {u.displayName}
                </button>
              )
            })}
          </div>
          {errors.userIds && <p role="alert" className="mt-1.5 text-micro text-status-rejected">{errors.userIds}</p>}
        </div>
      </div>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-3">
        <Field id="dg-paid" label={t('digital.sheet.lastPaid')} optional error={errors.lastPaid}>
          <MoneyInput {...fieldA11y('dg-paid', errors.lastPaid)} suffix="" value={lastPaid} onChange={(v) => { setLastPaid(v); clear('lastPaid') }} />
        </Field>
        <Field id="dg-paidon" label={t('digital.sheet.lastPaidOn')} optional error={errors.lastPaidOn}>
          <input {...fieldA11y('dg-paidon', errors.lastPaidOn)} type="date" value={lastPaidOn} onChange={(e) => { setLastPaidOn(e.target.value); clear('lastPaidOn') }} className="input" />
        </Field>
        <Field id="dg-paidby" label={t('digital.sheet.paidBy')} optional>
          <input {...fieldA11y('dg-paidby')} type="text" maxLength={120} value={paidBy} placeholder={t('digital.sheet.paidByPlaceholder')} onChange={(e) => setPaidBy(e.target.value)} className="input" />
        </Field>
      </div>

      <Field id="dg-source" label={t('digital.sheet.source')} optional hint={t('digital.sheet.sourceHint')} className="mt-5.5">
        <input {...fieldA11y('dg-source', undefined, 'x')} type="text" maxLength={120} value={source} onChange={(e) => setSource(e.target.value)} className="input" />
      </Field>

      <div className="mt-5.5">
        <Switch checked={verified} onChange={setVerified} label={t('digital.sheet.verified')} />
      </div>

      <Field id="dg-note" label={t('digital.sheet.note')} optional className="mt-5.5">
        <textarea id="dg-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
      </Field>

      {item && (
        <div className="mt-5.5">
          <span className="mb-2.5 block text-micro font-semibold text-muted">{t('digital.sheet.status')}</span>
          <Segmented label={t('digital.sheet.status')} value={status} options={[{ value: 'active', label: t('digital.status.active') }, { value: 'cancelled', label: t('digital.status.cancelled') }]} onChange={setStatus} />
        </div>
      )}

      {item?.invoices && <LinkedInvoices className="mt-7.5 border-t border-hairline pt-5" kind="digital" targetId={item.id} targetLabel={item.name} invoices={item.invoices} onChanged={onSaved} />}
    </SheetLayout>
  )
}
