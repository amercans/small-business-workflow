import { useState } from 'react'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { LegalDoc } from '#/components/legal/LegalDoc'
import { Segmented } from '#/components/Segmented'
import { acknowledgeAssignment, confirmStatement, loadMyRecords } from '#/data/compliance'
import { dateLabel } from '#/data/invoices'
import { formatLeaveDays } from '#/lib/leave'
import { DOC_LABEL, DOCS, LEGAL_VERSION } from '#/lib/legal'
import { stampLabelClient } from '#/lib/stamp'
import { t } from '#/i18n'

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/my-records')({
  validateSearch: (s: Record<string, unknown>): { year?: number } => (Number.isInteger(Number(s.year)) && Number(s.year) > 2020 ? { year: Number(s.year) } : {}),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: ({ deps, context }) => loadMyRecords({ data: { year: deps.year ?? Number((context as { session: { todayISO: string } }).session.todayISO.slice(0, 4)) } }),
  component: MyRecords,
})

function MyRecords() {
  const d = Route.useLoaderData()
  const { todayISO } = rootApi.useRouteContext().session
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const thisYear = Number(todayISO.slice(0, 4))
  const st = d.statement

  const run = async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(key)
    setError('')
    const r = await fn()
    if (!r.ok) setError(r.error)
    await router.invalidate()
    setBusy('')
  }

  return (
    <article className="flex flex-col gap-5 pb-10">
      <header>
        <h1 className="text-display-sm font-semibold sm:text-display">{t('nav.records')}</h1>
        <p className="mt-2.5 text-label text-muted">{t('records.lead')}</p>
      </header>
      {error && (
        <p role="alert" className="px-1.5 text-small text-status-rejected">
          {error}
        </p>
      )}

      <section className="kar px-5 py-5 sm:px-6.5 sm:py-6" aria-labelledby="mr-assets">
        <div className="kar-h">
          <h2 id="mr-assets">{t('records.assets', { count: d.assets.length })}</h2>
        </div>
        {d.assets.length === 0 ? (
          <p className="pt-3 text-link text-faint">{t('records.noAssets')}</p>
        ) : (
          <ul className="m-0 mt-2 list-none p-0">
            {d.assets.map((a) => (
              <li key={a.assignmentId} className="flex flex-wrap items-center justify-between gap-3 border-t border-kar-line-2 py-3 first:border-0">
                <span className="min-w-0">
                  <b className="block text-row font-semibold">
                    {a.name}
                    {a.quantity > 1 && <span className="num ml-1.5 font-normal text-muted">× {a.quantity}</span>}
                  </b>
                  <span className="text-micro text-faint">{[a.category, a.serial, t('records.assignedOn', { date: dateLabel(a.since) })].filter(Boolean).join(' · ')}</span>
                </span>
                {a.acknowledgedAt ? (
                  <span className="kar-pill ok">{t('records.received', { at: stampLabelClient(a.acknowledgedAt) })}</span>
                ) : a.disputedAt ? (
                  <span className="kar-pill no">{t('records.disputed', { at: stampLabelClient(a.disputedAt) })}</span>
                ) : (
                  <button type="button" disabled={busy === a.assignmentId} onClick={() => run(a.assignmentId, () => acknowledgeAssignment(a.assignmentId))} className="btn btn-pri h-9 px-4 text-small">
                    {t('records.confirmReceipt')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {d.seats.length > 0 && (
          <p className="mt-4 border-t border-kar-line-2 pt-4 text-link text-muted">
            {t('records.seats')} <span className="text-ink">{d.seats.map((s) => s.name).join(', ')}</span>
          </p>
        )}
      </section>

      <section className="kar px-5 py-5 sm:px-6.5 sm:py-6" aria-labelledby="mr-leave">
        <div className="kar-h flex-wrap">
          <h2 id="mr-leave">{t('records.statement', { year: st.year })}</h2>
          <Segmented
            label={t('records.year')}
            value={String(st.year)}
            options={[thisYear - 1, thisYear].map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => void navigate({ search: { year: Number(v) }, replace: true })}
          />
        </div>
        {st.entitled == null ? (
          <p className="pt-3 text-link text-faint">{t('records.noEntitlement', { year: st.year })}</p>
        ) : (
          <>
            <dl className="m-0 mt-4 grid grid-cols-3 gap-3 text-center">
              {[
                [t('records.entitled'), st.entitled],
                [t('records.used'), st.used],
                [t('records.left'), st.remaining ?? 0],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-2xl bg-kar-wash px-3 py-3">
                  <dt className="text-micro text-faint">{k}</dt>
                  <dd className={`num m-0 mt-1 text-[1.5rem] font-semibold ${Number(v) < 0 ? 'text-status-rejected' : ''}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <ul className="m-0 mt-4 list-none p-0 text-link">
              {st.usedBefore > 0 && (
                <li className="flex justify-between gap-3 border-t border-kar-line-2 py-2.5 first:border-0">
                  <span className="text-muted">{t('records.usedBefore')}</span>
                  <span className="num">{formatLeaveDays(st.usedBefore)}</span>
                </li>
              )}
              {st.annual.map((a) => (
                <li key={a.range} className="flex justify-between gap-3 border-t border-kar-line-2 py-2.5 first:border-0">
                  <span>{t('records.annualRow', { range: a.range })}</span>
                  <span className="num">{formatLeaveDays(a.days)}</span>
                </li>
              ))}
              {st.other.map((a) => (
                <li key={a.range} className="flex justify-between gap-3 border-t border-kar-line-2 py-2.5 text-muted first:border-0">
                  <span>
                    {t('records.otherRow', { kind: a.kind, range: a.range })}
                  </span>
                  <span className="num">{t('records.notDeducted', { days: formatLeaveDays(a.days) })}</span>
                </li>
              ))}
              {st.annual.length === 0 && st.other.length === 0 && st.usedBefore === 0 && <li className="py-2.5 text-faint">{t('records.noLeave')}</li>}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-kar-line-2 pt-4">
              {st.confirmedAt ? (
                <span className="kar-pill ok">{t('records.statementConfirmed', { at: stampLabelClient(st.confirmedAt) })}</span>
              ) : (
                <>
                  <button type="button" disabled={busy === 'st'} onClick={() => run('st', () => confirmStatement(st.year))} className="btn btn-pri h-9 px-4 text-small">
                    {t('records.confirmStatement')}
                  </button>
                  <span className="text-micro text-faint">{t('records.reportErrors')}</span>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className="kar px-5 py-5 sm:px-6.5 sm:py-6" aria-labelledby="mr-docs">
        <div className="kar-h">
          <h2 id="mr-docs">{t('records.docs')}</h2>
        </div>
        <ul className="m-0 mt-2 list-none p-0">
          {(Object.keys(DOCS) as (keyof typeof DOCS)[]).map((doc) => {
            const acc = d.accepted.find((a) => a.doc === doc && a.version === LEGAL_VERSION)
            return (
              <li key={doc} className="border-t border-kar-line-2 py-3 first:border-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setOpenDoc(openDoc === doc ? null : doc)} className="text-left text-row font-semibold text-ink hover:underline" aria-expanded={openDoc === doc}>
                    {DOCS[doc].title}
                  </button>
                  {acc ? <span className="kar-pill ok">{t('records.docAccepted', { at: stampLabelClient(acc.at) })}</span> : <span className="kar-pill wait">{t('records.docPending', { doc: DOC_LABEL[doc] })}</span>}
                </div>
                {openDoc === doc && (
                  <div className="mt-3 rounded-2xl bg-kar-wash px-4 py-4">
                    <LegalDoc doc={DOCS[doc]} compact />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </article>
  )
}
