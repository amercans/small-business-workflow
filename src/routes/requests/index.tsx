import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { loadMyRequests, type RequestStatus, type RequestType } from '#/data/home'
import { HomeRequests } from '#/components/home/HomeRequests'
import { Select } from '#/components/Select'
import { rememberRequestsSearch } from '#/lib/requestsFilter'
import { intlLocale, t, tn } from '#/i18n'

const TYPES: { value: RequestType }[] = [{ value: 'leave' }, { value: 'expense' }, { value: 'advance' }, { value: 'purchase' }, { value: 'travel' }]
const STATUSES: RequestStatus[] = ['pending', 'approved', 'paid', 'rejected', 'cancelled']

type Search = { q?: string; type?: RequestType; status?: RequestStatus; period?: string }
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export const Route = createFileRoute('/requests/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: str(s.q),
    type: TYPES.some((t) => t.value === s.type) ? (s.type as RequestType) : undefined,
    status: STATUSES.includes(s.status as RequestStatus) ? (s.status as RequestStatus) : undefined,
    period: str(s.period),
  }),
  loader: async ({ context }) => ({
    ...(await loadMyRequests()),
    todayISO: (context as { session: { todayISO: string } }).session.todayISO,
  }),
  component: Requests,
})

function daysAgo(todayISO: string, n: number) {
  const d = new Date(`${todayISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function Requests() {
  const { requests, statusLabel, todayISO } = Route.useLoaderData()
  const search = Route.useSearch()
  useEffect(() => rememberRequestsSearch(search), [search])
  const navigate = Route.useNavigate()
  const q = search.q ?? ''
  const type = search.type ?? ''
  const status = search.status ?? ''
  const period = search.period ?? ''
  const set = (patch: Partial<Record<keyof Search, string>>) =>
    navigate({ search: (s) => ({ ...s, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v || undefined])) }), replace: true })

  const thisYear = todayISO.slice(0, 4)
  const years = [...new Set(requests.map((r) => r.dateISO?.slice(0, 4)).filter((y): y is string => !!y && y !== thisYear))].sort().reverse()

  const inPeriod = (iso?: string) => {
    if (!period) return true
    if (!iso) return false
    if (period === '30') return iso >= daysAgo(todayISO, 30)
    if (period === '90') return iso >= daysAgo(todayISO, 90)
    return iso.startsWith(period)
  }
  const needle = q.trim().toLocaleLowerCase(intlLocale())
  const rows = requests.filter(
    (r) =>
      (!type || r.type === type) &&
      (!status || r.status === status) &&
      inPeriod(r.dateISO) &&
      (!needle || `${r.title} ${r.typeLabel} ${r.amount}`.toLocaleLowerCase(intlLocale()).includes(needle)),
  )
  const filtered = !!(q || type || status || period)
  const clear = () => navigate({ search: {}, replace: true })

  return (
    <section className="pb-10">
      <div>
        <h1 className="text-display-sm font-semibold sm:text-display">{t('nav.mine')}</h1>
        <p className="mt-2.5 text-label text-muted">
          {filtered ? t('requests.countFiltered', { shown: rows.length, total: requests.length }) : tn('requests.count', requests.length)}
        </p>
      </div>
      {requests.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <input
            type="search"
            aria-label={t('requests.searchLabel')}
            placeholder={t('requests.searchPlaceholder')}
            value={q}
            onChange={(e) => set({ q: e.target.value })}
            className="input col-span-2 min-w-0 sm:w-64"
          />
          <div className="sm:w-40">
            <Select aria-label={t('requests.type')} value={type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">{t('requests.allTypes')}</option>
              {TYPES.map((x) => (
                <option key={x.value} value={x.value}>{t(`requests.types.${x.value}`)}</option>
              ))}
            </Select>
          </div>
          <div className="sm:w-40">
            <Select aria-label={t('requests.status')} value={status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">{t('requests.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel[s]}</option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 sm:w-40">
            <Select aria-label={t('requests.period')} value={period} onChange={(e) => set({ period: e.target.value })}>
              <option value="">{t('requests.allTime')}</option>
              <option value="30">{t('requests.last30')}</option>
              <option value="90">{t('requests.last90')}</option>
              <option value={thisYear}>{t('requests.thisYear')}</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
          <button
            type="button"
            onClick={clear}
            tabIndex={filtered ? undefined : -1}
            aria-hidden={filtered ? undefined : true}
            className={`btn btn-sec col-span-2 sm:col-span-1 ${filtered ? '' : 'max-sm:hidden sm:invisible'}`}
          >
            {t('requests.clearFilters')}
          </button>
        </div>
      )}
      <div className="mt-5">
        <HomeRequests requests={rows} statusLabel={statusLabel} full emptyText={filtered ? t('requests.noneFiltered') : undefined} view={`${q}|${type}|${status}|${period}`} />
      </div>
    </section>
  )
}
