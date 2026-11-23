import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { Icon } from '#/components/Icon'
import { loadAllStatements } from '#/data/compliance'
import { guard } from '#/lib/guard'
import { formatLeaveDays } from '#/lib/leave'
import { t, tn } from '#/i18n'
import { runtimeConfig } from '#/config/runtime'

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/leave-statements')({
  validateSearch: (s: Record<string, unknown>): { year?: number } => (Number.isInteger(Number(s.year)) && Number(s.year) > 2020 ? { year: Number(s.year) } : {}),
  beforeLoad: guard('reports'),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: ({ deps, context }) => loadAllStatements({ data: { year: deps.year ?? Number((context as { session: { todayISO: string } }).session.todayISO.slice(0, 4)) } }),
  component: Statements,
})

function Statements() {
  const list = Route.useLoaderData()
  const { todayISO } = rootApi.useRouteContext().session
  const year = list[0]?.year ?? Number(todayISO.slice(0, 4))
  const company = runtimeConfig().company.name
  return (
    <section className="pb-10">
      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/reports" className="-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink">
            <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
            {t('nav.reports')}
          </Link>
          <h1 className="mt-4 text-display-sm font-semibold sm:text-display">{t('records.statement', { year })}</h1>
          <p className="mt-2.5 max-w-[62ch] text-label text-muted">
            {t('statements.lead', { count: list.length })}
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn btn-pri">
          {t('statements.print')}
        </button>
      </div>
      <div className="print-area mt-6 flex flex-col gap-5">
        {list.map((st) => (
          <article key={st.person} className="print-page kar rounded-3xl px-7 py-8 text-label leading-relaxed text-ink">
            <h2 className="text-center text-row font-bold">{t('statements.title', { year: st.year })}</h2>
            {company && <p className="mt-1 text-center text-micro text-muted">{company}</p>}
            <dl className="mt-6 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted">{t('statements.employee')}</dt>
              <dd className="m-0 font-semibold">{st.person}</dd>
              <dt className="text-muted">{t('statements.allowance')}</dt>
              <dd className="num m-0">{st.entitled == null ? t('statements.notSet') : tn('statements.workDays', st.entitled)}</dd>
              <dt className="text-muted">{t('records.used')}</dt>
              <dd className="num m-0">{tn('statements.workDays', st.used)}</dd>
              <dt className="text-muted">{t('records.left')}</dt>
              <dd className="num m-0 font-semibold">{st.remaining == null ? '—' : tn('statements.workDays', st.remaining)}</dd>
            </dl>
            <table className="mt-5 w-full border-collapse text-left text-link">
              <thead>
                <tr className="border-b border-faint">
                  <th className="py-1.5 font-semibold">{t('statements.dates')}</th>
                  <th className="py-1.5 text-right font-semibold">{t('statements.duration')}</th>
                </tr>
              </thead>
              <tbody>
                {st.usedBefore > 0 && (
                  <tr className="border-b border-kar-line-2">
                    <td className="py-1.5">{t('records.usedBefore')}</td>
                    <td className="num py-1.5 text-right">{formatLeaveDays(st.usedBefore)}</td>
                  </tr>
                )}
                {st.annual.map((a) => (
                  <tr key={a.range} className="border-b border-kar-line-2">
                    <td className="py-1.5">{a.range}</td>
                    <td className="num py-1.5 text-right">{formatLeaveDays(a.days)}</td>
                  </tr>
                ))}
                {st.annual.length === 0 && st.usedBefore === 0 && (
                  <tr>
                    <td className="py-1.5 text-faint" colSpan={2}>{t('statements.none')}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-5 text-link text-muted">{t('statements.declaration')}</p>
            <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-5">
              <dt className="text-muted">{t('statements.date')}</dt>
              <dd className="m-0 border-b border-dashed border-faint">&nbsp;</dd>
              <dt className="text-muted">{t('statements.signature')}</dt>
              <dd className="m-0 h-10 border-b border-dashed border-faint" />
              <dt className="text-muted">{t('statements.forCompany')}</dt>
              <dd className="m-0 h-10 border-b border-dashed border-faint" />
            </dl>
            {st.confirmedAt && <p className="mt-4 text-micro text-faint">{t('statements.confirmedInPanel')}</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
