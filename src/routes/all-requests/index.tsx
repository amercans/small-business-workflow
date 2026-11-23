import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { DataList, type Column } from '#/components/DataList'
import { Segmented } from '#/components/Segmented'
import { Select } from '#/components/Select'
import { loadAllRequests, type MyRequest, type RequestStatus, type RequestType } from '#/data/home'
import { guard } from '#/lib/guard'
import { intlLocale, t } from '#/i18n'

export const Route = createFileRoute('/all-requests/')({
  beforeLoad: guard('allRequests'),
  loader: () => loadAllRequests(),
  component: AllRequests,
})

const PILL: Record<RequestStatus, string> = { pending: 'wait', approved: 'ok', paid: 'paid', rejected: 'no', cancelled: 'off' }
const DOT: Record<RequestType, string> = {
  leave: 'var(--color-type-leave)',
  expense: 'var(--color-type-expense)',
  purchase: 'var(--color-type-purchase)',
  travel: 'var(--color-type-travel)',
  advance: 'var(--color-type-advance)',
}
type StatusFilter = 'all' | 'pending' | 'done'

function AllRequests() {
  const { requests, statusLabel } = Route.useLoaderData()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<RequestType | ''>('')
  const [person, setPerson] = useState('')
  const people = [...new Set(requests.map((r) => r.requesterName ?? ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, intlLocale()))
  const rows = requests.filter(
    (r) =>
      (status === 'all' || (status === 'pending' ? r.status === 'pending' : r.status !== 'pending')) &&
      (!type || r.type === type) &&
      (!person || r.requesterName === person),
  )
  const pending = requests.filter((r) => r.status === 'pending').length

  const columns: Column<MyRequest>[] = [
    {
      key: 'title',
      header: t('requests.col.request'),
      primary: true,
      cell: (r) => (
        <Link to="/all-requests/$id" params={{ id: r.id }} className="flex min-w-0 items-center gap-3 text-ink no-underline hover:underline">
          <i className="size-2.5 shrink-0 rounded-full" style={{ background: DOT[r.type] }} />
          <span className="min-w-0">
            <b className={`block truncate text-row font-medium ${r.status === 'cancelled' ? 'text-faint line-through' : ''}`}>{r.title}</b>
            <span className="text-micro text-faint">{r.typeLabel}</span>
          </span>
        </Link>
      ),
    },
    { key: 'who', header: t('requests.col.person'), cell: (r) => <span className="text-link">{r.requesterName}</span> },
    { key: 'date', header: t('requests.col.date'), cell: (r) => <span className="num text-link text-muted">{r.date}</span> },
    { key: 'amount', header: t('requests.col.amount'), right: true, cell: (r) => <span className="num text-link font-medium whitespace-nowrap">{r.amount || '—'}</span> },
    { key: 'status', header: t('requests.status'), right: true, cell: (r) => <span className={`kar-pill ${PILL[r.status]}`}>{statusLabel[r.status]}</span> },
  ]

  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('nav.all')}</h1>
      <div className="mt-5 mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label={t('requests.status')}
          className="h-11 self-center!"
          value={status}
          options={[
            { value: 'all', label: t('requests.filterAll') },
            { value: 'pending', label: t('requests.filterPending', { count: pending }) },
            { value: 'done', label: t('requests.filterDone') },
          ]}
          onChange={setStatus}
        />
        <div className="w-44">
          <Select aria-label={t('requests.type')} value={type} onChange={(e) => setType(e.target.value as RequestType | '')}>
            <option value="">{t('requests.allTypes')}</option>
            {(['leave', 'expense', 'advance', 'purchase', 'travel'] as const).map((k) => (
              <option key={k} value={k}>{t(`requests.types.${k}`)}</option>
            ))}
          </Select>
        </div>
        <div className="w-52">
          <Select aria-label={t('requests.col.person')} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{t('requests.everyone')}</option>
            {people.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>
      </div>
      <DataList label={t('nav.all')} rows={rows} columns={columns} template="minmax(0,2.4fr) minmax(0,1.2fr) 6.5rem 8rem 8.5rem" rowKey={(r) => r.id} empty={t('requests.noneFiltered')} />
    </section>
  )
}
