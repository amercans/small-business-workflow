import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Icon, type IconName } from '#/components/Icon'
import { InvoicePill, TitleRow } from '#/components/InvoicePill'
import { JobSheet, type JobTarget } from '#/components/JobSheet'
import { JobsSummaryView } from '#/components/JobsSummary'
import { Segmented } from '#/components/Segmented'
import { loadJobs, loadJobsSummary, type Job, type PricedJob } from '#/data/jobs'
import { monthLong } from '#/lib/finance'
import { guard } from '#/lib/guard'
import { jobTypeLabel, type JobKind } from '#/lib/jobs'
import { formatDay, isValidISO } from '#/lib/leave'
import { formatMoney, formatMoneyRounded } from '#/lib/money'
import { useSession } from '#/lib/useSession'
import { intlLocale, t, tn } from '#/i18n'

type Search = { from?: string; to?: string; view?: 'summary' }

export const Route = createFileRoute('/jobs')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const ok = (v: unknown): v is string => typeof v === 'string' && isValidISO(v)
    const period = ok(s.from) && ok(s.to) && s.from <= s.to ? { from: s.from, to: s.to } : {}
    return s.view === 'summary' ? { ...period, view: 'summary' } : period
  },
  beforeLoad: guard('jobs'),
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to, view: search.view }),
  loader: async ({ deps }) => {
    const page = await loadJobs({ data: deps.from && deps.to ? { from: deps.from, to: deps.to } : {} })
    const summary = deps.view === 'summary' && page.money ? await loadJobsSummary(page.period) : null
    return { page, summary }
  },
  component: Jobs,
})

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const monthOf = (y: number, m: number) => {
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay(y, m)).padStart(2, '0')}` }
}
const shiftMonth = (from: string, n: number) => {
  const i = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1 + n
  return monthOf(Math.floor(i / 12), (i % 12) + 1)
}
const isWholeMonth = (p: { from: string; to: string }) => {
  const m = monthOf(Number(p.from.slice(0, 4)), Number(p.from.slice(5, 7)))
  return m.from === p.from && m.to === p.to
}
const dayYear = (iso: string) => `${formatDay(iso)} ${iso.slice(0, 4)}`
const periodLabel = (p: { from: string; to: string }) =>
  isWholeMonth(p)
    ? `${monthLong(Number(p.from.slice(5, 7)))} ${p.from.slice(0, 4)}`
    : p.from.slice(0, 4) === p.to.slice(0, 4)
      ? `${formatDay(p.from)} – ${dayYear(p.to)}`
      : `${dayYear(p.from)} – ${dayYear(p.to)}`

const tl = (n: number) => (Number.isInteger(n) ? formatMoneyRounded(n) : formatMoney(n))
const fold = (s: string) => s.toLocaleLowerCase(intlLocale())

function Jobs() {
  const { page, summary } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const today = useSession().todayISO
  const [sheet, setSheet] = useState<JobTarget | null>(null)
  const [returnKey, setReturnKey] = useState('add-job')
  const [flash, setFlash] = useState('')
  const openSheet = (job: Job | null, focus?: 'amount') => {
    setReturnKey(job ? `job-${job.id}` : 'add-job')
    setSheet({ job, focus })
  }
  const money = page.money
  const priced = (j: Job) => (money ? (j as PricedJob) : null)

  const [q, setQ] = useState('')
  const [client, setClient] = useState<string | null>(null)
  const [kind, setKind] = useState<JobKind | null>(null)
  const [noAmount, setNoAmount] = useState(false)
  const [group, setGroup] = useState(false)

  const jobs: Job[] = page.jobs
  const kindName = (k: JobKind) => jobTypeLabel(page.types.find((x) => x.id === k), k)
  const notBillable = (j: Job) => priced(j)?.notBillable === true
  const missing = (j: Job) => {
    const pj = priced(j)
    return !!pj && !pj.notBillable && pj.amount == null
  }

  const query = fold(q.trim())
  const rows = jobs.filter(
    (j) =>
      (!client || j.client === client) &&
      (!kind || j.kind === kind) &&
      (!noAmount || missing(j)) &&
      (!query || fold([j.title, j.client, j.unit ?? ''].join(' ')).includes(query)),
  )
  const filtering = !!(q.trim() || client || kind || noAmount)
  const clear = () => {
    setQ('')
    setClient(null)
    setKind(null)
    setNoAmount(false)
  }

  const firmCount = new Set(jobs.map((j) => j.client)).size
  const amounts = jobs.map((j) => (notBillable(j) ? null : priced(j)?.amount)).filter((a): a is number => a != null)
  const total = amounts.reduce((sum, a) => sum + a, 0)
  const missingCount = jobs.filter(missing).length
  const notBillableCount = jobs.filter(notBillable).length

  const count = (key: (j: Job) => string) => {
    const m = new Map<string, number>()
    for (const j of jobs) m.set(key(j), (m.get(key(j)) ?? 0) + 1)
    return m
  }
  const clientCounts = count((j) => j.client)
  const kindCounts = count((j) => j.kind)

  const period = page.period
  const setPeriod = (p: { from: string; to: string }) => void navigate({ search: (s) => ({ ...s, ...p }), replace: true })
  const view: 'list' | 'summary' = page.money && search.view === 'summary' ? 'summary' : 'list'
  const setView = (v: 'list' | 'summary') => void navigate({ search: { from: page.period.from, to: page.period.to, ...(v === 'summary' ? { view: 'summary' as const } : {}) }, replace: true })
  const pick = (c: string) => {
    setQ('')
    setKind(null)
    setNoAmount(false)
    setClient(c)
    setView('list')
  }
  const thisMonth = monthOf(Number(today.slice(0, 4)), Number(today.slice(5, 7)))

  const template = money ? 'minmax(0,1fr) minmax(0,13.75rem) 9.5rem 10rem 1.25rem' : 'minmax(0,1fr) minmax(0,13.75rem) 9.5rem 1.25rem'

  const rowDate = (j: Job) => (j.end ? formatDay(j.end) : '')

  const row = (j: Job) => {
    const pj = priced(j)
    return (
      <div key={j.id} role="listitem" className="data-row">
        <button type="button" data-k={`job-${j.id}`} onClick={() => openSheet(j)} className="grid w-full cursor-pointer items-center text-left gap-x-4.5 gap-y-1.5 px-4.5 py-2.75 max-lg:grid-cols-[minmax(0,1fr)_auto]! lg:min-h-14.5" style={{ gridTemplateColumns: template }}>
          <span className="min-w-0">
            <b className="block text-row font-semibold tracking-[-0.012em]">
              <TitleRow pills={j.hasInvoice && <InvoicePill />}>{j.title}</TitleRow>
            </b>
            <span className="mt-0.75 flex items-center gap-1.5 text-micro text-faint lg:hidden">
              <span className="min-w-0 truncate">{[j.client, kindName(j.kind), rowDate(j)].filter(Boolean).join(' · ')}</span>
              {!j.end && <DateCell j={j} />}
            </span>
            <span className="mt-0.75 flex items-center gap-1.25 text-micro text-faint max-lg:hidden">
              <Icon name="jobs" size={13} strokeWidth={1.7} className="text-faint-2" />
              <span className="font-medium text-muted">{kindName(j.kind)}</span>
            </span>
          </span>
          <span className="min-w-0 truncate text-ui text-ink max-lg:hidden">{j.client}</span>
          <span className="text-link text-muted max-lg:hidden">
            <DateCell j={j} />
          </span>
          {money && (
            <span className="text-right">
              {pj!.notBillable ? (
                <span className="text-small whitespace-nowrap text-faint">{t('jobs.list.notBillable')}</span>
              ) : pj!.amount == null ? (
                <AmountChip onOpen={() => openSheet(j, 'amount')} />
              ) : (
                <span className="num text-ui font-medium">{tl(pj!.amount)}</span>
              )}
            </span>
          )}
          <span aria-hidden="true" className="hidden lg:block" />
        </button>
      </div>
    )
  }

  const groups = group
    ? [...new Set(rows.map((j) => j.client))].sort((a, b) => a.localeCompare(b, intlLocale())).map((c) => ({ client: c, jobs: rows.filter((j) => j.client === c) }))
    : null

  return (
    <section className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:gap-y-4">
        <div className="max-sm:order-1 max-sm:mr-auto">
          <h1 className="text-display-sm font-semibold sm:text-display">{t('jobs.list.title')}</h1>
          <p className="mt-1.5 text-label text-muted sm:mt-2.5">
            {periodLabel(period)} · {tn('jobs.list.jobCount', jobs.length)} · {tn('jobs.list.clientCount', new Set(jobs.map((j) => j.client)).size)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 max-sm:contents">
          <div className="max-sm:order-3 max-sm:w-full">
          <PeriodPicker period={period} isMonth={isWholeMonth(period)} onChange={setPeriod} onThisMonth={() => setPeriod(thisMonth)} isThisMonth={period.from === thisMonth.from && period.to === thisMonth.to} />
          </div>
          {page.canWrite && (
            <button type="button" data-k="add-job" onClick={() => openSheet(null)} className="btn btn-pri max-sm:order-2">
              <Icon name="plus" size={16} strokeWidth={2} />
              {t('jobs.list.add')}
            </button>
          )}
        </div>
      </div>

      {flash && (
        <p role="status" className="mt-4 text-link font-medium text-status-approved">
          {flash}
        </p>
      )}

      {money && (
        <div className="mt-3 sm:mt-5">
          <Segmented
            label={t('jobs.list.view')}
            value={view}
            options={[
              { value: 'list', label: t('jobs.list.title') },
              { value: 'summary', label: t('jobs.list.summary') },
            ]}
            onChange={setView}
          />
        </div>
      )}

      {view === 'summary' && summary ? (
        <>
          <dl className="m-0 mt-3 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-y-4 sm:px-1">
            <Stat label={t('jobs.stats.jobs')} value={summary.jobs} sub={<JobsSub firms={summary.firms.length} notBillable={summary.notBillable} />} />
            <Stat label={t('jobs.stats.total')} value={tl(summary.amount)} sub={summary.jobs - summary.missing - summary.notBillable ? <>{t('jobs.stats.average')} <em>{tl(Math.round(summary.amount / (summary.jobs - summary.missing - summary.notBillable)))}</em></> : t('jobs.stats.noAmount')} />
            <Stat label={t('jobs.stats.missing')} value={summary.missing} sub={t('jobs.stats.excluded')} hi={summary.missing > 0} />
          </dl>
          <JobsSummaryView data={summary} onPickClient={pick} />
          {summary.undated > 0 && <p className="mt-4 px-1 text-micro text-faint">{tn('jobs.stats.undated', summary.undated)}</p>}
        </>
      ) : (
      <>
      <dl className="m-0 mt-3 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-y-4 sm:px-1">
        {money ? (
          <>
            <Stat label={t('jobs.stats.jobs')} value={jobs.length} sub={<JobsSub firms={firmCount} notBillable={notBillableCount} />} />
            <Stat label={t('jobs.stats.total')} value={tl(total)} sub={amounts.length ? <>{t('jobs.stats.average')} <em>{tl(Math.round(total / amounts.length))}</em></> : t('jobs.stats.noAmount')} />
            <Stat label={t('jobs.stats.missing')} value={missingCount} sub={t('jobs.stats.excluded')} hi={missingCount > 0} />
          </>
        ) : (
          <>
            <Stat label={t('jobs.stats.jobs')} value={jobs.length} sub={periodLabel(period)} />
            <Stat label={t('jobs.stats.clients')} value={firmCount} sub={t('jobs.stats.thisPeriod')} />
          </>
        )}
      </dl>

      <div className="kar mt-5 rounded-3xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-kar-line-2 px-4 pt-3.5 pb-3">
          <label className="flex h-8.5 w-full items-center gap-2 rounded-full bg-surface/75 px-3 text-faint shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--color-kar-line)] focus-within:shadow-[inset_0_1px_0_#fff,0_0_0_1.5px_var(--color-blue)] sm:w-52 sm:min-w-52 xl:flex-1 xl:max-w-62.5">
            <Icon name="search" size={15} strokeWidth={1.8} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('jobs.list.searchPlaceholder')} aria-label={t('jobs.list.searchLabel')} className="min-w-0 flex-1 bg-transparent text-link text-ink outline-none placeholder:text-faint-2" />
          </label>
          <ChipMenu
            label={t('jobs.list.client')}
            value={client}
            display={client}
            onChange={setClient}
            options={page.clients.filter((c) => clientCounts.has(c)).map((c) => ({ value: c, label: c, count: clientCounts.get(c)! }))}
          />
          <ChipMenu
            label={t('jobs.list.kind')}
            value={kind}
            display={kind && kindName(kind)}
            onChange={(v) => setKind(v as JobKind | null)}
            options={page.types.filter((k) => kindCounts.has(k.id)).map((k) => ({ value: k.id, label: jobTypeLabel(k), count: kindCounts.get(k.id)!, icon: 'jobs' as IconName }))}
          />
          {money && (
            <button
              type="button"
              aria-pressed={noAmount}
              onClick={() => setNoAmount((x) => !x)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-small font-medium whitespace-nowrap transition-colors ${noAmount ? 'bg-blue text-on-accent' : 'bg-surface/65 text-muted shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--color-kar-line-2)] hover:bg-surface hover:text-ink'}`}
            >
              {t('jobs.list.missingFilter')}
              <b className={`font-semibold ${noAmount ? 'opacity-70' : 'text-faint'}`}>{missingCount}</b>
            </button>
          )}
          <button type="button" role="switch" aria-checked={group} onClick={() => setGroup((g) => !g)} className="ml-auto inline-flex items-center gap-2.25 text-small font-medium whitespace-nowrap text-muted">
            <span aria-hidden="true" className={`relative h-5 w-8.5 shrink-0 rounded-full transition-colors duration-200 ${group ? 'bg-blue-ink' : 'bg-seg-off-dark'}`}>
              <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-seg-on transition-transform duration-200 ease-settle ${group ? 'translate-x-3.5' : ''}`} />
            </span>
            {t('jobs.list.groupByClient')}
          </button>
        </div>

        <div aria-hidden="true" className="hidden h-9 items-center gap-x-4.5 border-b border-kar-line-2 px-4.5 text-micro font-medium text-faint lg:grid" style={{ gridTemplateColumns: template }}>
          <span>{t('jobs.list.colJob')}</span>
          <span>{t('jobs.list.client')}</span>
          <span>{t('jobs.list.colEnd')}</span>
          {money && <span className="text-right">{t('jobs.list.colAmount')}</span>}
          <span />
        </div>

        <div role="list" aria-label={t('jobs.list.title')} className="px-0">
          {rows.length === 0 ? (
            <div className="px-5 py-16 text-center text-label text-faint">
              <b className="mb-1.5 block text-tile font-semibold text-ink">{jobs.length ? t('jobs.list.emptyFiltered') : t('jobs.list.emptyPeriod')}</b>
              {jobs.length ? t('jobs.list.emptyFilteredHint') : t('jobs.list.emptyPeriodHint')}
            </div>
          ) : groups ? (
            groups.map((g) => {
              const sum = g.jobs.reduce((acc, j) => acc + (priced(j)?.amount ?? 0), 0)
              const none = g.jobs.filter(missing).length
              return (
                <div key={g.client}>
                  <div style={{ '--jobs-cols': template } as CSSProperties} className="sticky top-0 z-2 flex items-baseline gap-x-4.5 gap-y-0 border-b border-kar-line-2 bg-snow-hi/90 px-4.5 pt-3.5 pb-2 backdrop-blur-sm lg:grid lg:grid-cols-(--jobs-cols)">
                    <span className="flex min-w-0 items-baseline gap-2.5 lg:col-span-2">
                      <b className="truncate text-ui font-semibold">{g.client}</b>
                      <span className="shrink-0 text-micro text-faint">{tn('jobs.list.jobCount', g.jobs.length)}</span>
                    </span>
                    {money && (
                      <span className="num ml-auto text-micro whitespace-nowrap text-muted lg:col-span-2 lg:ml-0 lg:text-right">
                        {tl(sum)}
                        {none > 0 && (
                          <>
                            {' · '}
                            <em className="font-semibold text-blue-ink not-italic">{none}</em> {tn('jobs.list.missingSuffix', none)}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  {g.jobs.map(row)}
                </div>
              )
            })
          ) : (
            rows.map(row)
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-3xl border-t border-kar-line-2 bg-surface/40 px-4.5 py-2.5 text-micro text-faint">
          <span>
            {tn('jobs.list.showing', rows.length)}
            {filtering && (
              <>
                {' · '}
                <button type="button" onClick={clear} className="font-medium text-blue-ink">
                  {t('jobs.list.clearFilters')}
                </button>
              </>
            )}
          </span>
          <span>{t('jobs.list.byEndDate')} · {periodLabel(period)}</span>
        </div>
      </div>
      </>
      )}

      <JobSheet
        target={sheet && sheet.job ? { ...sheet, job: jobs.find((j) => j.id === sheet.job!.id) ?? sheet.job } : sheet}
        page={page}
        returnKey={returnKey}
        onClose={() => setSheet(null)}
        onInvoicesChanged={() => void router.invalidate()}
        onDone={(m) => {
          setFlash(m)
          void router.invalidate()
        }}
      />
    </section>
  )
}

function JobsSub({ firms, notBillable }: { firms: number; notBillable: number }) {
  return (
    <>
      <em>{firms}</em> {tn('jobs.stats.clientSuffix', firms)}
      {notBillable > 0 && (
        <>
          {' · '}
          <em>{notBillable}</em> {t('jobs.stats.notBillableSuffix')}
        </>
      )}
    </>
  )
}

function Stat({ label, value, sub, hi }: { label: string; value: ReactNode; sub: ReactNode; hi?: boolean }) {
  return (
    <div className="min-w-0 border-kar-line max-sm:rounded-2xl max-sm:bg-surface max-sm:p-2.5 sm:mr-5.5 sm:border-r sm:pr-5.5 sm:last:mr-0 sm:last:border-0">
      <dt className="text-micro font-medium text-faint sm:text-small">{label}</dt>
      <dd className={`num m-0 mt-1.25 text-small whitespace-nowrap leading-[1.15] font-bold tracking-[-0.04em] sm:text-[1.875rem] sm:leading-[1.05] ${hi ? 'text-blue-ink' : 'text-ink'}`}>{value}</dd>
      <dd className="m-0 mt-1.25 text-micro text-faint max-sm:hidden [&_em]:font-semibold [&_em]:text-muted [&_em]:not-italic">{sub}</dd>
    </div>
  )
}

function DateCell({ j }: { j: Job }) {
  return j.end ? (
    <span className="num">
      {formatDay(j.end)}
      <small className="ml-0.75 text-micro text-faint-2">{j.end.slice(0, 4)}</small>
    </span>
  ) : (
    <span
      title={t('jobs.list.noEndTitle')}
      className="inline-flex h-6 items-center rounded-full px-2.25 text-[0.71875rem] font-semibold whitespace-nowrap text-status-pending bg-[color-mix(in_srgb,var(--color-status-pending)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-status-pending)_22%,transparent)]">
      {t('jobs.list.noEnd')}
    </span>
  )
}

function AmountChip({ onOpen }: { onOpen: () => void }) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className="inline-flex h-6 items-center gap-1.25 rounded-full bg-blue/18 px-2.25 pl-1.75 text-[0.71875rem] font-semibold whitespace-nowrap text-blue-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-blue-ink)_18%,transparent)]">
      <Icon name="plus" size={11} strokeWidth={2.4} />
      {t('jobs.list.enterAmount')}
    </span>
  )
}

function ChipMenu({
  label,
  value,
  display,
  options,
  onChange,
  emptyText,
}: {
  label: string
  value: string | null
  display?: string | null
  options: { value: string; label: string; count: number; icon?: IconName }[]
  onChange: (v: string | null) => void
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const on = value != null
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (on ? onChange(null) : setOpen((o) => !o))}
        aria-label={on ? t('jobs.list.filterRemove', { label, value: display ?? '' }) : t('jobs.list.filterLabel', { label })}
        className={`inline-flex h-8 max-w-56 items-center gap-1.5 rounded-full pr-2.5 pl-3 text-small font-medium whitespace-nowrap transition-colors ${on ? 'bg-ink text-on-dark' : 'bg-surface/65 text-muted shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--color-kar-line-2)] hover:bg-surface hover:text-ink'}`}
      >
        <span className="truncate">{on ? display : label}</span>
        <Icon name={on ? 'x' : 'chev'} size={13} strokeWidth={2} className={on ? 'opacity-60' : 'rotate-90 text-chevron'} />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+0.375rem)] left-0 z-30 max-h-80 min-w-55 overflow-y-auto rounded-2xl bg-surface/96 p-1.5 shadow-sheet backdrop-blur-xl">
          {options.length === 0 && <p className="px-2.5 py-2 text-small text-faint">{emptyText ?? t('jobs.list.noOptions')}</p>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-[0.625rem] px-2.5 py-2 text-left text-link font-medium text-ink hover:bg-wash"
            >
              {o.icon && <Icon name={o.icon} size={14} strokeWidth={1.7} className="text-faint" />}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <b className="num font-medium text-faint">{o.count}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PeriodPicker({
  period,
  isMonth,
  isThisMonth,
  onChange,
  onThisMonth,
}: {
  period: { from: string; to: string }
  isMonth: boolean
  isThisMonth: boolean
  onChange: (p: { from: string; to: string }) => void
  onThisMonth: () => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(period.from)
  const [to, setTo] = useState(period.to)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    setFrom(period.from)
    setTo(period.to)
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('keydown', esc)
    }
  }, [open, period.from, period.to])
  const valid = isValidISO(from) && isValidISO(to) && from <= to
  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <div role="group" aria-label={t('jobs.period.label')} className="kar-advance flex items-center gap-1 p-1">
        <button type="button" aria-label={t('jobs.period.prev')} onClick={() => onChange(shiftMonth(period.from, -1))} className="grid size-8 place-items-center rounded-full text-muted hover:bg-kar-wash">
          <Icon name="chev" size={15} strokeWidth={2} className="rotate-180" />
        </button>
        <span aria-live="polite" className="min-w-28 px-1 text-center text-ui font-semibold whitespace-nowrap text-ink">
          {periodLabel(period)}
        </span>
        <button type="button" aria-label={t('jobs.period.next')} onClick={() => onChange(shiftMonth(isMonth ? period.from : period.to, isMonth ? 1 : 0))} className="grid size-8 place-items-center rounded-full text-muted hover:bg-kar-wash">
          <Icon name="chev" size={15} strokeWidth={2} />
        </button>
      </div>
      {!isThisMonth && (
        <button type="button" onClick={onThisMonth} className="btn-tint rounded-full px-3 py-1.5 text-micro">
          {t('jobs.period.thisMonth')}
        </button>
      )}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="btn btn-sec h-10.5! px-4! text-ui">
        {t('jobs.period.pick')}
      </button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            onChange({ from, to })
            setOpen(false)
          }}
          className="absolute top-[calc(100%+0.5rem)] right-0 z-30 flex w-72 flex-col gap-3 rounded-2xl bg-surface/96 p-4 shadow-sheet backdrop-blur-xl"
        >
          <p className="text-small text-faint">{t('jobs.period.help')}</p>
          <label className="flex flex-col gap-1.5 text-small font-medium text-muted">
            {t('jobs.period.from')}
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-small font-medium text-muted">
            {t('jobs.period.to')}
            <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" disabled={!valid} className="btn btn-pri">
            {t('jobs.period.apply')}
          </button>
        </form>
      )}
    </div>
  )
}
