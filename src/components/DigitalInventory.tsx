import { useState } from 'react'
import { DataList, type Column } from './DataList'
import { DigitalSheet } from './DigitalSheet'
import { Icon } from './Icon'
import { InvoicePill, TitleRow } from './InvoicePill'
import { Segmented } from './Segmented'
import type { AssignableUser } from './AssetSheets'
import { DIGITAL_KIND_LABEL, DIGITAL_PERIOD_LABEL, monthlyBase, type DigitalAsset, type DigitalKind, type FxRates } from '#/data/digital'
import { FxSheet } from './FxSheet'
import { dateLabel } from '#/data/invoices'
import { daysLeft, isHot } from '#/lib/agreements'
import { formatMoney, formatMoneyRounded, foreignCurrencies, CURRENCY_SYMBOL } from '#/lib/money'
import { useSession } from '#/lib/useSession'
import { t, tn } from '#/i18n'
import { formatNumber } from '#/i18n/format'

type Filter = 'all' | DigitalKind | 'cancelled'

export function DigitalInventory({ items, users, fx, onChanged }: { items: DigitalAsset[]; users: AssignableUser[]; fx: FxRates & { updatedOn: string | null }; onChanged: () => void }) {
  const TODAY = useSession().todayISO
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<DigitalAsset | 'new' | null>(null)
  const [fxOpen, setFxOpen] = useState(false)
  const active = items.filter((i) => i.status === 'active')
  const count = (f: Filter) => (f === 'all' ? items.length : f === 'cancelled' ? items.filter((i) => i.status === 'cancelled').length : items.filter((i) => i.kind === f).length)
  const rows = filter === 'all' ? items : filter === 'cancelled' ? items.filter((i) => i.status === 'cancelled') : items.filter((i) => i.kind === filter)
  const monthlies = active.map((i) => monthlyBase(i.period, i.cost, i.currency, fx))
  const monthly = monthlies.reduce<number>((sum, m) => sum + (m ?? 0), 0)
  const missingFx = monthlies.filter((m) => m == null).length
  const unverified = active.filter((i) => !i.verified).length

  const columns: Column<DigitalAsset>[] = [
    {
      key: 'name',
      header: t('digital.list.name'),
      primary: true,
      sortValue: (d) => d.name,
      cell: (d) => (
        <button type="button" onClick={() => setEditing(d)} className="block text-left text-ink hover:underline">
          <b className="block text-row font-semibold">
            <TitleRow
              pills={
                <>
                  {d.status === 'cancelled' && <span className="kar-pill no ml-2 shrink-0 text-tab">{t('digital.status.cancelled')}</span>}
                  {!d.verified && d.status === 'active' && <span className="kar-pill wait ml-2 shrink-0 text-tab">{t('digital.unverified')}</span>}
                  {d.hasInvoice && <InvoicePill />}
                </>
              }
            >
              {d.name}
            </TitleRow>
          </b>
          <span className="text-micro text-faint">{d.purpose || [d.vendor, d.plan].filter(Boolean).join(' · ') || DIGITAL_KIND_LABEL[d.kind]}</span>
        </button>
      ),
    },
    { key: 'kind', header: t('digital.list.kind'), sortValue: (d) => DIGITAL_KIND_LABEL[d.kind], cell: (d) => <span className="text-link">{DIGITAL_KIND_LABEL[d.kind]}</span> },
    {
      key: 'users',
      header: t('digital.list.users'),
      sortValue: (d) => d.users.length || d.seats || null,
      cell: (d) => (
        <span className="text-link" title={d.users.map((u) => u.name).join(', ')}>
          {d.users.length ? (d.seats ? t('digital.sheet.seatsValue', { people: d.users.length, seats: d.seats }) : tn('digital.sheet.people', d.users.length)) : d.seats ? tn('digital.list.seats', d.seats) : '—'}
        </span>
      ),
    },
    {
      key: 'renews',
      header: t('digital.list.renewal'),
      sortValue: (d) => d.renewsOn,
      cell: (d) => {
        if (!d.renewsOn) return <span className="text-link text-faint">—</span>
        const left = daysLeft(d.renewsOn, TODAY)
        return (
          <span className="flex flex-wrap items-center justify-end gap-2 text-link lg:justify-start">
            {dateLabel(d.renewsOn)}
            {d.status === 'active' && isHot(left) && <span className="kar-pill no">{tn('digital.list.daysLeft', left ?? 0)}</span>}
            {d.status === 'active' && left !== null && left < 0 && <span className="kar-pill no">{t('digital.list.overdue')}</span>}
          </span>
        )
      },
    },
    {
      key: 'cost',
      header: t('digital.list.monthlyCost'),
      sortValue: (d) => (d.period === 'free' ? 0 : d.cost == null ? null : monthlyBase(d.period, d.cost, d.currency, fx)),
      right: true,
      cell: (d) => {
        if (d.period === 'free') return <span className="text-link text-faint">{DIGITAL_PERIOD_LABEL.free}</span>
        if (d.cost == null) return <span className="text-link text-faint">—</span>
        if (d.period === 'one_time') return <span className="text-link text-faint" title={formatMoney(d.cost, d.currency)}>{DIGITAL_PERIOD_LABEL.one_time}</span>
        const m = monthlyBase(d.period, d.cost, d.currency, fx)
        const original = `${formatMoney(d.cost, d.currency)} / ${d.period === 'monthly' ? t('digital.list.perMonth') : t('digital.list.perYear')}`
        return m == null ? (
          <span className="text-link text-faint" title={original}>{t('digital.list.noFx')}</span>
        ) : (
          <span className="num text-link font-semibold whitespace-nowrap" title={original}>
            {formatMoneyRounded(m)}
          </span>
        )
      },
    },
    {
      key: 'total',
      header: t('digital.list.totalCost'),
      right: true,
      sortValue: (d) => (d.period === 'yearly' && d.cost != null ? monthlyBase(d.period, d.cost, d.currency, fx) : null),
      cell: (d) => {
        if (d.period !== 'yearly' || d.cost == null) return <span className="text-link text-faint">—</span>
        const m = monthlyBase(d.period, d.cost, d.currency, fx)
        return m == null ? (
          <span className="text-link text-faint">{t('digital.list.noFx')}</span>
        ) : (
          <span className="num text-link font-semibold whitespace-nowrap" title={`${formatMoney(d.cost, d.currency)} / ${t('digital.list.perYear')}`}>
            {formatMoneyRounded(m * 12)}
            <span className="font-normal text-faint"> / {t('digital.list.perYear')}</span>
          </span>
        )
      },
    },
  ]

  return (
    <>
      <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('digital.list.filter')}
          value={filter}
          options={[
            { value: 'all', label: `${t('digital.list.all')} · ${count('all')}` },
            { value: 'software', label: `${t('digital.kindShort.software')} · ${count('software')}` },
            { value: 'domain', label: `${t('digital.kindShort.domain')} · ${count('domain')}` },
            { value: 'stock', label: `${t('digital.kindShort.stock')} · ${count('stock')}` },
            { value: 'account', label: `${t('digital.kindShort.account')} · ${count('account')}` },
            { value: 'cancelled', label: `${t('digital.status.cancelled')} · ${count('cancelled')}` },
          ]}
          onChange={setFilter}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-link text-muted">
            {t('digital.list.monthly')} <b className="num font-semibold text-ink">{formatMoneyRounded(monthly)}</b>
            {missingFx > 0 && <span className="text-status-rejected"> · {tn('digital.list.missingFx', missingFx)}</span>}
            {unverified > 0 && <span> · {tn('digital.list.unverifiedCount', unverified)}</span>}
          </span>
          <button type="button" data-k="fx" onClick={() => setFxOpen(true)} className="btn-tint rounded-full px-3 py-1.5 text-micro">
            {foreignCurrencies().some((c) => fx[c]) ? `${t('digital.list.fx')}: ${foreignCurrencies().filter((c) => fx[c]).map((c) => `${CURRENCY_SYMBOL[c]} ${formatNumber(fx[c]!)}`).join(' · ')}` : t('digital.list.enterFx')}
          </button>
          <button type="button" data-k="add-digital" onClick={() => setEditing('new')} className="btn btn-pri">
            <Icon name="plus" size={16} strokeWidth={2} />
            {t('digital.list.add')}
          </button>
        </div>
      </div>

      <DataList
        label={t('digital.list.label')}
        rows={rows}
        columns={columns}
        template="minmax(0,2.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,1.2fr) minmax(0,1.2fr)"
        rowKey={(d) => d.id}
        empty={filter === 'cancelled' ? t('digital.list.emptyCancelled') : t('digital.list.empty')}
      />

      <DigitalSheet item={editing === 'new' || editing === null ? editing : (items.find((i) => i.id === editing.id) ?? editing)} users={users} onClose={() => setEditing(null)} onSaved={onChanged} />
      <FxSheet open={fxOpen} fx={fx} onClose={() => setFxOpen(false)} onSaved={onChanged} />
    </>
  )
}
