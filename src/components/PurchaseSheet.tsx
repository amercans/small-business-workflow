import { useState } from 'react'
import { Field, fieldA11y } from './Field'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Segmented } from './Segmented'
import { SummaryCard } from './SummaryCard'
import type { SheetProps } from './LeaveSheet'
import { LICENSE_PERIODS, PURCHASE_KINDS, purchaseSchema, submitPurchaseRequest } from '#/data/requests'
import { formatMoney, parseMoney, round2 } from '#/lib/money'
import { useSession } from '#/lib/useSession'
import { useSubmit } from '#/lib/useSubmit'
import { LICENSE_PERIOD_LABEL, PURCHASE_KIND_LABEL } from '#/lib/requestSchemas'
import { t } from '#/i18n'

export function PurchaseSheet({ open, onClose, onSubmitted, home }: SheetProps) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="purchase">
      <PurchaseForm onClose={onClose} onSubmitted={onSubmitted} home={home} />
    </RequestSheet>
  )
}

function PurchaseForm({ onClose, onSubmitted }: Omit<SheetProps, 'open'>) {
  const isAuto = useSession().autoApproveKinds.includes('purchase')
  const [kind, setKind] = useState<(typeof PURCHASE_KINDS)[number]>('equipment')
  const [period, setPeriod] = useState<(typeof LICENSE_PERIODS)[number] | ''>('')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [url, setUrl] = useState('')

  const { errors, warning, busy, run, clear } = useSubmit({
    schema: purchaseSchema,
    submit: submitPurchaseRequest,
    onClose,
    onSubmitted: (r) => onSubmitted(r.requests),
    build: () => ({
      kind,
      period: kind === 'software' ? period || undefined : undefined,
      name,
      unitPrice: parseMoney(unit) ?? undefined,
      quantity: qty.trim() === '' ? undefined : Number(qty),
      reason,
      url: url || undefined,
    }),
  })

  const unitValue = parseMoney(unit) ?? 0
  const quantity = Number.isInteger(Number(qty)) && Number(qty) > 0 ? Number(qty) : 0
  const total = round2(unitValue * quantity)

  return (
    <SheetLayout
      title={t('purchase.sheet.title')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone="purchase"
          kicker={kind === 'software' && period ? `${PURCHASE_KIND_LABEL[kind]} · ${LICENSE_PERIOD_LABEL[period]}` : PURCHASE_KIND_LABEL[kind]}
          headline={name.trim() || t('purchase.sheet.item')}
          big={formatMoney(total)}
          rows={quantity > 1 && unitValue > 0 ? [{ label: t('purchase.sheet.qtyTimes', { qty: quantity, unit: formatMoney(unitValue) }), value: formatMoney(total) }] : undefined}
        />
      }
      aside={<SheetAside onay={isAuto ? t('purchase.sheet.asideAuto') : t('purchase.sheet.aside')} warning={warning} />}
    >
      <Segmented
        label={t('purchase.sheet.kind')}
        autoFocusFirst
        className="mt-5"
        value={kind}
        options={PURCHASE_KINDS.map((k) => ({ value: k, label: PURCHASE_KIND_LABEL[k] }))}
        onChange={(k) => {
          setKind(k)
          clear('period')
        }}
      />

      {kind === 'software' && (
        <div className="mt-5.5">
          <span id="pur-period-label" className="mb-2.5 block text-micro font-semibold text-muted">
            {t('purchase.sheet.period')}
          </span>
          <Segmented
            label={t('purchase.sheet.period')}
            invalid={!!errors.period}
            value={period as (typeof LICENSE_PERIODS)[number]}
            options={LICENSE_PERIODS.map((k) => ({ value: k, label: LICENSE_PERIOD_LABEL[k] }))}
            onChange={(v) => {
              setPeriod(v)
              clear('period')
            }}
          />
          {errors.period && (
            <p id="pur-period-err" role="alert" className="mt-1.5 text-micro text-status-rejected">
              {errors.period}
            </p>
          )}
        </div>
      )}

      <Field id="pur-name" label={t('purchase.sheet.item')} error={errors.name} className="mt-5.5">
        <input
          {...fieldA11y('pur-name', errors.name)}
          type="text"
          maxLength={160}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            clear('name')
          }}
          placeholder={kind === 'software' ? t('purchase.sheet.softwarePlaceholder') : t('purchase.sheet.equipmentPlaceholder')}
          className="input"
        />
      </Field>

      <div className="mt-5.5 grid grid-cols-[1fr_6.5rem] gap-3.5">
        <Field id="pur-unit" label={t('purchase.sheet.unitPrice')} optional error={errors.unitPrice}>
          <MoneyInput
            {...fieldA11y('pur-unit', errors.unitPrice)}
            value={unit}
            onChange={(v) => {
              setUnit(v)
              clear('unitPrice')
            }}
          />
        </Field>
        <Field id="pur-qty" label={t('purchase.sheet.quantity')} error={errors.quantity}>
          <input
            {...fieldA11y('pur-qty', errors.quantity)}
            type="text"
            inputMode="numeric"
            value={qty}
            onChange={(e) => {
              setQty(e.target.value.replace(/[^\d]/g, ''))
              clear('quantity')
            }}
            className="input num"
          />
        </Field>
      </div>

      <Field id="pur-reason" label={t('purchase.sheet.reason')} error={errors.reason} className="mt-5.5">
        <textarea
          {...fieldA11y('pur-reason', errors.reason)}
          value={reason}
          maxLength={400}
          rows={2}
          onChange={(e) => {
            setReason(e.target.value)
            clear('reason')
          }}
          placeholder={t('purchase.sheet.reasonPlaceholder')}
          className="input min-h-13.5 resize-none"
        />
      </Field>

      <Field id="pur-url" label={t('purchase.sheet.url')} optional error={errors.url} className="mt-5.5">
        <input
          {...fieldA11y('pur-url', errors.url)}
          type="url"
          inputMode="url"
          value={url}
          maxLength={500}
          onChange={(e) => {
            setUrl(e.target.value)
            clear('url')
          }}
          placeholder="https://"
          className="input"
        />
      </Field>
    </SheetLayout>
  )
}
