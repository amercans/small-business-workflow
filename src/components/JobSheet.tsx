import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { ConfirmDialog } from './ConfirmDialog'
import { Field, fieldA11y } from './Field'
import { Icon } from './Icon'
import { LinkedInvoices } from './LinkedInvoices'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Select } from './Select'
import { archiveJob, saveJob, type Job, type JobsPage, type PricedJob } from '#/data/jobs'
import { jobMoneySchema, jobSchema, jobTypeLabel, type JobKind, type JobType } from '#/lib/jobs'
import { formatDay } from '#/lib/leave'
import { formatAmount, parseMoney } from '#/lib/money'
import { useSubmit, type FailResult } from '#/lib/useSubmit'
import { t } from '#/i18n'

export interface JobTarget {
  job: Job | null
  focus?: 'amount'
}

const dayYear = (iso: string) => `${formatDay(iso)} ${iso.slice(0, 4)}`
const stamp = (iso: string) => dayYear(iso.slice(0, 10))

export function JobSheet({ target, page, onClose, onDone, onInvoicesChanged, returnKey }: { target: JobTarget | null; page: JobsPage; onClose: () => void; onDone: (message: string) => void; onInvoicesChanged: () => void; returnKey: string }) {
  const [confirming, setConfirming] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const dirty = useRef(false)
  const job = target?.job ?? null

  const setDirty = useCallback((d: boolean) => {
    dirty.current = d
  }, [])

  const requestClose = () => {
    if (dirty.current) setDiscarding(true)
    else onClose()
  }

  async function doArchive() {
    if (!job || archiving) return
    setArchiving(true)
    const r: { ok: true } | FailResult = await archiveJob({ id: job.id, version: job.version })
    setArchiving(false)
    if (!r.ok) {
      setArchiveError(r.error)
      setConfirming(false)
      return
    }
    setConfirming(false)
    onClose()
    onDone(t('jobs.sheet.archived', { title: job.title }))
  }

  return (
    <>
      <RequestSheet open={target !== null} onClose={requestClose} returnFocusKey={returnKey}>
        {target !== null &&
          (page.canWrite ? (
            <JobForm
              key={job?.id ?? 'new'}
              job={job}
              page={page}
              focus={target.focus}
              archiveError={archiveError}
              onArchive={() => {
                setArchiveError('')
                setConfirming(true)
              }}
              onClose={onClose}
              onCancel={requestClose}
              onDirty={setDirty}
              onDone={onDone}
              onChanged={onInvoicesChanged}
            />
          ) : (
            job && <JobReadOnly job={job} types={page.types} onClose={onClose} onChanged={onInvoicesChanged} />
          ))}
      </RequestSheet>
      <ConfirmDialog
        open={confirming}
        title={t('jobs.sheet.deleteTitle')}
        body={job ? t('jobs.sheet.deleteBody', { title: job.title }) : ''}
        confirmLabel={t('jobs.sheet.deleteConfirm')}
        busy={archiving}
        onConfirm={doArchive}
        danger
        onCancel={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={discarding}
        title={t('jobs.sheet.discardTitle')}
        body={t('jobs.sheet.discardBody')}
        confirmLabel={t('jobs.sheet.discardConfirm')}
        cancelLabel={t('jobs.sheet.backToEditing')}
        danger
        onConfirm={() => {
          setDiscarding(false)
          dirty.current = false
          onClose()
        }}
        onCancel={() => setDiscarding(false)}
      />
    </>
  )
}

const formSchema = z.object({ job: jobSchema, money: jobMoneySchema.optional() })

const pick = (errors: Record<string, string>, key: string) => errors[`job.${key}`] ?? errors[`money.${key}`] ?? errors[key]

function History({ job }: { job: Job }) {
  const changed = job.updatedAt.slice(0, 16) !== job.createdAt.slice(0, 16)
  return (
    <section aria-label={t('jobs.sheet.history')} className="mt-7.5 border-t border-hairline pt-4">
      <h4 className="text-micro font-semibold text-muted">{t('jobs.sheet.history')}</h4>
      <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0 text-link">
        <li className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-status-cancelled" />
            {t('jobs.sheet.added')}
          </span>
          <span className="num text-muted">{stamp(job.createdAt)}</span>
        </li>
        {changed && (
          <li className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-status-paid" />
              {t('jobs.sheet.lastChange')}
            </span>
            <span className="num text-muted">{stamp(job.updatedAt)}</span>
          </li>
        )}
      </ul>
    </section>
  )
}

const kindLabel = (types: JobType[], kind: JobKind) => jobTypeLabel(types.find((x) => x.id === kind), kind)

const KindChip = ({ label }: { label: string }) => (
  <p className="flex flex-wrap items-center gap-1.5">
    <span className="inline-flex h-6 items-center gap-1.25 rounded-full bg-wash px-2.5 text-micro font-semibold text-muted">
      <Icon name="jobs" size={12} strokeWidth={1.8} />
      {label}
    </span>
  </p>
)

const dates = (start: string | null | undefined, end: string | null | undefined) => (start && end ? `${dayYear(start)} – ${dayYear(end)}` : start ? dayYear(start) : end ? dayYear(end) : null)

function JobReadOnly({ job, types, onClose, onChanged }: { job: Job; types: JobType[]; onClose: () => void; onChanged: () => void }) {
  const row = (label: string, value: string | null) => (
    <div>
      <dt className="mb-1.5 text-micro font-semibold text-muted">{label}</dt>
      <dd className="m-0 text-label text-ink">{value || <span className="text-faint">—</span>}</dd>
    </div>
  )
  return (
    <SheetLayout
      title={job.title}
      subtitle={`${job.client}${job.unit ? ` · ${job.unit}` : ''}`}
      onSubmit={onClose}
      onCancel={onClose}
      hideSubmit
      cancelLabel={t('jobs.sheet.close')}
      summary={
        <div className="rounded-glass bg-surface p-4 max-lg:p-0">
          <KindChip label={kindLabel(types, job.kind)} />
          {dates(job.start, job.end) && <p className="num mt-3 text-link text-muted">{dates(job.start, job.end)}</p>}
        </div>
      }
      aside={<SheetAside onay={t('jobs.sheet.readOnlyAside')} />}
    >
      <dl className="m-0 mt-5 flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {row(t('jobs.sheet.client'), job.client)}
          {row(t('jobs.sheet.unit'), job.unit)}
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {row(t('jobs.sheet.kind'), kindLabel(types, job.kind))}
          {row(t('jobs.sheet.start'), job.start ? dayYear(job.start) : null)}
          {row(t('jobs.sheet.end'), job.end ? dayYear(job.end) : null)}
        </div>
        {row(t('jobs.sheet.note'), job.note)}
      </dl>
      {job.invoices && <LinkedInvoices className="mt-7.5 border-t border-hairline pt-5" kind="job" targetId={job.id} targetLabel={job.title} invoices={job.invoices} onChanged={onChanged} />}
      <History job={job} />
    </SheetLayout>
  )
}

function JobForm({
  job,
  page,
  focus,
  archiveError,
  onArchive,
  onClose,
  onCancel,
  onDirty,
  onDone,
  onChanged,
}: {
  job: Job | null
  page: JobsPage
  focus?: 'amount'
  archiveError: string
  onArchive: () => void
  onClose: () => void
  onCancel: () => void
  onDirty: (dirty: boolean) => void
  onDone: (message: string) => void
  onChanged: () => void
}) {
  const money = page.money
  const priced = money && job ? (job as PricedJob) : null
  const [client, setClient] = useState(job?.client ?? '')
  const [unit, setUnit] = useState(job?.unit ?? '')
  const [title, setTitle] = useState(job?.title ?? '')
  const [kind, setKind] = useState<JobKind | ''>(job?.kind ?? '')
  const [start, setStart] = useState(job?.start ?? '')
  const [end, setEnd] = useState(job?.end ?? '')
  const [note, setNote] = useState(job?.note ?? '')
  const [amount, setAmount] = useState(priced?.amount == null ? '' : formatAmount(priced.amount))
  const [notBillable, setNotBillable] = useState(priced?.notBillable ?? false)
  const amountRef = useRef<HTMLDivElement>(null)

  const snap = JSON.stringify([client, unit, title, kind, start, end, note, amount, notBillable])
  const [initialSnap] = useState(snap)
  const isDirty = snap !== initialSnap
  useEffect(() => {
    onDirty(isDirty)
  }, [isDirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  useEffect(() => {
    if (focus !== 'amount') return
    const id = requestAnimationFrame(() => amountRef.current?.querySelector('input')?.focus())
    return () => cancelAnimationFrame(id)
  }, [focus])

  const amountN = parseMoney(amount)

  const { errors, warning, busy, run, clear } = useSubmit({
    schema: formSchema,
    submit: (input) => saveJob(input as Parameters<typeof saveJob>[0]),
    onClose,
    onSubmitted: () => onDone(job ? t('jobs.sheet.saved', { title: title.trim() }) : t('jobs.sheet.created', { title: title.trim() })),
    build: () => ({
      job: { id: job?.id, version: job?.version, client, title, unit: unit || undefined, kind: kind || undefined, start: start || undefined, end: end || undefined, note: note || undefined },
      ...(money ? { money: { amount: notBillable ? null : amountN, notBillable } } : {}),
    }),
  })
  const err = (k: string) => pick(errors, k)

  return (
    <SheetLayout
      title={job ? t('jobs.sheet.editTitle') : t('jobs.sheet.addTitle')}
      subtitle={job ? `${job.client} · ${kindLabel(page.types, job.kind)}` : t('jobs.sheet.newSubtitle')}
      submitLabel={t('jobs.sheet.save')}
      onSubmit={run}
      onCancel={onCancel}
      busy={busy}
      summary={
        money ? (
          <MoneyPanel
            amount={amount}
            onAmount={(v) => {
              setAmount(v)
              clear('job.amount')
              clear('amount')
            }}
            amountError={err('amount')}
            amountRef={amountRef}
            notBillable={notBillable}
            onNotBillable={(v) => {
              setNotBillable(v)
              clear('job.amount')
              clear('amount')
            }}
          />
        ) : (
          <div className="rounded-glass bg-surface p-4 max-lg:p-0">
            {kind && <KindChip label={kindLabel(page.types, kind)} />}
            <p className="num mt-3 text-link text-muted">{dates(start, end) ?? t('jobs.sheet.noDate')}</p>
          </div>
        )
      }
      aside={
        <SheetAside
          onay={job ? t('jobs.sheet.asideEdit') : t('jobs.sheet.asideNew')}
          warning={warning || archiveError}
          extra={!money && <p className="mt-2 text-small text-muted">{t('jobs.sheet.amountManagersOnly')}</p>}
        />
      }
      footer={
        job && (
          <button type="button" onClick={onArchive} className="text-link font-medium text-status-rejected">
            {t('jobs.sheet.delete')}
          </button>
        )
      }
    >
      <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
        <Field id="job-client" label={t('jobs.sheet.client')} error={err('client')}>
          <input {...fieldA11y('job-client', err('client'))} type="text" list="job-clients" autoComplete="off" maxLength={120} value={client} onChange={(e) => { setClient(e.target.value); clear('job.client'); clear('client') }} className="input" />
          <datalist id="job-clients">
            {page.clients.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field id="job-unit" label={t('jobs.sheet.unit')} optional error={err('unit')}>
          <input {...fieldA11y('job-unit', err('unit'))} type="text" maxLength={120} value={unit} onChange={(e) => { setUnit(e.target.value); clear('job.unit'); clear('unit') }} className="input" />
        </Field>
      </div>

      <Field id="job-title" label={t('jobs.sheet.title')} error={err('title')} className="mt-5.5">
        <input {...fieldA11y('job-title', err('title'))} type="text" maxLength={200} value={title} onChange={(e) => { setTitle(e.target.value); clear('job.title'); clear('title') }} className="input" />
      </Field>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-[1.2fr_1fr_1fr]">
        <Field id="job-kind" label={t('jobs.sheet.kind')} error={err('kind')}>
          <Select {...fieldA11y('job-kind', err('kind'))} value={kind} onChange={(e) => { setKind(e.target.value as JobKind); clear('job.kind'); clear('kind') }}>
            <option value="" disabled>
              {t('jobs.sheet.choose')}
            </option>
            {page.types
              .filter((k) => !k.archived || k.id === job?.kind)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {jobTypeLabel(k)}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="job-start" label={t('jobs.sheet.start')} optional error={err('start')}>
          <input {...fieldA11y('job-start', err('start'))} type="date" value={start} onChange={(e) => { setStart(e.target.value); clear('job.start'); clear('start'); clear('job.end'); clear('end') }} className="input" />
        </Field>
        <Field id="job-end" label={t('jobs.sheet.end')} optional error={err('end')}>
          <input {...fieldA11y('job-end', err('end'))} type="date" min={start || undefined} value={end} onChange={(e) => { setEnd(e.target.value); clear('job.end'); clear('end') }} className="input" />
        </Field>
      </div>

      <Field id="job-note" label={t('jobs.sheet.note')} optional error={err('note')} className="mt-5.5">
        <textarea {...fieldA11y('job-note', err('note'))} rows={3} maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); clear('job.note'); clear('note') }} className="input min-h-20 resize-none" />
      </Field>

      {job?.invoices && <LinkedInvoices className="mt-7.5 border-t border-hairline pt-5" kind="job" targetId={job.id} targetLabel={job.title} invoices={job.invoices} onChanged={onChanged} />}
      {job && <History job={job} />}
    </SheetLayout>
  )
}

function MoneyPanel({
  amount,
  onAmount,
  amountError,
  amountRef,
  notBillable,
  onNotBillable,
}: {
  amount: string
  onAmount: (v: string) => void
  amountError?: string
  amountRef: React.RefObject<HTMLDivElement | null>
  notBillable: boolean
  onNotBillable: (v: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="inline-flex h-7 w-fit items-center rounded-full bg-blue/18 px-3 text-micro font-semibold text-blue-ink">{t('jobs.sheet.managersOnly')}</p>
      <div ref={amountRef} className="rounded-glass bg-surface p-4 max-lg:p-0">
        {notBillable ? (
          <div>
            <span className="mb-1.5 block text-micro font-semibold text-muted">{t('jobs.sheet.amount')}</span>
            <p className="text-link text-faint">{t('jobs.sheet.noAmountWhenNotBillable')}</p>
          </div>
        ) : (
          <Field id="job-amount" label={t('jobs.sheet.amount')} optional error={amountError} hint={t('jobs.sheet.amountHint')}>
            <MoneyInput {...fieldA11y('job-amount', amountError, 'x')} value={amount} onChange={onAmount} />
          </Field>
        )}
        <label className="mt-3.5 flex cursor-pointer items-start gap-2.5 text-link font-medium text-ink">
          <input type="checkbox" checked={notBillable} onChange={(e) => onNotBillable(e.target.checked)} className="mt-0.5 size-4.5 shrink-0 accent-(--color-blue-ink)" />
          <span>
            {t('jobs.sheet.notBillable')}
            <small className="mt-0.5 block text-micro font-normal text-faint">{t('jobs.sheet.notBillableHint')}</small>
          </span>
        </label>
      </div>
    </div>
  )
}
