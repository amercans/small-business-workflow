import { useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { acknowledgeAssignment, disputeAssignment } from '#/data/compliance'
import { dateLabel } from '#/data/invoices'
import { t } from '#/i18n'
import type { Session } from '#/data/session'

type Item = Session['pendingAssets'][number]

export function AssetGate({ items, name }: { items: Item[]; name: string }) {
  const router = useRouter()
  const total = useRef(items.length)
  const answered = Math.max(0, total.current - items.length)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<Record<string, string>>({})

  async function answer(id: string, call: () => ReturnType<typeof acknowledgeAssignment>) {
    setBusy(id)
    setError((e) => ({ ...e, [id]: '' }))
    const r = await call()
    if (!r.ok) {
      setError((e) => ({ ...e, [id]: r.error }))
      setBusy(null)
      return
    }
    await router.invalidate()
    setBusy(null)
    setOpen(null)
    setNote('')
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5 pt-2 pb-10" aria-labelledby="asset-gate-title">
      <header className="px-1.5">
        <h1 id="asset-gate-title" className="text-[2rem] leading-tight font-semibold tracking-[-0.03em] lg:text-[2.5rem]">
          {t('legal.assets.title')}
        </h1>
        <p className="mt-2 text-label text-muted">
          {t('legal.assets.lead', { name: name.split(' ')[0] })}
        </p>
        <p role="status" className="num mt-3 text-small font-medium text-muted">
          {t('legal.assets.progress', { done: answered, total: total.current })}
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {items.map((a) => (
          <li key={a.id} className="kar px-5 py-4 sm:px-6.5 sm:py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-body font-semibold break-words">
                  {a.name}
                  {a.quantity > 1 && <span className="ml-2 font-normal text-muted">× {a.quantity}</span>}
                </p>
                <p className="mt-0.5 text-small text-muted break-words">
                  {[a.category, a.serial ? t('legal.assets.serial', { serial: a.serial }) : '', t('legal.assets.since', { date: dateLabel(a.since) })].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" disabled={busy === a.id} onClick={() => answer(a.id, () => acknowledgeAssignment(a.id))} className="btn btn-pri h-10 px-5 text-small">
                  {t('legal.assets.have')}
                </button>
                <button
                  type="button"
                  disabled={busy === a.id}
                  aria-expanded={open === a.id}
                  onClick={() => {
                    setOpen(open === a.id ? null : a.id)
                    setNote('')
                  }}
                  className="btn btn-sec h-10 px-5 text-small"
                >
                  {t('legal.assets.notMine')}
                </button>
              </div>
            </div>
            {open === a.id && (
              <div className="mt-4 flex flex-col gap-3 border-t border-kar-line-2 pt-4">
                <label htmlFor={`dispute-${a.id}`} className="text-small font-medium">
                  {t('legal.assets.note')}
                </label>
                <textarea id={`dispute-${a.id}`} value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy === a.id} onClick={() => answer(a.id, () => disputeAssignment(a.id, note.trim() || undefined))} className="btn btn-pri h-10 px-5 text-small">
                    {t('legal.assets.report')}
                  </button>
                  <button type="button" onClick={() => setOpen(null)} className="btn btn-sec h-10 px-5 text-small">
                    {t('legal.assets.cancel')}
                  </button>
                </div>
              </div>
            )}
            {error[a.id] && (
              <p role="alert" className="mt-3 text-small text-status-rejected">
                {error[a.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
