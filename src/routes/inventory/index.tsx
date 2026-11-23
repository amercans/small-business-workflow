import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { AssetAddSheet } from '#/components/AssetSheets'
import { DataList, type Column } from '#/components/DataList'
import { StatusPill } from '#/components/AssetStatus'
import { Icon } from '#/components/Icon'
import { InvoicePill, TitleRow } from '#/components/InvoicePill'
import { Segmented } from '#/components/Segmented'
import { dateLabel } from '#/data/invoices'
import { loadInventory, STATUS_LABEL, statusOf, type Asset, type AssetStatus } from '#/data/inventory'
import { guard } from '#/lib/guard'
import { DigitalInventory } from '#/components/DigitalInventory'
import { loadDigital, type DigitalAsset } from '#/data/digital'
import { useSheetState } from '#/lib/useSheetState'
import { t, tn } from '#/i18n'

export const Route = createFileRoute('/inventory/')({
  validateSearch: (s: Record<string, unknown>): { new?: 1; tab?: 'digital' | 'people' } => ({
    ...(s.new === 1 || s.new === '1' ? { new: 1 as const } : {}),
    ...(s.tab === 'digital' || s.tab === 'people' ? { tab: s.tab } : {}),
  }),
  beforeLoad: guard('inventory'),
  loader: async () => {
    const [inv, dig] = await Promise.all([loadInventory(), loadDigital()])
    return { ...inv, digital: dig.items, fx: dig.fx }
  },
  component: Inventory,
})

type Filter = 'all' | AssetStatus

function Inventory() {
  const { assets: list, users, digital, fx } = Route.useLoaderData()
  const router = useRouter()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const tab = search.tab ?? 'physical'
  const sheet = useSheetState(search.new === 1, (open, replace) => void navigate({ search: open ? { new: 1 } : {}, replace }))
  const refresh = () => void router.invalidate()

  const count = (f: Filter) => (f === 'all' ? list.length : list.filter((a) => statusOf(a) === f).length)
  const rows = list.filter((a) => filter === 'all' || statusOf(a) === filter)

  const columns: Column<Asset>[] = [
    {
      key: 'name',
      header: t('inventory.list.equipment'),
      primary: true,
      cell: (a) => (
        <Link to="/inventory/$id" params={{ id: a.id }} className="block text-ink no-underline hover:underline">
          <b className="block text-row font-semibold">
            <TitleRow pills={a.hasInvoice && <InvoicePill />}>
              {a.name}
              {a.quantity > 1 && <span className="num ml-1.5 font-normal text-muted">× {a.quantity}</span>}
            </TitleRow>
          </b>
          <span className="num text-micro text-faint">{[a.category, a.serial || (a.quantity > 1 ? '' : t('inventory.list.noSerial'))].filter(Boolean).join(' · ')}</span>
        </Link>
      ),
    },
    {
      key: 'holder',
      header: t('inventory.list.holder'),
      cell: (a) => {
        const h = a.history.find((x) => x.to === null)
        return h ? (
          <Link to="/inventory/people/$userId" params={{ userId: h.userId }} className="text-link text-ink underline-offset-2 hover:underline">
            {a.holderName}
            {h.disputedAt && (
              <span className="kar-pill no ml-2" title={h.disputeNote ? t('inventory.notePrefix', { note: h.disputeNote }) : t('inventory.list.disputedTitle')}>
                {t('inventory.disputed')}
              </span>
            )}
          </Link>
        ) : a.holderOther ? (
          <span className="text-link text-ink" title={t('inventory.list.notInPanel')}>
            {a.holderOther}
          </span>
        ) : a.officeHolder ? (
          <span className="text-link text-ink">{a.officeHolder}</span>
        ) : (
          <span className="text-link text-faint">—</span>
        )
      },
    },
    { key: 'since', header: t('inventory.list.since'), cell: (a) => <span className="text-link">{(() => { const h = a.history.find((x) => x.to === null); return h ? dateLabel(h.from) : a.holderOther ? dateLabel(a.holderOtherOn) : a.officeOn ? dateLabel(a.officeOn) : '—' })()}</span> },
    { key: 'status', header: t('inventory.list.status'), cell: (a) => <StatusPill s={statusOf(a)} /> },
    {
      key: 'invoice',
      header: t('inventory.list.source'),
      cell: (a) =>
        a.source ? (
          <span className="text-micro text-muted">{a.source}</span>
        ) : a.invoiceId ? (
          <Link to="/invoices" search={{ tab: 'in', focus: a.invoiceId }} className="text-micro font-medium text-muted underline-offset-2 hover:underline">
            {t('inventory.list.goToInvoice')}
          </Link>
        ) : (
          <span className="text-micro text-faint">{t('inventory.manual')}</span>
        ),
    },
  ]

  return (
    <section className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm font-semibold sm:text-display">{t('inventory.title')}</h1>
          <p className="mt-2.5 text-label text-muted">
            {tn('inventory.list.equipmentCount', list.length)} · {tn('inventory.list.digitalCount', digital.filter((d) => d.status === 'active').length)}
          </p>
        </div>
        {tab === 'physical' && (
          <button type="button" data-k="add-asset" onClick={sheet.openSheet} className="btn btn-pri">
            <Icon name="plus" size={16} strokeWidth={2} />
            {t('inventory.list.add')}
          </button>
        )}
      </div>

      <div className="mt-6">
      <Segmented
        label={t('inventory.list.tabs')}
        value={tab}
        options={[
          { value: 'physical', label: t('inventory.list.physical') },
          { value: 'digital', label: t('inventory.list.digital') },
          { value: 'people', label: t('inventory.list.people') },
        ]}
        onChange={(v) => void navigate({ search: v === 'physical' ? {} : { tab: v }, replace: true })}
      />
      </div>

      {tab === 'people' ? (
        <PeopleList users={users} assets={list} digital={digital} />
      ) : tab === 'digital' ? (
        <DigitalInventory items={digital} users={users} fx={fx} onChanged={refresh} />
      ) : (
      <>
      <Segmented
        label={t('inventory.list.statusFilter')}
        className="mt-4 mb-4"
        value={filter}
        options={[
          { value: 'all', label: `${t('inventory.list.all')} · ${count('all')}` },
          { value: 'assigned', label: `${STATUS_LABEL.assigned} · ${count('assigned')}` },
          { value: 'stock', label: `${STATUS_LABEL.stock} · ${count('stock')}` },
        ]}
        onChange={setFilter}
      />

      <DataList label={t('inventory.title')} rows={rows} columns={columns} template="minmax(0,2.1fr) minmax(0,1.2fr) 7rem 9.5rem minmax(0,0.8fr)" rowKey={(a) => a.id} empty={t('inventory.list.empty')} />
      </>
      )}

      <AssetAddSheet open={sheet.open} onClose={sheet.closeSheet} onAdded={refresh} />
    </section>
  )
}

