import { useState } from 'react'
import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { FixedCostSheet } from '#/components/FixedCostSheet'
import { Icon } from '#/components/Icon'
import { OverviewChart } from '#/components/OverviewChart'
import { loadOverview } from '#/data/finance'
import { daysLeft, isHot } from '#/lib/agreements'
import { clampIndex, headline, hourlyRate, monthLong, net, pnl } from '#/lib/finance'
import { guard } from '#/lib/guard'
import { formatSignedRounded, formatMoneyRounded } from '#/lib/money'
import { canAccess } from '#/lib/permissions'
import { t, tn } from '#/i18n'

export const Route = createFileRoute('/overview')({
  beforeLoad: guard('overview'),
  loader: () => loadOverview(),
  component: Overview,
})

const rootApi = getRouteApi('__root__')

function Overview() {
  const { user } = rootApi.useRouteContext().session
  const d = Route.useLoaderData()
  const { months, todayISO: TODAY_ISO, currentKey: CURRENT_MONTH_KEY, receivables } = d
  const [idx, setIdx] = useState(months.length - 1)
  const [editing, setEditing] = useState(false)
  const router = useRouter()
  const m = months[idx]
  const isCurrent = m.key === CURRENT_MONTH_KEY
  const n = net(m)

  const p = pnl(m.income, m.breakdown)
  const hr = m.fixedMissing ? null : hourlyRate(m.breakdown, d.rate)

  const upcoming = [
    ...d.expiring.map((a) => ({ key: `a-${a.id}`, name: a.counterparty, sub: a.title, left: daysLeft(a.end, TODAY_ISO) ?? 999, agreementId: a.id as string | undefined })),
    ...d.renewals.map((r) => ({ key: `d-${r.id}`, name: r.name, sub: r.sub ? t('overview.renewalOf', { sub: r.sub }) : t('overview.renewal'), left: daysLeft(r.renewsOn, TODAY_ISO) ?? 999, agreementId: undefined })),
  ]
    .sort((x, y) => x.left - y.left)
    .slice(0, 3)
  const pendingN = d.pending.leave + d.pending.other
  const monthName = monthLong(m.month)

  return (
    <section className="flex flex-col gap-5 pb-10">
      <header className="flex flex-col gap-4 px-1.5 pt-2.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 aria-live="polite" className="text-[1.0625rem] font-medium text-muted">
            {headline(m.month, n, isCurrent)}
          </h1>
          <div className="num mt-2 text-[3.25rem] leading-none font-semibold tracking-[-0.04em] lg:text-[4.5rem]">{formatSignedRounded(n)}</div>
        </div>
        <div role="group" aria-label={t('overview.monthPicker')} className="kar-advance gap-1 self-start p-1 sm:self-auto">
          <button
            type="button"
            aria-label={t('overview.prevMonth')}
            disabled={idx === 0}
            onClick={() => setIdx((i) => clampIndex(i - 1, months.length))}
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-kar-wash disabled:opacity-35"
          >
            <Icon name="chev" size={15} strokeWidth={2} className="rotate-180" />
          </button>
          <span className="min-w-24 text-center text-ui font-semibold text-ink">
            {monthName} {m.year}
          </span>
          <button
            type="button"
            aria-label={t('overview.nextMonth')}
            disabled={idx === months.length - 1}
            onClick={() => setIdx((i) => clampIndex(i + 1, months.length))}
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-kar-wash disabled:opacity-35"
          >
            <Icon name="chev" size={15} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:gap-5 xl:grid-cols-4">
        <Stat label={t('overview.chart.income')} value={formatMoneyRounded(m.income)} note={`${tn('overview.invoices', m.invoiceCount)} · ${tn('overview.customers', m.customerCount)}`} tone="var(--color-chart-income)" />
        <Stat label={t('overview.chart.expense')} value={formatMoneyRounded(m.expense)} note={m.fixedMissing ? t('overview.fixedMissingShort') : t('overview.exclVat')} warn={m.fixedMissing} tone="var(--color-chart-expense)" />
        <button type="button" data-k="hourly" onClick={() => setEditing(true)} className="h-full text-left">
          <Stat
            label={t('overview.hourlyCost')}
            value={hr ? formatMoneyRounded(hr.cost) : '—'}
            note={hr ? t('overview.hourlyNote', { rate: formatMoneyRounded(hr.rate), margin: d.rate.margin }) : t('overview.enterFixed')}
            warn={!hr}
          />
        </button>
        <Stat
          label={t('overview.receivables')}
          value={formatMoneyRounded(receivables.amount)}
          note={receivables.overdue > 0 ? tn('overview.overdue', receivables.overdue) : tn('overview.invoices', receivables.count)}
          warn={receivables.overdue > 0}
        />
      </div>

      <div className="kar min-w-0 px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
        <div className="kar-h">
          <h2>{t('overview.last12')}</h2>
          <span className="flex shrink-0 gap-4 text-micro font-medium whitespace-nowrap text-muted">
            <span><i className="mr-1.5 inline-block size-2.5 rounded-full bg-chart-income align-[-1px]" />{t('overview.chart.income')}</span>
            <span><i className="mr-1.5 inline-block size-2.5 rounded-full bg-chart-expense align-[-1px]" />{t('overview.chart.expense')}</span>
          </span>
        </div>
        <div className="mt-4">
          <OverviewChart data={months} selected={idx} onSelect={setIdx} />
        </div>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-3 lg:gap-5">
        <div className="kar px-5 py-5 sm:px-6.5 sm:py-6">
          <div className="kar-h">
            <h2>{t('overview.pnlTitle', { month: monthName })}</h2>
            <button type="button" data-k="fixed-costs" onClick={() => setEditing(true)} className="text-[0.875rem] font-medium text-blue-ink">
              {t('finance.fixed.title')}
            </button>
          </div>
          <dl className="m-0 mt-4 flex flex-col text-link">
            <PnlRow label={t('overview.chart.income')} value={p.income} />
            <PnlRow label={t('overview.pnl.direct')} value={-p.direct} muted />
            <PnlRow label={t('overview.pnl.netRevenue')} value={p.netRevenue} strong />
            <PnlRow label={t('overview.pnl.personnel')} value={-p.personnel} muted />
            <PnlRow label={t('overview.pnl.overhead')} value={-p.overhead} muted />
            <PnlRow label={t('overview.pnl.profit')} value={p.profit} strong note={p.margin != null ? t('overview.percent', { n: Math.round(p.margin * 100) }) : undefined} />
          </dl>
          {m.fixedMissing && <p className="mt-3 text-micro font-medium text-status-rejected">{t('overview.fixedMissing')}</p>}
        </div>

        <div className="kar flex flex-col px-5 py-5 sm:px-6.5 sm:py-6">
          <div className="kar-h">
            <h2>{t('overview.upcoming')}</h2>
            <Link to="/agreements">
              {t('agreements.title')}
              <Icon name="chev" size={13} strokeWidth={2} />
            </Link>
          </div>
          <ul className="m-0 mt-3 list-none p-0">
            {upcoming.length === 0 && <li className="py-3 text-link text-faint">{t('overview.upcomingEmpty')}</li>}
            {upcoming.map((u) => {
              const inner = (
                <>
                  <span className="min-w-0">
                    <b className="block truncate font-semibold">{u.name}</b>
                    <span className="block truncate text-muted">{u.sub}</span>
                  </span>
                  <span className={`kar-pill ${isHot(u.left) ? 'no' : 'off'}`}>{tn('overview.days', u.left)}</span>
                </>
              )
              const cls = 'flex items-center justify-between gap-3 py-3 text-link no-underline'
              return (
                <li key={u.key} className="border-t border-kar-line-2 first:border-0">
                  {u.agreementId ? (
                    <Link to="/agreements/$id" params={{ id: u.agreementId }} className={cls}>{inner}</Link>
                  ) : (
                    <Link to="/inventory" search={{ tab: 'digital' }} className={cls}>{inner}</Link>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="kar flex flex-col px-5 py-5 sm:px-6.5 sm:py-6">
          <div className="kar-h">
            <h2>{t('overview.pending')}</h2>
            {canAccess(user, 'approvals') && (
              <Link to="/approvals">
                {t('overview.open')}
                <Icon name="chev" size={13} strokeWidth={2} />
              </Link>
            )}
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <span className="num text-[4rem] leading-none font-semibold tracking-[-0.04em]">{pendingN}</span>
            <span className="text-label text-muted">{t('overview.waiting')}</span>
          </div>
          <p className="mt-auto pt-4 text-link text-muted">
            {t('overview.pendingSplit', { leave: d.pending.leave, other: d.pending.other })}
            {pendingN > 0 && <span className="text-faint"> · {t('overview.oldest', { when: d.pending.oldestDays > 0 ? tn('overview.daysAgo', d.pending.oldestDays) : t('overview.today') })}</span>}
          </p>
        </div>
      </div>

      <FixedCostSheet month={editing ? m : null} rate={d.rate} digitalMonthly={d.digitalMonthly} digitalMissingFx={d.digitalMissingFx} onClose={() => setEditing(false)} onSaved={() => void router.invalidate()} />
    </section>
  )
}

function Stat({ label, value, note, tone, warn }: { label: string; value: string; note: string; tone?: string; warn?: boolean }) {
  return (
    <div className="kar h-full rounded-3xl px-5 pt-4.5 pb-4.5 sm:px-6">
      <span className="flex items-center gap-2 text-link text-muted">
        {tone && <i className="inline-block size-2 rounded-full" style={{ background: tone }} />}
        {label}
      </span>
      <b className="num mt-3 block text-[1.875rem] leading-none font-semibold tracking-[-0.03em] whitespace-nowrap lg:text-[2.125rem]">{value}</b>
      <small className={`mt-2.5 block text-micro ${warn ? 'font-medium text-status-rejected' : 'text-faint'}`}>{note}</small>
    </div>
  )
}

function PnlRow({ label, value, strong, muted, note }: { label: string; value: number; strong?: boolean; muted?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? 'border-t border-kar-line pt-2.5' : ''}`}>
      <dt className={muted ? 'pl-3 text-muted' : 'font-semibold'}>{label}</dt>
      <dd className={`num m-0 whitespace-nowrap ${strong ? 'font-semibold' : muted ? 'text-muted' : 'font-semibold'}`}>
        {note && <span className="mr-2 text-micro font-medium text-faint">{note}</span>}
        {value < 0 ? `−${formatMoneyRounded(-value)}` : formatMoneyRounded(value)}
      </dd>
    </div>
  )
}
