import { useRef, type CSSProperties } from 'react'
import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { loadHome } from '#/data/home'
import { NewRequestLens } from '#/components/home/NewRequestLens'
import { LeaveRing } from '#/components/home/LeaveRing'
import { HomeRequests } from '#/components/home/HomeRequests'
import { formatMoney } from '#/lib/money'
import { loadMyPending } from '#/data/compliance'
import { LeaveSheet } from '#/components/LeaveSheet'
import { ExpenseSheet } from '#/components/ExpenseSheet'
import { AdvanceSheet } from '#/components/AdvanceSheet'
import { PurchaseSheet } from '#/components/PurchaseSheet'
import { TravelSheet } from '#/components/TravelSheet'
import { t, tn } from '#/i18n'

const SHEET_KEYS = ['leave', 'expense', 'advance', 'purchase', 'travel'] as const
type SheetKey = (typeof SHEET_KEYS)[number]
const TILE_SHEET: Record<string, SheetKey> = { leave: 'leave', expense: 'expense', advance: 'advance', purchase: 'purchase', travel: 'travel' }

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>): { new?: SheetKey } => (SHEET_KEYS.includes(s.new as SheetKey) ? { new: s.new as SheetKey } : {}),
  loader: async () => {
    const [home, pending] = await Promise.all([loadHome(), loadMyPending()])
    return { ...home, myPending: pending }
  },
  component: HomeData,
})

function HomeData() {
  const d = Route.useLoaderData()
  const { today, user } = rootApi.useRouteContext().session
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const sheet = search.new

  const openedHere = useRef(false)
  const openSheet = (key: SheetKey) => {
    openedHere.current = true
    void navigate({ search: { new: key } })
  }
  const closeSheet = () => {
    if (openedHere.current) {
      openedHere.current = false
      router.history.back()
    } else {
      void navigate({ search: {}, replace: true })
    }
  }
  const [dateMain, weekday] = today.split(', ')

  return (
    <div className="flex flex-col gap-3.5 pb-6 lg:gap-5">
      <header className="flex flex-col gap-3.5 px-1.5 pt-2.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[2.625rem] leading-none font-semibold tracking-[-0.035em] lg:text-[3.375rem]">
            {t('home.hello')} <span className="font-bold">{user.first}</span>
          </h1>
          <p className="mt-2 text-[0.9375rem] text-muted lg:mt-3 lg:text-[1.0625rem]">
            <b className="font-medium text-ink">{dateMain}</b>
            {weekday ? `, ${weekday}` : ''}
          </p>
          {d.advance.openAmount > 0 && d.advance.items[0] && (
            <Link to="/requests/$id" params={{ id: d.advance.items[0].id }} className="kar-advance mt-3 inline-flex self-start text-ink no-underline" title={t('home.advanceTitle')}>
              <i className="size-2 rounded-full bg-type-expense" />
              {t('home.openAdvance')} <b className="num font-semibold text-ink">{formatMoney(d.advance.openAmount)}</b>
            </Link>
          )}
        </div>
      </header>

      {(d.myPending.assets > 0 || d.myPending.statementYear) && (
        <Link to="/my-records" search={d.myPending.statementYear ? { year: d.myPending.statementYear } : {}} className="kar-note no-underline lg:mr-[calc(23.25rem+1.25rem)]" style={{ '--tint': 'var(--color-type-expense)' } as CSSProperties}>
          <span className="dot" aria-hidden="true" />
          <span className="text-[0.90625rem] text-ink">
            <b className="font-semibold">{t('home.awaitingYou')} </b>
            {[d.myPending.assets > 0 ? tn('home.assetsToConfirm', d.myPending.assets) : null, d.myPending.statementYear ? t('home.statementToConfirm', { year: d.myPending.statementYear }) : null].filter(Boolean).join(' · ')}
            <span className="text-blue-ink"> · {t('nav.records')}</span>
          </span>
        </Link>
      )}

      <div className="grid gap-3.5 lg:grid-cols-[1fr_23.25rem] lg:gap-5">
        <section className="kar flex flex-col gap-4 p-4 sm:p-6 sm:pb-5.5" aria-labelledby="new-request">
          <div className="kar-h px-0.5">
            <h2 id="new-request">{t('home.newRequest')}</h2>
          </div>
          <NewRequestLens tiles={d.types} onSelect={(k) => openSheet(TILE_SHEET[k])} />
        </section>

        <section className="kar flex flex-col p-4.5 sm:p-6 sm:pb-5.5" aria-labelledby="leave-ring">
          <div className="kar-h">
            <h2 id="leave-ring">{t('home.annualLeave', { year: d.leave.year })}</h2>
          </div>
          <LeaveRing leave={d.leave} />
          <div className="kar-note mt-auto" style={{ '--tint': d.leave.pendingDays > 0 ? 'var(--color-type-expense)' : 'var(--color-blue)' } as CSSProperties}>
            <span className="dot" aria-hidden="true" />
            <b className="text-[0.90625rem] leading-snug font-semibold text-ink">{d.leave.note}</b>
          </div>
        </section>
      </div>

      <HomeRequests requests={d.requests} statusLabel={d.statusLabel} />
      {(() => {
        const common = { onClose: closeSheet, onSubmitted: () => router.invalidate(), home: d }
        return (
          <>
            <LeaveSheet open={sheet === 'leave'} {...common} />
            <ExpenseSheet open={sheet === 'expense'} {...common} />
            <AdvanceSheet open={sheet === 'advance'} {...common} />
            <PurchaseSheet open={sheet === 'purchase'} {...common} />
            <TravelSheet open={sheet === 'travel'} {...common} />
          </>
        )
      })()}
    </div>
  )
}
