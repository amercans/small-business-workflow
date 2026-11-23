import { Link } from '@tanstack/react-router'
import { Icon } from '../Icon'
import { useFlipRows } from '../useFlipRows'
import type { MyRequest, RequestStatus, RequestType, HomeData } from '#/data/home'
import { t } from '#/i18n'

const PILL: Record<RequestStatus, string> = { pending: 'wait', approved: 'ok', paid: 'paid', rejected: 'no', cancelled: 'off' }
const PILL_ICON: Record<RequestStatus, 'clock' | 'check' | 'x' | null> = { pending: 'clock', approved: 'check', paid: 'check', rejected: 'x', cancelled: null }
const DOT: Record<RequestType, string> = {
  leave: 'var(--color-type-leave)',
  expense: 'var(--color-type-expense)',
  purchase: 'var(--color-type-purchase)',
  travel: 'var(--color-type-travel)',
  advance: 'var(--color-type-advance)',
}

function PillIcon({ kind }: { kind: 'clock' | 'check' | 'x' }) {
  const d = kind === 'clock' ? 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2' : kind === 'check' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 7l10 10M17 7 7 17'
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={kind === 'clock' ? 2.6 : 3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function HomeRequests({ requests, statusLabel, limit = 6, full = false, emptyText, view = '' }: { requests: MyRequest[]; statusLabel: HomeData['statusLabel']; limit?: number; full?: boolean; emptyText?: string; view?: string }) {
  const shown = full ? requests : requests.slice(0, limit)
  const empty = emptyText ?? t('home.emptyRequests')
  const { ref, highlightId } = useFlipRows<HTMLDivElement>(shown, view)
  return (
    <section className={`kar px-3.5 sm:px-6 ${full ? 'rounded-3xl py-2 sm:py-2.5' : 'pt-4.5 pb-2 sm:pt-5 sm:pb-3.5'}`} aria-labelledby={full ? undefined : 'home-requests'} aria-label={full ? t('nav.mine') : undefined}>
      {!full && (
      <div className="kar-h mb-2 px-1.5 sm:px-0">
        <h2 id="home-requests">{t('nav.mine')}</h2>
        {requests.length > 0 && (
          <Link to="/requests">
            {t('home.all')} · <span className="num">{requests.length}</span>
            <Icon name="chev" size={14} strokeWidth={2} />
          </Link>
        )}
      </div>
      )}
      {shown.length === 0 ? (
        <p className="px-1.5 pt-2 pb-5 text-[0.9375rem] text-faint">{empty}</p>
      ) : (
        <div ref={ref} className="grid">
          {shown.map((r) => {
            const label = statusLabel[r.status]
            const icon = PILL_ICON[r.status]
            const hasAmount = r.amount && r.amount !== '—'
            return (
              <Link
                key={r.id}
                data-id={r.id}
                to="/requests/$id"
                params={{ id: r.id }}
                aria-label={t('home.openRow', { title: r.title, status: label })}
                className={`kar-row ${r.id === highlightId ? 'bg-[color-mix(in_srgb,var(--color-blue)_8%,transparent)]' : ''}`}
              >
                <span className="t">
                  <i className="k" style={{ background: DOT[r.type] }} />
                  <span className={r.status === 'cancelled' ? 'text-faint line-through' : ''}>{r.title}</span>
                </span>
                <span className="ty">{r.typeLabel}</span>
                <span className="d num">{r.date}</span>
                <span className="meta num">
                  {r.typeLabel} · {r.date}
                  {hasAmount && (
                    <>
                      {' · '}
                      <span className="whitespace-nowrap">{r.amount}</span>
                    </>
                  )}
                  {r.justNow ? ` · ${t('home.justNow')}` : ''}
                </span>
                <span className={`a num ${hasAmount ? '' : 'none'}`}>{hasAmount ? r.amount : '—'}</span>
                <span className={`kar-pill ${PILL[r.status]}`}>
                  {icon && <PillIcon kind={icon} />}
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
