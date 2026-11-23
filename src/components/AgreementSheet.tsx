import { useState } from 'react'
import { Field, fieldA11y } from './Field'
import { FileField } from './FileField'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Segmented } from './Segmented'
import { SummaryCard } from './SummaryCard'
import { agreementSchema, submitAgreement, type Agreement, type AgreementPeriod } from '#/data/agreements'
import { useSession } from '#/lib/useSession'
import { daysLeft, periodName, periodUnit } from '#/lib/agreements'
import { formatDay } from '#/lib/leave'
import { formatMoney, parseMoney } from '#/lib/money'
import { useSubmit } from '#/lib/useSubmit'
import { t, tn } from '#/i18n'

const PERIOD_VALUES: AgreementPeriod[] = ['yearly', 'monthly', 'one_time']

export function AgreementSheet({ open, onClose, onAdded, tags }: { open: boolean; onClose: () => void; onAdded: (a: Agreement) => void; tags: string[] }) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="add-agreement">
      <AgreementForm onClose={onClose} onAdded={onAdded} tags={tags} />
    </RequestSheet>
  )
}

function AgreementForm({ onClose, onAdded, tags }: { onClose: () => void; onAdded: (a: Agreement) => void; tags: string[] }) {
  const TODAY_ISO = useSession().todayISO
  const [file, setFile] = useState<File | null>(null)
  const [counterparty, setCounterparty] = useState('')
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState<AgreementPeriod>('yearly')
  const [tag, setTag] = useState('')
  const [note, setNote] = useState('')

  const { errors, warning, busy, run, clear } = useSubmit({
    schema: agreementSchema,
    submit: submitAgreement,
    onClose,
    onSubmitted: (r) => onAdded(r.agreement),
    build: () => ({
      counterparty,
      title,
      start: start || undefined,
      end: end || undefined,
      amount: parseMoney(amount) ?? undefined,
      period,
      tag: tag || undefined,
      note: note || undefined,
      pdfName: file?.name,
      file: file ?? undefined,
    }),
  })

  const value = parseMoney(amount) ?? 0
  const left = end ? daysLeft(end, TODAY_ISO) : null

  return (
    <SheetLayout
      title={t('agreements.add')}
      subtitle={t('agreements.sheet.subtitle')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone="leave"
          kicker={t('agreements.sheet.kicker')}
          headline={counterparty.trim() || t('agreements.counterparty')}
          big={formatMoney(value)}
          unit={`/ ${periodUnit(period)}`}
          rows={[
            ...(start && end ? [{ label: t('agreements.sheet.term'), value: `${formatDay(start)} – ${formatDay(end)}` }] : []),
            ...(left !== null && left >= 0 ? [{ label: t('agreements.sheet.untilEnd'), value: tn('agreements.days', left) }] : []),
            ...(tag.trim() ? [{ label: t('agreements.tag'), value: tag.trim() }] : []),
          ]}
        />
      }
      aside={<SheetAside onay={t('agreements.sheet.aside')} warning={warning} />}
    >
      <Field id="ag-file" label={t('agreements.sheet.pdf')} className="mt-5">
        <FileField
          id="ag-file"
          pdfOnly
          file={file}
          invalid={!!errors.pdfName}
          error={errors.pdfName}
          onChange={(f) => {
            setFile(f)
            clear('pdfName')
          }}
        />
      </Field>

      <Field id="ag-cp" label={t('agreements.counterparty')} error={errors.counterparty} className="mt-5.5">
        <input
          {...fieldA11y('ag-cp', errors.counterparty)}
          type="text"
          maxLength={200}
          value={counterparty}
          onChange={(e) => {
            setCounterparty(e.target.value)
            clear('counterparty')
          }}
          className="input"
        />
      </Field>

      <Field id="ag-title" label={t('agreements.subject')} error={errors.title} className="mt-5.5">
        <input
          {...fieldA11y('ag-title', errors.title)}
          type="text"
          maxLength={200}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            clear('title')
          }}
          placeholder={t('agreements.sheet.subjectPlaceholder')}
          className="input"
        />
      </Field>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-2">
        <Field id="ag-start" label={t('agreements.start')} error={errors.start}>
          <input
            {...fieldA11y('ag-start', errors.start)}
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
              clear('start')
            }}
            className="input"
          />
        </Field>
        <Field id="ag-end" label={t('agreements.end')} error={errors.end}>
          <input
            {...fieldA11y('ag-end', errors.end)}
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => {
              setEnd(e.target.value)
              clear('end')
            }}
            className="input"
          />
        </Field>
      </div>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-[1fr_auto] sm:items-start">
        <Field id="ag-amount" label={t('agreements.amountNet')} error={errors.amount}>
          <MoneyInput
            {...fieldA11y('ag-amount', errors.amount)}
            value={amount}
            onChange={(v) => {
              setAmount(v)
              clear('amount')
            }}
          />
        </Field>
        <div>
          <span className="mb-2.5 block text-micro font-semibold text-muted">{t('agreements.sheet.period')}</span>
          <Segmented label={t('agreements.sheet.period')} value={period} options={PERIOD_VALUES.map((value) => ({ value, label: periodName(value) }))} onChange={setPeriod} />
        </div>
      </div>

      <Field id="ag-tag" label={t('agreements.tag')} optional className="mt-5.5">
        <input id="ag-tag" list="ag-tags" type="text" maxLength={60} value={tag} onChange={(e) => setTag(e.target.value)} className="input" />
        <datalist id="ag-tags">
          {tags.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </Field>

      <Field id="ag-note" label={t('agreements.note')} optional error={errors.note} className="mt-5.5">
        <textarea id="ag-note" value={note} maxLength={2000} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
      </Field>
    </SheetLayout>
  )
}
