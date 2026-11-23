import { createFileRoute, Link } from '@tanstack/react-router'
import { Icon } from '#/components/Icon'
import { loadUndertakings } from '#/data/compliance'
import { guard } from '#/lib/guard'
import { LEGAL_VERSION, undertaking } from '#/lib/legal'
import { t } from '#/i18n'

export const Route = createFileRoute('/undertakings')({
  beforeLoad: guard('users'),
  loader: () => loadUndertakings(),
  component: Undertakings,
})

function Undertakings() {
  const people = Route.useLoaderData()
  const doc = undertaking()
  return (
    <section className="pb-10">
      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/users" className="-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink">
            <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
            {t('legal.print.back')}
          </Link>
          <h1 className="mt-4 text-display-sm font-semibold sm:text-display">{t('legal.print.title')}</h1>
          <p className="mt-2.5 max-w-[60ch] text-label text-muted">
            {t('legal.print.lead', { count: people.length })}
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn btn-pri">
          {t('legal.print.print')}
        </button>
      </div>

      <div className="print-area mt-6 flex flex-col gap-5">
        {people.map((p) => (
          <article key={p.id} className="print-page kar rounded-3xl px-7 py-8 text-label leading-relaxed text-ink">
            <p className="no-print mb-3 text-micro text-faint">{t('common.templateNotice')}</p>
            <h2 className="text-center text-row font-bold">{doc.title}</h2>
            <ol className="mt-5 flex list-decimal flex-col gap-2.5 pl-5">
              {doc.items.map((x) => (
                <li key={x.slice(0, 30)}>{x}</li>
              ))}
            </ol>
            <dl className="mt-8 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-5">
              <dt className="text-muted">{t('legal.print.employee')}</dt>
              <dd className="m-0 font-semibold">{p.name}</dd>
              <dt className="text-muted">{doc.signature.date}</dt>
              <dd className="m-0 border-b border-dashed border-faint">&nbsp;</dd>
              <dt className="text-muted">{doc.signature.sign}</dt>
              <dd className="m-0 h-10 border-b border-dashed border-faint" />
              <dt className="text-muted">{doc.signature.company}</dt>
              <dd className="m-0 h-10 border-b border-dashed border-faint" />
            </dl>
            <p className="mt-6 text-micro text-faint">{t('legal.print.version', { version: LEGAL_VERSION })}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
