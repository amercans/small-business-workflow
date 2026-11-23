import type { ReactNode } from 'react'
import { DataList, type Column } from '#/components/DataList'
import type { JobsSummary } from '#/data/jobs'
import { formatMoney, formatMoneyRounded } from '#/lib/money'
import { t, tn } from '#/i18n'

const tl = (n: number) => (Number.isInteger(n) ? formatMoneyRounded(n) : formatMoney(n))

type FirmRow = JobsSummary['firms'][number]

function Amount({ amount, missing, notBillable, jobs }: { amount: number; missing: number; notBillable: number; jobs: number }) {
  return (
    <span className="block">
      {missing + notBillable >= jobs ? <span className="text-faint-2">—</span> : <b className="num text-ui font-semibold">{tl(amount)}</b>}
      <small className="mt-0.5 block min-h-4 whitespace-nowrap text-micro font-medium">
        {missing > 0 && <span className="text-blue-ink">{tn('jobs.summary.missing', missing)}</span>}
        {missing > 0 && notBillable > 0 && <span className="text-faint"> · </span>}
        {notBillable > 0 && <span className="text-faint">{tn('jobs.summary.notBillable', notBillable)}</span>}
        {missing === 0 && notBillable === 0 && '\u00a0'}
      </small>
    </span>
  )
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span aria-hidden="true" className="block h-1.75 overflow-hidden rounded-full bg-kar-line-2">
      <span className="block h-full rounded-full bg-blue-ink/85" style={{ width: `${max > 0 ? Math.max(3, (value / max) * 100) : 0}%` }} />
    </span>
  )
}

function Panel({ title, note, children }: { title: string; note: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-tile font-semibold">{title}</h2>
        <span className="text-small text-faint">{note}</span>
      </div>
      {children}
    </section>
  )
}

export function JobsSummaryView({ data, onPickClient }: { data: JobsSummary; onPickClient: (client: string) => void }) {
  const maxFirm = Math.max(0, ...data.firms.map((f) => f.amount))

  const firmCols: Column<FirmRow>[] = [
    { key: 'client', header: t('jobs.summary.client'), primary: true, sortValue: (f) => f.client, cell: (f) => <b className="block truncate text-ui font-semibold">{f.client}</b> },
    { key: 'jobs', header: t('jobs.summary.jobs'), right: true, sortValue: (f) => f.jobs, cell: (f) => <span className="num text-ui text-muted">{f.jobs}</span> },
    { key: 'bar', header: '', hideOnMobile: true, cell: (f) => <Bar value={f.amount} max={maxFirm} /> },
    { key: 'amount', header: t('jobs.summary.amount'), right: true, sortValue: (f) => f.amount, cell: (f) => <Amount amount={f.amount} missing={f.missing} notBillable={f.notBillable} jobs={f.jobs} /> },
  ]
  const template = 'minmax(0,1fr) 3rem minmax(0,1.4fr) 14rem'

  return (
    <div className="mt-6">
      <Panel title={t('jobs.summary.clients')} note={tn('jobs.summary.clientCount', data.firms.length)}>
        <DataList
          label={t('jobs.summary.clients')}
          rows={data.firms}
          columns={firmCols}
          template={template}
          rowKey={(f) => f.client}
          empty={t('jobs.summary.empty')}
          renderLink={(f, cls, children) => (
            <button type="button" data-k={`firm-${f.client}`} onClick={() => onPickClient(f.client)} className={`${cls} w-full cursor-pointer text-left`}>
              {children}
            </button>
          )}
        />
        <p className="mt-3 px-1 text-micro text-faint">{t('jobs.summary.footnote')}</p>
      </Panel>
    </div>
  )
}