function PeopleList({ users, assets, digital }: { users: { id: string; displayName: string }[]; assets: Asset[]; digital: DigitalAsset[] }) {
  const rows = users.map((u) => ({
    ...u,
    held: assets.filter((a) => a.history.some((h) => h.userId === u.id && h.to === null)),
    seats: digital.filter((d) => d.status === 'active' && d.users.some((x) => x.id === u.id)),
  }))
  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: t('inventory.people.person'),
      primary: true,
      cell: (r) => (
        <Link to="/inventory/people/$userId" params={{ userId: r.id }} className="block text-ink no-underline hover:underline">
          <b className="block text-row font-semibold">{r.displayName}</b>
        </Link>
      ),
    },
    {
      key: 'phys',
      header: t('inventory.list.equipment'),
      cell: (r) => (
        <span className="text-link" title={r.held.map((a) => a.name).join(', ')}>
          {r.held.length ? `${tn('inventory.people.items', r.held.length)} · ${tn('inventory.people.units', r.held.reduce((sum, a) => sum + a.quantity, 0))}` : '—'}
        </span>
      ),
    },
    { key: 'dig', header: t('inventory.people.seats'), cell: (r) => <span className="text-link" title={r.seats.map((d) => d.name).join(', ')}>{r.seats.length || '—'}</span> },
    {
      key: 'go',
      header: '',
      right: true,
      cell: (r) => (
        <Link to="/inventory/people/$userId" params={{ userId: r.id }} className="btn-tint inline-flex rounded-full px-3.5 py-1.5 text-micro no-underline">
          {t('inventory.people.open')}
        </Link>
      ),
    },
  ]
  return (
    <div className="mt-4">
      <DataList label={t('inventory.people.label')} rows={rows} columns={columns} template="minmax(0,1.6fr) minmax(0,1.2fr) minmax(0,1fr) 5rem" rowKey={(r) => r.id} empty={t('inventory.people.empty')} />
    </div>
  )
}

