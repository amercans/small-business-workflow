import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from './ConfirmDialog'
import { Icon } from './Icon'
import { FileField } from './FileField'
import { addLeaveReport, cancelRequest, closeAdvance, type MyRequest, type RequestStatus } from '#/data/home'
import { clientError } from '#/lib/clientError'
import { lastRequestsSearch } from '#/lib/requestsFilter'
import { t } from '#/i18n'

const dotBg: Record<RequestStatus, string> = {
  pending: 'bg-status-pending',
  approved: 'bg-status-approved',
  rejected: 'bg-status-rejected',
  paid: 'bg-status-paid',
  cancelled: 'bg-status-cancelled',
}
const barBg: Record<MyRequest['type'], string> = {
  leave: 'bg-type-leave',
  expense: 'bg-type-expense',
  advance: 'bg-type-advance',
  purchase: 'bg-type-purchase',
  travel: 'bg-type-travel',
}

type StepState = 'done' | 'current' | 'todo' | 'rejected' | 'cancelled'
interface Step {
  label: string
  at?: string
  note?: string
  state: StepState
}

function timeline(r: MyRequest): Step[] {
  const d = r.detail
  const steps: Step[] = [{ label: t('requests.detail.submitted'), at: d.submittedAt, state: 'done' }]
  if (r.status === 'pending') steps.push({ label: t('requests.detail.decision'), note: t('requests.detail.waitingOn', { name: d.waitingOn ?? d.approver }), state: 'current' })
  else if (r.status === 'rejected') steps.push({ label: t('requests.detail.rejected'), at: d.decidedAt, state: 'rejected' })
  else if (r.status === 'cancelled') {
    if (d.decidedAt) steps.push({ label: t('requests.detail.approved'), at: d.decidedAt, state: 'done' })
    steps.push({ label: t('requests.detail.cancelled'), at: d.cancelledAt, state: 'cancelled' })
  }
  else steps.push({ label: t('requests.detail.approved'), at: d.decidedAt, state: 'done' })

  const payable = r.type === 'expense' || r.type === 'advance'
  if (payable && r.status !== 'rejected' && r.status !== 'cancelled') {
    steps.push({ label: t('requests.detail.paid'), at: d.paidAt, state: r.status === 'paid' ? 'done' : 'todo' })
  }
  if (r.type === 'advance' && d.closure) {
    const c = d.closure
    steps.push({ label: t('requests.detail.advanceClosed'), at: c.closedAt, note: c.closedAt ? undefined : t('requests.detail.closeWhenDone'), state: c.closedAt ? 'done' : 'todo' })
    if (c.closedAt && c.hasRefund) steps.push({ label: t('requests.detail.refundReceived'), at: c.refundReceivedAt, note: c.refundReceivedAt ? undefined : t('requests.detail.refundExpected', { amount: c.refund }), state: c.refundReceivedAt ? 'done' : 'todo' })
  }
  return steps
}

const stepDot: Record<StepState, string> = {
  done: 'bg-blue',
  current: 'bg-surface shadow-today',
  todo: 'bg-surface shadow-step-todo',
  rejected: 'bg-status-rejected',
  cancelled: 'bg-status-cancelled',
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="mb-3 text-label font-semibold text-muted">{children}</h2>
}

