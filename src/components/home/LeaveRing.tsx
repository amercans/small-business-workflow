import { useEffect, useState, type CSSProperties } from 'react'
import type { HomeData } from '#/data/home'
import { formatLeaveDays, WORKDAY_HOURS } from '#/lib/leave'
import { t, tn } from '#/i18n'
import { formatNumber } from '#/i18n/format'

const split = (d: number) => {
  const half = Math.round(d * WORKDAY_HOURS * 2)
  const whole = Math.floor(half / (WORKDAY_HOURS * 2))
  return { whole, hours: (half - whole * WORKDAY_HOURS * 2) / 2 }
}

const SIZE = 236
const R = 100
const GAP_DEG = 5.2
const MAX_SEGMENTS = 30

function arc(a0: number, a1: number) {
  const c = SIZE / 2
  const p = (a: number) => {
    const t = (a * Math.PI) / 180
    return `${(c + R * Math.cos(t)).toFixed(2)} ${(c + R * Math.sin(t)).toFixed(2)}`
  }
  return `M${p(a0)} A${R} ${R} 0 0 1 ${p(a1)}`
}

export function LeaveRing({ leave }: { leave: HomeData['leave'] }) {
  const total = leave.total ?? 0
  const pending = Math.max(0, Math.min(leave.pendingDays, leave.left))
  const remaining = Math.max(0, leave.left - pending)
  const used = Math.max(0, total - leave.left)
  const net = leave.left - leave.pendingDays
  const overdrawn = net < 0 ? -net : 0
  const n = Math.min(total, MAX_SEGMENTS)
  const scale = total > 0 ? n / total : 0
  const onN = Math.floor(remaining * scale)
  const nowN = Math.min(n - onN, Math.ceil(pending * scale))
  const rem = split(remaining)
  const over = split(overdrawn)
  const extra = (h: number) => (h ? ` ${tn('home.ring.hours', h, { n: formatNumber(h) })}` : '')
  const seg = n > 0 ? 360 / n : 0

  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || rem.whole === 0) return setShown(rem.whole)
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900)
      setShown(Math.round(rem.whole * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [rem.whole])

  const label =
    leave.total == null
      ? t('home.ring.noEntitlement')
      : pending
        ? t('home.ring.labelPending', { total, left: formatLeaveDays(remaining), pending: formatLeaveDays(pending) })
        : t('home.ring.label', { total, left: formatLeaveDays(remaining) })

  return (
    <>
      <div className="kar-ring" role="img" aria-label={label}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {n === 0 ? (
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="seg empty" />
          ) : (
            Array.from({ length: n }, (_, i) => (
              <g key={i} className="seg-in" style={{ '--i': i } as CSSProperties}>
                <path d={arc(-90 + i * seg + GAP_DEG / 2, -90 + (i + 1) * seg - GAP_DEG / 2)} className={`seg${i < onN ? ' on' : i < onN + nowN ? ' now' : ''}`} />
              </g>
            ))
          )}
        </svg>
        <div className="relative text-center">
          <div className="kar-ring-n num text-[4.125rem] leading-none font-semibold tracking-[-0.045em]">{leave.total == null ? '—' : overdrawn ? `−${over.whole}` : shown}</div>
          <div className="mt-1 text-[0.875rem] text-muted">{overdrawn ? t('home.ring.overdrawn', { extra: extra(over.hours) }) : pending ? t('home.ring.willRemain', { extra: extra(rem.hours) }) : t('home.ring.remaining', { extra: extra(rem.hours) })}</div>
        </div>
      </div>
      {leave.total != null && (
        <div className="kar-legend">
          <span>
            <i style={{ background: 'var(--color-leave-left)' }} />
            {t('home.ring.left')} <span className="num">{formatLeaveDays(remaining)}</span>
          </span>
          {pending > 0 && (
            <span>
              <i style={{ background: 'var(--color-type-expense)' }} />
              {t('home.ring.pending')} <span className="num">{formatLeaveDays(pending)}</span>
            </span>
          )}
          <span>
            <i style={{ background: 'var(--color-leave-used)' }} />
            {t('home.ring.used')} <span className="num">{formatLeaveDays(used)}</span>
          </span>
        </div>
      )}
    </>
  )
}
