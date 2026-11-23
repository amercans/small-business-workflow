import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { DataList, type Column } from '#/components/DataList'
import { Icon } from '#/components/Icon'
import { SectionHead } from '#/components/SectionHead'
import { Segmented } from '#/components/Segmented'
import { loadExpenseReport, loadLeaveReport, loadPurchaseTravelReport, type ExpenseReport, type LeaveReport, type PurchaseTravelReport } from '#/data/reports'
import { monthYear } from '#/lib/finance'
import { guard } from '#/lib/guard'
import { formatDay, formatLeaveDays } from '#/lib/leave'
import { dateLabel } from '#/data/invoices'
import { t, tn, type MessageKey } from '#/i18n'
import { formatMoney } from '#/lib/money'
import { useSession } from '#/lib/useSession'

type Tab = 'leave' | 'expense' | 'purchase'
const TAB_VALUES: Tab[] = ['leave', 'expense', 'purchase']
const tabLabel = (v: Tab) => t(v === 'leave' ? 'reports.tabs.leave' : v === 'expense' ? 'reports.tabs.expense' : 'reports.tabs.purchase')
const isMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

export const Route = createFileRoute('/reports')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; month?: string } => ({
    ...(s.tab === 'leave' || s.tab === 'expense' || s.tab === 'purchase' ? { tab: s.tab } : {}),
    ...(isMonth(s.month) ? { month: s.month } : {}),
  }),
  beforeLoad: guard('reports'),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? 'leave', month: search.month }),
  loader: async ({ deps, context }) => {
    const month = deps.month ?? context.session.todayISO.slice(0, 7)
    const data = { month }
    if (deps.tab === 'expense') return { ...data, tab: 'expense' as const, report: await loadExpenseReport({ data }) }
    if (deps.tab === 'purchase') return { ...data, tab: 'purchase' as const, report: await loadPurchaseTravelReport({ data }) }
    return { ...data, tab: 'leave' as const, report: await loadLeaveReport({ data }) }
  },
  component: Reports,
})

const shift = (month: string, n: number) => {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}
const monthLabel = (m: string) => monthYear(m)
const day = (iso: string) => dateLabel(iso)
const statusIs = (s: string, code: 'approved' | 'paid' | 'rejected') => s === code || s === t(`server.status.${code}` as MessageKey)

function Reports() {
  const d = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const today = useSession().todayISO
  const set = (p: { tab?: Tab; month?: string }) => void navigate({ search: (s) => ({ ...s, ...p }) })
  const max = shift(today.slice(0, 7), 12)

  return (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('reports.title')}</h1>
      <p className="mt-2.5 text-label text-muted">{t('reports.lead')}</p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <Segmented label={t('reports.report')} value={d.tab} options={TAB_VALUES.map((value) => ({ value, label: tabLabel(value) }))} onChange={(tab) => set({ tab })} />
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t('overview.monthPicker')} className="flex items-center gap-1.5">
            <button type="button" aria-label={t('overview.prevMonth')} onClick={() => set({ month: shift(d.month, -1) })} className="grid size-8.5 place-items-center rounded-full bg-wash text-muted">
              <Icon name="chev" size={15} strokeWidth={2} className="rotate-180" />
            </button>
            <span aria-live="polite" className="min-w-30 text-center text-ui font-semibold text-ink">
              {monthLabel(d.month)}
            </span>
            <button
              type="button"
              aria-label={t('overview.nextMonth')}
              disabled={d.month >= max}
              onClick={() => set({ month: shift(d.month, 1) })}
              className="grid size-8.5 place-items-center rounded-full bg-wash text-muted disabled:opacity-40"
            >
              <Icon name="chev" size={15} strokeWidth={2} />
            </button>
          </div>
          <a href={`/exports/${d.tab}.xlsx?month=${d.month}`} download className="btn btn-sec no-underline">
            <Icon name="download" size={16} strokeWidth={1.8} />
            {t('reports.download')}
          </a>
          {d.tab === 'leave' && (
            <Link to="/leave-statements" search={{ year: Number(d.month.slice(0, 4)) }} className="btn btn-sec no-underline">
              {t('reports.statements')}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6">
        {d.tab === 'leave' && <LeaveView r={d.report as LeaveReport} thisYear={Number(today.slice(0, 4))} />}
        {d.tab === 'expense' && <ExpenseView r={d.report as ExpenseReport} />}
        {d.tab === 'purchase' && <PurchaseView r={d.report as PurchaseTravelReport} />}
      </div>
    </section>
  )
}