export function RequestDetail({ r, statusLabel, back, requesterName, canCancel }: { r: MyRequest; statusLabel: Record<RequestStatus, string>; back: 'mine' | 'all'; requesterName?: string; canCancel: boolean }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<File | null>(null)
  const [reportError, setReportError] = useState('')
  const d = r.detail

  async function doClose() {
    setBusy(true)
    setError('')
    const res = await closeAdvance(r.id, closeNote.trim() || undefined).catch((e) => ({ ok: false as const, error: clientError(e) }))
    if (!res.ok) setError(res.error)
    await router.invalidate()
    setBusy(false)
    setClosing(false)
  }

  async function doAddReport() {
    if (!report) {
      setReportError(t('requests.detail.pickReport'))
      return
    }
    setBusy(true)
    setReportError('')
    const res = await addLeaveReport(r.id, report)
    if (!res.ok) setReportError(res.error)
    else setReport(null)
    await router.invalidate()
    setBusy(false)
  }

  async function doCancel() {
    setBusy(true)
    const res = await cancelRequest(r.id).catch((e) => ({ ok: false as const, error: clientError(e) }))
    if (!res.ok) setError(res.error)
    await router.invalidate()
    setBusy(false)
    setConfirm(false)
  }

  return (
    <article className="max-w-3xl pb-10">
      {back === 'all' ? (
        <Link to="/all-requests" className="-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink">
          <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
          {t('nav.all')}
        </Link>
      ) : (
        <Link to="/requests" search={lastRequestsSearch() as never} className="-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink">
          <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
          {t('nav.mine')}
        </Link>
      )}

      <header className="mt-4 flex items-start gap-4">
        <i className={`mt-1.5 block h-12 w-1 shrink-0 rounded-full ${barBg[r.type]}`} aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-sheet-title font-semibold sm:text-display-sm">{r.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
            <span>
              {requesterName && <b className="font-semibold text-ink">{requesterName} · </b>}
              {r.typeLabel} · {r.date}
            </span>
            <span className="inline-flex items-center gap-1.5 text-link font-medium">
              <span className={`size-1.75 rounded-full ${dotBg[r.status]}`} />
              {statusLabel[r.status]}
            </span>
            {r.amount && <b className="num font-semibold text-ink">{r.amount}</b>}
          </p>
        </div>
      </header>

      {d.rejectReason && (
        <div className="mt-6 rounded-note bg-reject-wash px-4 py-3.5" role="note">
          <b className="block text-link font-semibold text-status-rejected">{t('requests.detail.rejectReason')}</b>
          <p className="mt-1 text-label text-ink">{d.rejectReason}</p>
        </div>
      )}

      <section className="mt-8" aria-labelledby="tl-title">
        <h2 id="tl-title" className="mb-3 text-label font-semibold text-muted">
          {t('requests.status')}
        </h2>
        <ol className="m-0 list-none kar rounded-3xl p-5 ">
          {timeline(r).map((s, i, all) => (
            <li key={s.label} className="relative flex gap-4 pb-5 last:pb-0">
              {i < all.length - 1 && <span aria-hidden="true" className="absolute top-4.5 bottom-0 left-1.75 w-px bg-hairline-strong" />}
              <span aria-hidden="true" className={`relative mt-1 size-3.5 shrink-0 rounded-full ${stepDot[s.state]}`} />
              <div>
                <b className={`block text-row font-medium ${s.state === 'todo' ? 'text-faint' : ''}`}>{s.label}</b>
                {(s.at || s.note) && <span className="text-micro text-faint">{s.at ?? s.note}</span>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {d.items && d.items.length > 0 && (
        <section className="mt-8">
          <SectionTitle>{t('requests.detail.items')}</SectionTitle>
          <ul className="m-0 list-none kar rounded-3xl px-5 ">
            {d.items.map((it, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 border-t border-hairline py-3.5 first:border-0">
                <div className="min-w-0">
                  <b className="block text-row font-medium">{it.label}</b>
                  {it.sub && <span className="text-micro text-faint">{it.sub}</span>}
                </div>
                {it.amount && <span className="num shrink-0 text-ui font-semibold text-muted">{it.amount}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.totals && (
        <section className="mt-8">
          <SectionTitle>{t('requests.detail.payment')}</SectionTitle>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 kar rounded-3xl p-5 text-label">
            <dt className="text-muted">{t('requests.detail.subtotal')}</dt>
            <dd className="num m-0 text-right">{d.totals.subtotal}</dd>
            {d.totals.hasOffset && (
              <>
                <dt className="text-muted">{t('requests.detail.advanceOffset')}</dt>
                <dd className="num m-0 text-right">−{d.totals.offset}</dd>
              </>
            )}
            <dt className="font-semibold">{t('requests.detail.netPayable')}</dt>
            <dd className="num m-0 text-right font-semibold">{d.totals.net}</dd>
          </dl>
        </section>
      )}

      {d.closure && (
        <section className="mt-8" aria-labelledby="close-title">
          <h2 id="close-title" className="mb-3 text-label font-semibold text-muted">
            {t('requests.detail.closing')}
          </h2>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 kar rounded-3xl p-5 text-label">
            <dt className="text-muted">{t('requests.detail.advancePaid')}</dt>
            <dd className="num m-0 text-right">{d.closure.paid}</dd>
            <dt className="text-muted">{t('requests.detail.documentedSpend')}</dt>
            <dd className="num m-0 text-right">{d.closure.spent}</dd>
            <dt className="font-semibold">{t('requests.detail.refundDiff')}</dt>
            <dd className="num m-0 text-right font-semibold">{d.closure.refund}</dd>
            {d.closure.closedAt && (
              <>
                <dt className="text-muted">{t('requests.detail.closedOn')}</dt>
                <dd className="m-0 text-right">{d.closure.closedAt}</dd>
              </>
            )}
            {d.closure.note && (
              <>
                <dt className="text-muted">{t('requests.detail.note')}</dt>
                <dd className="m-0 min-w-0 text-right break-words">{d.closure.note}</dd>
              </>
            )}
          </dl>
          {d.closure.settling && (
            <p className="mt-3 text-small text-muted">{t('requests.detail.settling', { count: d.closure.settling })}</p>
          )}
          {canCancel && d.closure.canClose && (
            <div className="mt-4">
              <button type="button" onClick={() => setClosing(true)} className="btn btn-pri">
                {t('requests.detail.closeAdvance')}
              </button>
              <p className="mt-2 text-micro text-faint">{t('requests.detail.closeHint')}</p>
              {error && (
                <p role="alert" className="mt-2 text-small text-status-rejected">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="mt-8">
        <SectionTitle>{t('requests.detail.details')}</SectionTitle>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 kar rounded-3xl p-5 text-label ">
          {d.fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted">{f.label}</dt>
              <dd className="m-0 min-w-0 break-words">{f.value}</dd>
            </div>
          ))}
          <dt className="text-muted">{t('requests.detail.approver')}</dt>
          <dd className="m-0">{d.approver}</dd>
          <dt className="text-muted">{t('requests.detail.submittedAt')}</dt>
          <dd className="m-0">{d.submittedAt}</dd>
        </dl>
      </section>

      {d.attachments && d.attachments.length > 0 && (
        <section className="mt-8">
          <SectionTitle>{t('requests.detail.attachments')}</SectionTitle>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {d.attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={`/files/${a.id}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-2 btn-sec rounded-full px-3.5 py-2 text-link text-ink no-underline hover:bg-wash-hover"
                >
                  <Icon name="paper" size={14} strokeWidth={1.8} className="text-faint" />
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.canAddReport && (
        <section className="mt-8" aria-labelledby="report-title">
          <h2 id="report-title" className="mb-3 text-label font-semibold text-muted">
            {t('requests.detail.healthReport')}
          </h2>
          <div className="kar rounded-3xl p-5">
            <FileField id="late-report" file={report} onChange={setReport} error={reportError} capture />
            <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={doAddReport} disabled={busy} className="btn btn-pri">
                {busy ? t('requests.detail.adding') : t('requests.detail.addReport')}
              </button>
              <p className="m-0 min-w-0 flex-1 text-micro text-faint">
                {t('requests.detail.reportHint')}
              </p>
            </div>
          </div>
        </section>
      )}

      {canCancel && (r.status === 'pending' || r.cancellable) && (
        <div className="mt-8">
          <button type="button" onClick={() => setConfirm(true)} className="btn btn-sec">
            {r.cancellable ? t('requests.detail.cancelLeave') : t('requests.detail.cancelRequest')}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-small text-status-rejected">
              {error}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={closing}
        title={t('requests.detail.closeTitle')}
        body={d.closure ? t('requests.detail.closeBody', { spent: d.closure.spent, refund: d.closure.refund }) : ''}
        confirmLabel={t('requests.detail.closeConfirm')}
        cancelLabel={t('requests.detail.keep')}
        busy={busy}
        onConfirm={doClose}
        onCancel={() => setClosing(false)}
      >
        <label htmlFor="close-note" className="mt-4 mb-2 block text-micro font-semibold text-muted">
          {t('requests.detail.note')} <span className="font-normal">{t('requests.detail.optional')}</span>
        </label>
        <textarea id="close-note" rows={2} maxLength={500} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder={t('requests.detail.closeNotePlaceholder')} className="input resize-none" />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm}
        title={r.cancellable ? t('requests.detail.cancelLeaveTitle') : t('requests.detail.cancelRequestTitle')}
        body={r.cancellable ? t('requests.detail.cancelLeaveBody') : t('requests.detail.cancelRequestBody')}
        confirmLabel={t('requests.detail.cancelConfirm')}
        cancelLabel={t('requests.detail.keep')}
        busy={busy}
        onConfirm={doCancel}
        onCancel={() => setConfirm(false)}
      />
    </article>
  )
}
