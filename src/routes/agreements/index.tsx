import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AgreementSheet } from '#/components/AgreementSheet'
import { DataList, type Column } from '#/components/DataList'
import { DaysBadge } from '#/components/DaysBadge'
import { Icon } from '#/components/Icon'
import { Segmented } from '#/components/Segmented'
import { listAgreements, type Agreement } from '#/data/agreements'
import { useSession } from '#/lib/useSession'
import { agreementState, daysLeft, periodUnit } from '#/lib/agreements'
import { guard } from '#/lib/guard'
import { dateLabel } from '#/data/invoices'
import { t, tn } from '#/i18n'
import { formatMoneyRounded } from '#/lib/money'
import { useSheetState } from '#/lib/useSheetState'

export const Route = createFileRoute('/agreements/')({
  validateSearch: (s: Record<string, unknown>): { new?: 1 } => (s.new === 1 || s.new === '1' ? { new: 1 } : {}),
  beforeLoad: guard('agreements'),
  loader: () => listAgreements(),
  component: Agreements,
})

type Filter = 'active' | 'expiring' | 'ended'

const range = (a: Agreement) => `${dateLabel(a.start)} – ${a.end ? dateLabel(a.end) : t('agreements.openEnded')}`

const columnsFor = (today: string): Column<Agreement>[] => [
  {
    key: 'cp',
    header: t('agreements.counterparty'),
    primary: true,
    cell: (a) => (
      <>
        <b className="block text-row font-semibold">{a.counterparty}</b>
        <span className="text-link text-muted">{a.title}</span>
      </>
    ),
  },
  { key: 'range', header: t('agreements.range'), cell: (a) => <span className="text-link">{range(a)}</span> },
  {
    key: 'amount',
    header: t('agreements.amount'),
    right: true,
    cell: (a) => (
      <span className="num text-link font-semibold">
        {formatMoneyRounded(a.amount)} <span className="font-normal text-faint">/ {periodUnit(a.period)}</span>
      </span>
    ),
  },
  { key: 'left', header: t('agreements.left'), cell: (a) => <DaysBadge left={daysLeft(a.end, today)} /> },
  { key: 'tag', header: t('agreements.tag'), cell: (a) => (a.tag ? <span className="rounded-full bg-wash px-2.5 py-1 text-micro font-medium text-muted">{a.tag}</span> : <span className="text-faint">—</span>) },
]

function Agreements() {
  const initial = Route.useLoaderData()
  const TODAY_ISO = useSession().todayISO
  const columns = columnsFor(TODAY_ISO)
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [filter, setFilter] = useState<Filter>('active')
  const [list, setList] = useState<Agreement[]>(initial)
  const sheet = useSheetState(search.new === 1, (open, replace) => void navigate({ search: open ? { new: 1 } : {}, replace }))

  const state = (a: Agreement) => agreementState(a.end, TODAY_ISO)
  const counts = {
    active: list.filter((a) => state(a) !== 'ended').length,
    expiring: list.filter((a) => state(a) === 'expiring').length,
    ended: list.filter((a) => state(a) === 'ended').length,
  }
  const rows = list
    .filter((a) => (filter === 'active' ? state(a) !== 'ended' : state(a) === filter))
    .sort((a, b) => (filter === 'ended' ? (b.end ?? '').localeCompare(a.end ?? '') : (a.end ?? '9999').localeCompare(b.end ?? '9999')))

  return (
    <section className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm font-semibold sm:text-display">{t('agreements.title')}</h1>
          <p className="mt-2.5 text-label text-muted">{tn('agreements.count', list.length)}</p>
        </div>
        <button type="button" data-k="add-agreement" onClick={sheet.openSheet} className="btn btn-pri">
          <Icon name="plus" size={16} strokeWidth={2} />
          {t('agreements.add')}
        </button>
      </div>

      <Segmented
        label={t('agreements.filter')}
        className="mt-6 mb-4"
        value={filter}
        options={[
          { value: 'active', label: `${t('agreements.state.active')} · ${counts.active}` },
          { value: 'expiring', label: `${t('agreements.state.expiring')} · ${counts.expiring}` },
          { value: 'ended', label: `${t('agreements.state.ended')} · ${counts.ended}` },
        ]}
        onChange={setFilter}
      />

      <DataList
        label={t('agreements.title')}
        rows={rows}
        columns={columns}
        template="minmax(0,2.2fr) minmax(0,1.6fr) minmax(0,1.4fr) 8.5rem 8rem"
        rowKey={(a) => a.id}
        empty={t('agreements.emptyFilter')}
        renderLink={(a, cls, children) => (
          <Link to="/agreements/$id" params={{ id: a.id }} className={cls}>
            {children}
          </Link>
        )}
      />

      <AgreementSheet open={sheet.open} onClose={sheet.closeSheet} tags={[...new Set(list.map((a) => a.tag).filter(Boolean))]} onAdded={(a) => setList((l) => [...l, a])} />
    </section>
  )
}