function Stats({ items }: { items: [string, ReactNode, string?][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map(([label, value, note]) => (
        <div key={label} className="panel-glass rounded-3xl px-5 pt-4.5 pb-4">
          <span className="text-link text-muted">{label}</span>
          <b className="num mt-2.5 block text-[2rem] leading-none font-semibold tracking-[-0.03em]">{value}</b>
          {note && <small className="mt-2 block text-micro text-faint">{note}</small>}
        </div>
      ))}
    </div>
  )
}

const Status = ({ s }: { s: string }) => {
  const dot = statusIs(s, 'approved') ? 'bg-status-approved' : statusIs(s, 'paid') ? 'bg-status-paid' : statusIs(s, 'rejected') ? 'bg-status-rejected' : 'bg-status-pending'
  return (
    <span className="inline-flex items-center gap-1.5 text-micro font-medium">
      <span className={`size-1.75 rounded-full ${dot}`} />
      {s}
    </span>
  )
}

const num = (v: ReactNode) => <span className="num text-link">{v}</span>

function LeaveView({ r, thisYear }: { r: LeaveReport; thisYear: number }) {
  const onLeave = new Set(r.entries.filter((e) => statusIs(e.status, 'approved')).map((e) => e.name)).size
  const noEntitlement = r.balances.filter((b) => b.entitled == null).length
  const balanceCols: Column<LeaveReport['balances'][number]>[] = [
    { key: 'name', header: t('reports.person'), primary: true, cell: (b) => (<><b className="block text-row font-semibold">{b.name}</b><span className="text-micro text-faint">{b.role}</span></>) },
    { key: 'ent', header: t('reports.leave.entitled'), right: true, cell: (b) => num(b.entitled == null ? t('reports.leave.notSet') : tn('reports.days', b.entitled)) },
    { key: 'used', header: t('reports.leave.used'), right: true, cell: (b) => num(formatLeaveDays(b.used + b.usedBefore)) },
    { key: 'pend', header: t('reports.leave.pending'), right: true, cell: (b) => num(b.pending ? formatLeaveDays(b.pending) : '—') },
    { key: 'left', header: t('reports.leave.left'), right: true, cell: (b) => <b className="num text-link font-semibold">{b.left == null ? '—' : formatLeaveDays(b.left)}</b> },
    {
      key: 'other',
      header: t('reports.leave.other'),
      right: true,
      cell: (b) => {
        const parts = [b.other.excuse && t('reports.leave.excuse', { days: formatLeaveDays(b.other.excuse) }), b.other.sick && t('reports.leave.sick', { days: formatLeaveDays(b.other.sick) }), b.other.unpaid && t('reports.leave.unpaid', { days: formatLeaveDays(b.other.unpaid) }), b.other.other && t('reports.leave.otherKind', { days: formatLeaveDays(b.other.other) })].filter(Boolean)
        return <span className="text-link text-muted">{parts.length ? parts.join(' · ') : '—'}</span>
      },
    },
    {
      key: 'stmt',
      header: t('reports.leave.statement'),
      right: true,
      cell: (b) =>
        b.statementAt ? (
          <span className="text-link text-status-approved">✓ {formatDay(b.statementAt.slice(0, 10))}</span>
        ) : b.entitled != null && r.year < thisYear ? (
          <span className="text-link text-status-pending">{t('reports.leave.waiting')}</span>
        ) : (
          <span className="text-link text-faint">—</span>
        ),
    },
  ]
  const entryCols: Column<LeaveReport['entries'][number]>[] = [
    { key: 'name', header: t('reports.person'), primary: true, cell: (e) => <b className="text-row font-semibold">{e.name}</b> },
    { key: 'kind', header: t('reports.type'), cell: (e) => <span className="text-link">{e.kind}</span> },
    { key: 'range', header: t('reports.date'), cell: (e) => <span className="text-link">{e.range}</span> },
    { key: 'days', header: t('reports.duration'), right: true, cell: (e) => num(formatLeaveDays(e.days)) },
    { key: 'st', header: t('reports.status'), cell: (e) => <Status s={e.status} /> },
  ]
  return (
    <>
      <Stats
        items={[
          [t('reports.leave.onLeave'), onLeave, t('reports.leave.approvedDays', { days: formatLeaveDays(r.totals.onLeaveDays) })],
          [t('reports.leave.pendingCount'), r.totals.pendingCount],
          [t('reports.leave.totalLeft', { year: r.year }), formatLeaveDays(r.balances.reduce((s, b) => s + (b.left ?? 0), 0)), tn('reports.people', r.balances.length)],
          [t('reports.leave.noEntitlement'), noEntitlement, noEntitlement ? t('reports.leave.noEntitlementHint') : undefined],
        ]}
      />
      <div className="mt-8">
        <SectionHead title={t('reports.leave.monthTitle', { month: monthLabel(r.month) })} action={null} />
        <div className="mt-3">
          <DataList label={t('reports.leave.monthList')} rows={r.entries} columns={entryCols} template="minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1.3fr) 6rem 8rem" rowKey={(e) => e.id} empty={t('reports.leave.monthEmpty')} />
        </div>
      </div>
      <div className="mt-8">
        <SectionHead title={t('reports.leave.balancesYear', { year: r.year })} action={null} />
        <div className="mt-3">
          <DataList label={t('reports.leave.balances')} rows={r.balances} columns={balanceCols} template="minmax(0,1.6fr) 7rem 7rem 6rem 6rem minmax(0,1.4fr) 7rem" rowKey={(b) => b.userId} />
        </div>
      </div>
    </>
  )
}

