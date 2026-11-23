import { useState } from 'react'
import { Field, fieldA11y } from './Field'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { SummaryCard } from './SummaryCard'
import type { SheetProps } from './LeaveSheet'
import { advanceSchema, submitAdvanceRequest } from '#/data/requests'
import { formatMoney, parseMoney } from '#/lib/money'
import { useSubmit } from '#/lib/useSubmit'
import { useSession } from '#/lib/useSession'
import { t } from '#/i18n'

export function AdvanceSheet({ open, onClose, onSubmitted, home }: SheetProps) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="advance">
      <AdvanceForm onClose={onClose} onSubmitted={onSubmitted} home={home} />
    </RequestSheet>
  )
}

function AdvanceForm({ onClose, onSubmitted }: Omit<SheetProps, 'open'>) {
  const isAuto = useSession().autoApproveKinds.includes('advance')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  const { errors, warning, busy, run, clear } = useSubmit({
    schema: advanceSchema,
    submit: submitAdvanceRequest,
    onClose,
    onSubmitted: (r) => onSubmitted(r.requests),
    build: () => ({ amount: parseMoney(amount) ?? undefined, reason }),
  })

  const value = parseMoney(amount) ?? 0
  const reasonHint = t('advance.sheet.reasonHint')

  return (
    <SheetLayout
      title={t('advance.sheet.title')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone="advance"
          kicker={t('advance.sheet.kicker')}
          headline={t('advance.sheet.headline')}
          big={formatMoney(value)}
          rows={[]}
        />
      }
      aside={<SheetAside onay={isAuto ? t('advance.sheet.asideAuto') : t('advance.sheet.aside')} warning={warning} />}
    >
      <Field id="adv-amount" label={t('advance.sheet.amount')} error={errors.amount} className="mt-5.5">
        <MoneyInput
          {...fieldA11y('adv-amount', errors.amount)}
          value={amount}
          onChange={(v) => {
            setAmount(v)
            clear('amount')
          }}
        />
      </Field>

      <Field id="adv-reason" label={t('advance.sheet.reason')} hint={reasonHint} error={errors.reason} className="mt-5.5">
        <textarea
          {...fieldA11y('adv-reason', errors.reason, reasonHint)}
          value={reason}
          maxLength={300}
          rows={3}
          onChange={(e) => {
            setReason(e.target.value)
            clear('reason')
          }}
          placeholder={t('advance.sheet.reasonPlaceholder')}
          className="input min-h-13.5 resize-none"
        />
      </Field>
    </SheetLayout>
  )
}
