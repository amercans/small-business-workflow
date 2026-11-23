import type { Ref } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { advanceNote, type ApprovalRequest } from '#/data/approvals'
import type { RequestType } from '#/data/home'
import { t, tn } from '#/i18n'

const toneBg: Record<RequestType, string> = {
  leave: 'bg-card-leave',
  expense: 'bg-card-expense',
  advance: 'bg-card-advance',
  purchase: 'bg-card-purchase',
  travel: 'bg-card-travel',
}

export function ApprovalPass({
  r,
  passRef,
  stampRef,
  stampText,
  onApprove,
  onReject,
  busy,
}: {
  r: ApprovalRequest
  passRef?: Ref<HTMLDivElement>
  stampRef?: Ref<HTMLDivElement>
  stampText: string
  onApprove: () => void
  onReject: () => void
  busy: boolean
}) {
  const note = advanceNote(r)
  const kv = [
    { label: t('approvals.pass.role'), value: r.requesterRole },
    ...(r.project ? [{ label: t('approvals.pass.project'), value: r.project }] : []),
    ...(r.note ? [{ label: t('approvals.pass.note'), value: r.note }] : []),
    ...r.fields,
  ]
  return (
    <div ref={passRef} className="relative overflow-hidden rounded-card bg-surface shadow-pass">
      <div className={`pass-hd px-5 pt-6 pb-5.5 sm:px-7 sm:pt-7 sm:pb-6.5 ${toneBg[r.type]}`}>
        <div className="relative flex items-center gap-2.5 text-ui font-medium">
          <Avatar name={r.who} hue={r.hue} className="size-7" />
          <span>
            {r.who} · {r.typeLabel} · {r.submittedAt}
          </span>
        </div>
        <div className="num relative mt-6.5 text-pass-amount-sm font-semibold sm:text-pass-amount">{r.hero}</div>
        <div className="relative mt-2.5 text-label opacity-90">{r.title}</div>
        <div ref={stampRef} aria-hidden="true" className="stamp">
          {stampText}
        </div>
      </div>
      <div className="perf" aria-hidden="true" />
      <div className="px-5 pt-6 pb-6.5 sm:px-7">
        {kv.length > 0 && (
          <dl className="m-0 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-link text-nav">
            {kv.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-faint">{f.label}</dt>
                <dd className="m-0 min-w-0 break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {r.items && r.items.length > 0 && (
          <ul className="m-0 mt-4.5 list-none border-t border-hairline p-0">
            {r.items.map((it, i) => (
              <li key={i} className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-3.5 border-b border-hairline py-3.5">
                <div className="grid size-11 place-items-center rounded-day bg-docs-tile text-muted shadow-thumb">
                  <Icon name="paper" size={20} strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <b className="block text-ui font-medium">{it.desc}</b>
                  <span className="text-micro text-faint">
                    {it.sub} · {it.receipt}
                  </span>
                </div>
                <span className="num text-ui font-semibold">{it.amount}</span>
              </li>
            ))}
          </ul>
        )}
        {r.amountValue !== null && (
          <div className="flex items-baseline justify-between pt-3.5 text-ui text-muted">
            <span>{r.items ? tn('approvals.pass.items', r.items.length) : r.type === 'advance' ? t('approvals.pass.amount') : t('approvals.pass.estimated')}</span>
            <b className="num text-xl font-semibold tracking-tight text-ink">{r.amount}</b>
          </div>
        )}
        {note && <p className="mt-3 rounded-note bg-note-wash px-3.5 py-3 text-small leading-snug text-muted">{note}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={onApprove} disabled={busy} className="btn btn-pri h-11.5 px-5.5 active:scale-97">
            <Icon name="check" size={18} strokeWidth={2.2} />
            {t('approvals.approve')}
            <kbd className="hidden rounded-day bg-white/15 px-1.5 text-micro font-medium lg:inline">A</kbd>
          </button>
          <button type="button" onClick={onReject} disabled={busy} className="btn btn-sec h-11.5 px-5.5 active:scale-97">
            {t('approvals.reject')}
            <kbd className="hidden rounded-day bg-wash px-1.5 text-micro font-medium lg:inline">R</kbd>
          </button>
          <small className="ml-auto text-micro text-faint">{t('approvals.pass.reasonNeeded')}</small>
        </div>
      </div>
    </div>
  )
}