function GroupList({ title, rows }: { title: string; rows: ExpenseReport['byPerson'] }) {
  const max = Math.max(1, ...rows.map((r) => r.amount))
  return (
    <div className="panel-glass px-5 pt-4.5 pb-4">
      <SectionHead title={title} action={null} />
      {rows.length === 0 ? (
        <p className="mt-3 text-link text-faint">{t('reports.noRecords')}</p>
      ) : (
        <div className="mt-3.5 grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-x-3 gap-y-2.5 text-link">
          {rows.slice(0, 8).map((g) => (
            <div key={g.key} className="contents">
              <span className="truncate text-muted">{g.key}</span>
              <div className="h-3 rounded-r-xs bg-chart-expense opacity-85" style={{ width: `${Math.max(2, Math.round((g.amount / max) * 100))}%` }} />
              <b className="num font-semibold whitespace-nowrap">{formatMoney(g.amount)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExpenseView({ r }: { r: ExpenseReport }) {
  const lineCols: Column<ExpenseReport['lines'][number]>[] = [
    { key: 'desc', header: t('reports.expense.item'), primary: true, cell: (l) => (<><b className="block text-row font-semibold">{l.description || l.category}</b><span className="text-micro text-faint">{l.name} · {l.category}</span></>) },
    { key: 'date', header: t('reports.date'), cell: (l) => <span className="text-link">{day(l.date)}</span> },
    { key: 'proj', header: t('reports.project'), cell: (l) => <span className="text-link">{l.project || '—'}</span> },
    { key: 'amt', header: t('reports.amount'), right: true, cell: (l) => <b className="num text-link font-semibold">{formatMoney(l.amount)}</b> },
    { key: 'st', header: t('reports.status'), cell: (l) => <Status s={l.status} /> },
  ]
  const advCols: Column<ExpenseReport['advances'][number]>[] = [
    { key: 't', header: t('reports.expense.advance'), primary: true, cell: (a) => (<><b className="block text-row font-semibold">{a.title}</b><span className="text-micro text-faint">{a.name}</span></>) },
    { key: 'need', header: t('reports.date'), cell: (a) => <span className="text-link">{day(a.neededOn)}</span> },
    { key: 'amt', header: t('reports.amount'), right: true, cell: (a) => num(formatMoney(a.amount)) },
    { key: 'open', header: t('reports.expense.open'), right: true, cell: (a) => num(a.open ? formatMoney(a.open) : '—') },
    { key: 'st', header: t('reports.status'), cell: (a) => <Status s={a.status} /> },
  ]
  return (
    <>
      <Stats
        items={[
          [t('reports.expense.approved'), formatMoney(r.totals.approved), tn('reports.items', r.totals.approvedCount)],
          [t('reports.expense.pending'), formatMoney(r.totals.pending), r.totals.pendingCount ? tn('reports.items', r.totals.pendingCount) : undefined],
          [t('reports.expense.advancesPaid'), formatMoney(r.totals.advancesPaid), t('reports.thisMonth')],
          [t('reports.expense.openAdvances'), formatMoney(r.totals.openAdvances), r.openAdvances.length ? tn('reports.expense.withPeople', r.openAdvances.length) : undefined],
        ]}
      />
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <GroupList title={t('reports.expense.byPerson')} rows={r.byPerson} />
        <GroupList title={t('reports.expense.byProject')} rows={r.byProject} />
        <GroupList title={t('reports.expense.byCategory')} rows={r.byCategory} />
      </div>
      <div className="mt-8">
        <SectionHead title={t('reports.expense.lines')} action={null} />
        <div className="mt-3">
          <DataList label={t('reports.expense.lines')} rows={r.lines} columns={lineCols} template="minmax(0,2fr) 8rem minmax(0,1.4fr) 9rem 8rem" rowKey={(l) => `${l.requestId}-${l.date}-${l.description}-${l.amount}`} empty={t('reports.expense.linesEmpty')} />
        </div>
      </div>
      <div className="mt-8">
        <SectionHead title={t('reports.expense.advances')} action={null} />
        <div className="mt-3">
          <DataList label={t('reports.expense.advances')} rows={r.advances} columns={advCols} template="minmax(0,2fr) 8rem 9rem 9rem 8rem" rowKey={(a) => a.requestId} empty={t('reports.expense.advancesEmpty')} />
        </div>
      </div>
    </>
  )
}

function PurchaseView({ r }: { r: PurchaseTravelReport }) {
  const purCols: Column<PurchaseTravelReport['purchases'][number]>[] = [
    { key: 'item', header: t('reports.purchase.item'), primary: true, cell: (p) => (<><b className="block text-row font-semibold">{p.item}{p.quantity > 1 ? ` × ${p.quantity}` : ''}</b><span className="text-micro text-faint">{p.name} · {p.category}</span></>) },
    { key: 'date', header: t('reports.purchase.requested'), cell: (p) => <span className="text-link">{day(p.date)}</span> },
    { key: 'amt', header: t('reports.purchase.estimate'), right: true, cell: (p) => <b className="num text-link font-semibold">{formatMoney(p.amount)}</b> },
    { key: 'st', header: t('reports.status'), cell: (p) => <Status s={p.status} /> },
  ]
  const trvCols: Column<PurchaseTravelReport['travels'][number]>[] = [
    { key: 'dest', header: t('reports.purchase.travel'), primary: true, cell: (x) => (<><b className="block text-row font-semibold">{x.destination} · {x.range}</b><span className="text-micro text-faint">{x.name} · {x.purpose}</span></>) },
    { key: 'proj', header: t('reports.project'), cell: (x) => <span className="text-link">{x.project || '—'}</span> },
    { key: 'tr', header: t('reports.purchase.transport'), cell: (x) => <span className="text-link">{x.transport}</span> },
    { key: 'bud', header: t('reports.purchase.budget'), right: true, cell: (x) => num(x.budget == null ? '—' : formatMoney(x.budget)) },
    { key: 'adv', header: t('reports.purchase.advance'), right: true, cell: (x) => num(x.advance ? formatMoney(x.advance) : '—') },
    { key: 'st', header: t('reports.status'), cell: (x) => <Status s={x.status} /> },
  ]
  return (
    <>
      <Stats
        items={[
          [t('reports.purchase.approved'), formatMoney(r.totals.purchaseApproved), t('reports.purchase.estimateNote')],
          [t('reports.purchase.pending'), formatMoney(r.totals.purchasePending)],
          [t('reports.purchase.travel'), r.totals.travelCount, t('reports.purchase.travelNote')],
          [t('reports.purchase.travelBudget'), formatMoney(r.totals.travelBudget), t('reports.purchase.budgetNote')],
        ]}
      />
      <div className="mt-8">
        <SectionHead title={t('reports.purchase.requests')} action={null} />
        <div className="mt-3">
          <DataList label={t('reports.purchase.requests')} rows={r.purchases} columns={purCols} template="minmax(0,2.4fr) 9rem 10rem 8rem" rowKey={(p) => p.requestId} empty={t('reports.purchase.requestsEmpty')} />
        </div>
      </div>
      <div className="mt-8">
        <SectionHead title={t('reports.purchase.travels')} action={null} />
        <div className="mt-3">
          <DataList label={t('reports.purchase.travels')} rows={r.travels} columns={trvCols} template="minmax(0,2.2fr) minmax(0,1.3fr) 6rem 8rem 8rem 8rem" rowKey={(t) => t.requestId} empty={t('reports.purchase.travelsEmpty')} />
        </div>
      </div>
    </>
  )
}
