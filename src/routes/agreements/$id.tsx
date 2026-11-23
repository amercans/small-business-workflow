import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { DaysBadge } from '#/components/DaysBadge'
import { Icon } from '#/components/Icon'
import { getAgreement } from '#/data/agreements'
import { dateLabel } from '#/data/invoices'
import { t } from '#/i18n'
import { useSession } from '#/lib/useSession'
import { daysLeft, periodUnit } from '#/lib/agreements'
import { guard } from '#/lib/guard'
import { formatMoneyRounded } from '#/lib/money'

export const Route = createFileRoute('/agreements/$id')({
  beforeLoad: guard('agreements'),
  loader: async ({ params }) => {
    const a = await getAgreement(params.id)
    if (!a) throw notFound()
    return a
  },
  notFoundComponent: () => (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('agreements.notFound')}</h1>
      <Link to="/agreements" className="btn btn-sec mt-6 no-underline">
        {t('agreements.back')}
      </Link>
    </section>
  ),
  component: Detail,
})

function Detail() {
  const a = Route.useLoaderData()
  const left = daysLeft(a.end, useSession().todayISO)
  const yearly = a.period === 'monthly' ? a.amount * 12 : null
  const fields: [string, React.ReactNode][] = [
    [t('agreements.subject'), a.title],
    [t('agreements.start'), dateLabel(a.start)],
    [t('agreements.end'), a.end ? <span className="inline-flex flex-wrap items-center gap-2.5">{dateLabel(a.end)}<DaysBadge left={left} /></span> : t('agreements.openEndedCap')],
    [t('agreements.amountNet'), <span key="amt" className="num">{formatMoneyRounded(a.amount)} / {periodUnit(a.period)}{yearly ? <span className="text-faint"> · {t('agreements.yearly', { amount: formatMoneyRounded(yearly) })}</span> : null}</span>],
    [t('agreements.tag'), a.tag || '—'],
    [t('agreements.note'), a.note || '—'],
  ]
  return (
    <article className="max-w-3xl pb-10">
      <Link to="/agreements" className="-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink">
        <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
        {t('agreements.title')}
      </Link>
      <h1 className="mt-4 text-sheet-title font-semibold sm:text-display-sm">{a.counterparty}</h1>
      <p className="mt-2 text-label text-muted">{a.title}</p>

      <dl className="m-0 mt-7 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 kar rounded-3xl p-5 text-label ">
        {fields.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-8 mb-3 text-label font-semibold text-muted">{t('agreements.attachment')}</h2>
      {a.pdfId ? (
        <a
          href={`/files/${a.pdfId}`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2.5 btn-sec rounded-full px-4 py-2.5 text-link text-ink no-underline hover:bg-wash-hover"
        >
          <Icon name="paper" size={16} strokeWidth={1.8} className="text-faint" />
          {a.pdfName}
          <span className="rounded-full bg-wash px-2 py-0.5 text-tab font-semibold text-muted">PDF</span>
        </a>
      ) : (
        <p className="text-link text-faint">{t('agreements.noAttachment')}</p>
      )}
    </article>
  )
}
