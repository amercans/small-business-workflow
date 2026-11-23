import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { ApprovalDocs } from '#/components/ApprovalDocs'
import { ApprovalPass } from '#/components/ApprovalPass'
import { Avatar } from '#/components/Avatar'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { decide, decideInvoice, loadApprovals, markPaid, oldestDays, refundReceived, type ApprovalRequest, type PendingInvoice } from '#/data/approvals'
import { dateLabel } from '#/data/invoices'
import { guard } from '#/lib/guard'
import { spr, prefersReducedMotion } from '#/lib/motion'
import { canMarkPaid } from '#/lib/permissions'
import { useFlip } from '#/lib/useFlip'
import { t, tn } from '#/i18n'

export const Route = createFileRoute('/approvals')({
  beforeLoad: guard('approvals'),
  loader: () => loadApprovals(),
  component: Approvals,
})

const rootApi = getRouteApi('__root__')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const statusText = (s: string) => (s === 'approved' || s === 'rejected' || s === 'paid' || s === 'pending' ? t(`approvals.status.${s}`) : '')
const STATUS_COLOR = { approved: 'text-status-approved', rejected: 'text-status-rejected', paid: 'text-status-paid' } as const

function Approvals() {
  const { session } = rootApi.useRouteContext()
  const user = session.user
  const router = useRouter()
  const { pending, decided, todayISO, refunds, invoices } = Route.useLoaderData()
  const [invBusy, setInvBusy] = useState<string | null>(null)
  const [invRejecting, setInvRejecting] = useState<PendingInvoice | null>(null)
  const [invReason, setInvReason] = useState('')
  const [invReasonError, setInvReasonError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stampText, setStampText] = useState(() => t('approvals.status.approved'))
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [error, setError] = useState('')

  const passRef = useRef<HTMLDivElement>(null)
  const stampRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const passWrap = useRef<HTMLDivElement>(null)

  const current: ApprovalRequest | undefined = pending.find((p) => p.id === selectedId) ?? pending[0]

  useFlip(listRef, pending.map((p) => p.id).join())

  const firstPass = useRef(true)
  useLayoutEffect(() => {
    if (firstPass.current) {
      firstPass.current = false
      return
    }
    if (passRef.current) spr(passRef.current, [{ opacity: 0, transform: 'translateY(60px) scale(.96)' }, { opacity: 1, transform: 'none' }], 700, 'spring', { delay: 120 })
  }, [current?.id])

  const prevDecided = useRef<Set<string> | null>(null)
  useLayoutEffect(() => {
    const ids = new Set(decided.map((d) => d.id))
    const before = prevDecided.current
    prevDecided.current = ids
    if (!before) return
    trayRef.current?.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
      if (!before.has(el.dataset.id as string)) spr(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], 500, 'settle', { delay: 520 })
    })
  })

  async function finish(decision: 'approved' | 'rejected', note?: string) {
    if (!current || busy) return
    setBusy(true)
    setError('')
    setStampText(statusText(decision))
    const el = passRef.current
    const item = listRef.current?.querySelector<HTMLElement>(`[data-id="${current.id}"]`)
    const reduced = prefersReducedMotion()
    if (stampRef.current) spr(stampRef.current, [{ opacity: 0, transform: 'rotate(-8deg) scale(.4)' }, { opacity: 1, transform: 'rotate(-8deg) scale(1)' }], 520, 'spring')
    await sleep(reduced ? 80 : 420)
    if (el && trayRef.current) {
      const pr = el.getBoundingClientRect()
      const tr = trayRef.current.getBoundingClientRect()
      spr(el, [{ transform: 'none', opacity: 1 }, { transform: `translate(${tr.left - pr.left}px,${tr.bottom - pr.top}px) scale(.12)`, opacity: 0 }], 720, 'settle')
    }
    if (item) spr(item, [{ opacity: 1, transform: 'translateX(6px)' }, { opacity: 0, transform: 'translateX(-40px)' }], 420, 'settle')
    await sleep(reduced ? 120 : 640)
    const res = await decide(current.id, decision, note)
    if (!res.ok) setError(res.error)
    setSelectedId(null)
    await router.invalidate()
    setBusy(false)
  }

  function submitReject() {
    if (!reason.trim()) {
      setReasonError(t('approvals.reasonRequired'))
      return
    }
    const note = reason
    setRejecting(false)
    setReason('')
    setReasonError('')
    void finish('rejected', note)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || rejecting || invRejecting) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [role="dialog"], [role="alertdialog"]')) return
      const idx = pending.findIndex((p) => p.id === current?.id)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = pending[Math.min(pending.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
        if (next) setSelectedId(next.id)
      } else if (e.key.toLowerCase() === 'a' && current && !busy) {
        e.preventDefault()
        void finish('approved')
      } else if (e.key.toLowerCase() === 'r' && current && !busy) {
        e.preventDefault()
        setRejecting(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function select(id: string) {
    setSelectedId(id)
    if (window.matchMedia('(max-width: 63.99rem)').matches) setTimeout(() => passWrap.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const days = oldestDays(pending, todayISO)

  async function decideInv(inv: PendingInvoice, decision: 'approved' | 'rejected', note?: string) {
    if (invBusy) return
    setInvBusy(inv.id)
    setError('')
    const res = await decideInvoice(inv.id, inv.version, decision, note)
    if (!res.ok) setError(res.error)
    await router.invalidate()
    setInvBusy(null)
  }

  function submitInvReject() {
    if (!invRejecting) return
    if (!invReason.trim()) {
      setInvReasonError(t('approvals.reasonRequired'))
      return
    }
    const inv = invRejecting
    const note = invReason
    setInvRejecting(null)
    setInvReason('')
    setInvReasonError('')
    void decideInv(inv, 'rejected', note)
  }

  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('nav.approve')}</h1>
      <p className="mt-2.5 text-label text-muted">
        {pending.length > 0 ? t('approvals.summary', { count: pending.length, oldest: days > 0 ? tn('approvals.daysAgo', days) : t('approvals.today') }) : t('approvals.none')}
      </p>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6.5 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_14.75rem]">
        <div className="lg:row-span-2 xl:row-span-1">
          <h2 className="flex justify-between px-1.5 pb-3 text-ui font-semibold text-muted">
            <span>{t('approvals.queue')}</span>
            <span className="num">{pending.length}</span>
          </h2>
          <ul ref={listRef} className="m-0 list-none p-0" aria-label={t('approvals.queueLabel')}>
            {pending.map((p) => {
              const on = p.id === current?.id
              return (
                <li key={p.id} data-id={p.id} className={`mb-2 transition-transform duration-300 ease-settle ${on ? 'translate-x-1.5' : ''}`}>
                  <button
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => select(p.id)}
                    className={`grid w-full grid-cols-[2.25rem_1fr_auto] items-center gap-3 rounded-icon bg-surface px-3.5 py-3 text-left ${on ? 'shadow-queue-on' : 'shadow-ticket'}`}
                  >
                    <Avatar name={p.who} hue={p.hue} className="size-9" />
                    <span className="min-w-0">
                      <b className="block truncate text-ui font-medium">{p.title}</b>
                      <span className="text-micro text-faint">
                        {p.who} · {p.typeLabel} · {p.date}
                      </span>
                    </span>
                    <span className="num text-right text-link font-semibold">{p.amount || '—'}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div ref={trayRef} className="mt-5.5 rounded-tray border border-dashed border-dash bg-wash-hover px-4 py-3.5">
            <h3 className="flex justify-between text-small font-semibold text-muted">
              <span>{t('approvals.decidedToday')}</span>
              <span className="num">{decided.length}</span>
            </h3>
            <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
              {decided.map((d) => (
                <li key={d.id} data-id={d.id} className="flex items-center justify-between gap-3 rounded-day bg-surface px-3 py-2 text-small shadow-me">
                  <span className="min-w-0 truncate">
                    {d.title} · {d.who}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {canMarkPaid(user, d) && (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await markPaid(d.id)
                          if (!res.ok) setError(res.error)
                          await router.invalidate()
                        }}
                        className="rounded-full bg-wash px-2.5 py-1 text-tab font-medium text-ink"
                      >
                        {t('approvals.markPaid')}
                      </button>
                    )}
                    <span className={`font-medium ${STATUS_COLOR[d.status as keyof typeof STATUS_COLOR] ?? 'text-faint'}`}>
                      {statusText(d.status)}
                    </span>
                  </span>
                </li>
              ))}
              {decided.length === 0 && <li className="text-micro text-faint">{t('approvals.noDecisions')}</li>}
            </ul>
          </div>

          {invoices.length > 0 && (
            <div className="mt-4 rounded-tray border border-dashed border-dash bg-wash-hover px-4 py-3.5">
              <h3 className="flex justify-between text-small font-semibold text-muted">
                <span>{t('approvals.pendingInvoices')}</span>
                <span className="num">{invoices.length}</span>
              </h3>
              <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0" aria-label={t('approvals.pendingInvoices')}>
                {invoices.map((f) => (
                  <li key={f.id} className="rounded-day bg-surface px-3 py-2.5 text-small shadow-me">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <b className="block truncate font-semibold">{f.firm}</b>
                        <span className="block truncate text-micro text-faint">
                          {f.no} · {dateLabel(f.date)} · {f.who}
                        </span>
                      </span>
                      <b className="num shrink-0 font-semibold">{f.total}</b>
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" disabled={invBusy === f.id} onClick={() => void decideInv(f, 'approved')} className="btn-tint rounded-full px-3 py-1 text-tab font-medium">
                        {t('approvals.approve')}
                      </button>
                      <button type="button" disabled={invBusy === f.id} onClick={() => setInvRejecting(f)} className="rounded-full bg-wash px-3 py-1 text-tab font-medium text-ink">
                        {t('approvals.reject')}
                      </button>
                      {f.fileId && (
                        <a href={`/files/${f.fileId}`} target="_blank" rel="noreferrer" className="ml-auto text-tab text-muted underline-offset-2 hover:text-ink hover:underline">
                          {t('approvals.openInvoice')}
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {refunds.length > 0 && (
            <div className="mt-4 rounded-tray border border-dashed border-dash bg-wash-hover px-4 py-3.5">
              <h3 className="flex justify-between text-small font-semibold text-muted">
                <span>{t('approvals.refundsDue')}</span>
                <span className="num">{refunds.length}</span>
              </h3>
              <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
                {refunds.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 rounded-day bg-surface px-3 py-2 text-small shadow-me">
                    <span className="min-w-0 truncate">
                      {f.who} · <b className="num font-semibold">{f.amount}</b> · {f.closedAt}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await refundReceived(f.id)
                        if (!res.ok) setError(res.error)
                        await router.invalidate()
                      }}
                      className="shrink-0 rounded-full bg-wash px-2.5 py-1 text-tab font-medium text-ink"
                    >
                      {t('approvals.refundReceived')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div ref={passWrap} className="scroll-mt-20 min-w-0">
          {current ? (
            <ApprovalPass
              key={current.id}
              r={current}
              passRef={passRef}
              stampRef={stampRef}
              stampText={stampText}
              busy={busy}
              onApprove={() => void finish('approved')}
              onReject={() => setRejecting(true)}
            />
          ) : (
            <div className="rounded-card bg-surface p-8 text-label text-muted shadow-pass">
              <b className="block text-sheet-title font-semibold text-ink">{t('approvals.emptyTitle')}</b>
              <p className="mt-2">{t('approvals.emptyBody')}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-small text-status-rejected">
              {error}
            </p>
          )}
          {current && (
            <p className="mt-3 hidden text-micro text-faint lg:block">
              <kbd>↑</kbd> <kbd>↓</kbd> {t('approvals.kbdNavigate')} · <kbd>A</kbd> {t('approvals.kbdApprove')} · <kbd>R</kbd> {t('approvals.kbdReject')}
            </p>
          )}
        </div>

        <div className="lg:col-start-2 xl:col-start-3">{current && <ApprovalDocs attachments={current.attachments} />}</div>
      </div>

      <ConfirmDialog
        open={rejecting}
        title={t('approvals.rejectRequest')}
        body={current ? `${current.who} · ${current.title}` : ''}
        confirmLabel={t('approvals.reject')}
        onConfirm={submitReject}
        onCancel={() => {
          setRejecting(false)
          setReasonError('')
        }}
      >
        <label htmlFor="reject-reason" className="mt-4 mb-2 block text-micro font-semibold text-muted">
          {t('requests.detail.rejectReason')}
        </label>
        <textarea
          id="reject-reason"
          data-autofocus=""
          rows={3}
          value={reason}
          maxLength={1000}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? 'reject-reason-err' : undefined}
          onChange={(e) => {
            setReason(e.target.value)
            setReasonError('')
          }}
          className="input resize-none"
        />
        {reasonError && (
          <p id="reject-reason-err" role="alert" className="mt-1.5 text-micro text-status-rejected">
            {reasonError}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!invRejecting}
        title={t('approvals.rejectInvoice')}
        body={invRejecting ? `${invRejecting.firm} · ${invRejecting.no} · ${invRejecting.total}` : ''}
        confirmLabel={t('approvals.reject')}
        onConfirm={submitInvReject}
        onCancel={() => {
          setInvRejecting(null)
          setInvReasonError('')
        }}
      >
        <label htmlFor="inv-reject-reason" className="mt-4 mb-2 block text-micro font-semibold text-muted">
          {t('approvals.invoiceReasonLabel')}
        </label>
        <textarea
          id="inv-reject-reason"
          data-autofocus=""
          rows={3}
          value={invReason}
          maxLength={1000}
          aria-invalid={invReasonError ? true : undefined}
          aria-describedby={invReasonError ? 'inv-reject-reason-err' : undefined}
          onChange={(e) => {
            setInvReason(e.target.value)
            setInvReasonError('')
          }}
          className="input resize-none"
        />
        {invReasonError && (
          <p id="inv-reject-reason-err" role="alert" className="mt-1.5 text-micro text-status-rejected">
            {invReasonError}
          </p>
        )}
      </ConfirmDialog>
    </section>
  )
}
