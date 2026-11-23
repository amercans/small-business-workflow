import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import { Icon } from '../Icon'
import type { RequestType, TypeTile } from '#/data/home'
import { t } from '#/i18n'

const ORDER: RequestType[] = ['leave', 'expense', 'purchase', 'travel', 'advance']
const MAX_TILT = 5
const sub = (k: RequestType) => t(`home.tiles.${k}`)

function tilt(e: PointerEvent<HTMLButtonElement>) {
  if (e.pointerType !== 'mouse') return
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  el.style.setProperty('--ry', `${((x - 0.5) * MAX_TILT * 2).toFixed(2)}deg`)
  el.style.setProperty('--rx', `${((0.5 - y) * MAX_TILT * 2).toFixed(2)}deg`)
  el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
  el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
}
function untilt(e: PointerEvent<HTMLButtonElement>) {
  for (const p of ['--rx', '--ry', '--mx', '--my']) e.currentTarget.style.removeProperty(p)
}

const tint = (pct: number): CSSProperties => ({ fill: `color-mix(in srgb, var(--tint) ${pct}%, transparent)` })
const solid: CSSProperties = { fill: 'var(--tint)' }
const edge = { stroke: 'color-mix(in srgb, var(--color-kar-shade) 12%, transparent)', strokeWidth: 1.2 }
const ink = (pct: number): CSSProperties => ({ stroke: `color-mix(in srgb, var(--color-ink) ${pct}%, transparent)`, strokeLinecap: 'round', fill: 'none' })

function Paper({ id, children }: { id: string; children: ReactNode }) {
  return (
    <svg className="kar-deco" viewBox="0 0 200 240" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-surface)' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--tint) 9%, var(--color-surface))' }} />
        </linearGradient>
      </defs>
      {children}
    </svg>
  )
}
const paperFill = (id: string): CSSProperties => ({ fill: `url(#${id})`, ...edge })

function CalendarDeco() {
  const cells = []
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 5; col++) {
      const picked = (row === 1 && col >= 1) || (row === 2 && col === 0)
      cells.push(<rect key={`${row}-${col}`} x={30 + col * 30} y={96 + row * 32} width={22} height={22} rx={6} style={picked ? solid : { fill: 'color-mix(in srgb, var(--color-ink) 9%, transparent)' }} />)
    }
  return (
    <Paper id="kar-p-leave">
      <rect x="14" y="20" width="172" height="212" rx="20" style={paperFill('kar-p-leave')} />
      <path d="M14 40a20 20 0 0 1 20-20h132a20 20 0 0 1 20 20v34H14z" style={solid} />
      <line x1="62" y1="10" x2="62" y2="32" strokeWidth={5} style={ink(45)} />
      <line x1="138" y1="10" x2="138" y2="32" strokeWidth={5} style={ink(45)} />
      {cells}
    </Paper>
  )
}

function ReceiptDeco() {
  return (
    <Paper id="kar-p-expense">
      <path d="M28 12h144v214l-18-12-18 12-18-12-18 12-18-12-18 12-18-12-18 12z" style={paperFill('kar-p-expense')} />
      <line x1="56" y1="50" x2="118" y2="50" strokeWidth={7} style={ink(45)} />
      {[84, 108, 132, 156].map((y, i) => (
        <g key={y}>
          <line x1="56" y1={y} x2={[120, 104, 128, 96][i]} y2={y} strokeWidth={5} style={ink(16)} />
          <line x1="138" y1={y} x2="148" y2={y} strokeWidth={5} style={ink(22)} />
        </g>
      ))}
      <line x1="56" y1="186" x2="148" y2="186" strokeWidth={7} strokeLinecap="round" style={{ stroke: 'var(--tint)' }} />
    </Paper>
  )
}

function BagDeco() {
  return (
    <Paper id="kar-p-purchase">
      <path d="M70 76V58a30 30 0 0 1 60 0v18" strokeWidth={7} style={ink(40)} />
      <path d="M34 72h132l-10 150a12 12 0 0 1-12 11H56a12 12 0 0 1-12-11z" style={paperFill('kar-p-purchase')} />
      <path d="M38.6 112h122.8l-1.6 24H40.2z" style={tint(85)} />
      <circle cx="70" cy="90" r="5" style={tint(55)} />
      <circle cx="130" cy="90" r="5" style={tint(55)} />
      <rect x="72" y="160" width="56" height="36" rx="8" style={{ fill: 'var(--color-surface)', ...edge }} />
      <line x1="84" y1="174" x2="116" y2="174" strokeWidth={4} style={ink(30)} />
      <line x1="84" y1="184" x2="104" y2="184" strokeWidth={4} style={ink(16)} />
    </Paper>
  )
}

function PassDeco() {
  return (
    <Paper id="kar-p-travel">
      <path d="M38 14h124a14 14 0 0 1 14 14v138a10 10 0 0 0 0 20v26a14 14 0 0 1-14 14H38a14 14 0 0 1-14-14v-26a10 10 0 0 0 0-20V28a14 14 0 0 1 14-14z" style={paperFill('kar-p-travel')} />
      <path d="M24 28a14 14 0 0 1 14-14h124a14 14 0 0 1 14 14v26H24z" style={solid} />
      <line x1="44" y1="92" x2="72" y2="92" strokeWidth={9} style={ink(50)} />
      <line x1="128" y1="92" x2="156" y2="92" strokeWidth={9} style={ink(50)} />
      <path d="M88 92h24m-6-7 7 7-7 7" strokeWidth={4} strokeLinejoin="round" style={{ stroke: 'var(--tint)', strokeLinecap: 'round', fill: 'none' }} />
      <line x1="44" y1="122" x2="96" y2="122" strokeWidth={5} style={ink(16)} />
      <line x1="44" y1="142" x2="80" y2="142" strokeWidth={5} style={ink(16)} />
      <line x1="34" y1="176" x2="166" y2="176" strokeWidth={2.5} strokeDasharray="6 7" style={ink(22)} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
        <rect key={n} x={50 + n * 8} y="196" width={n % 3 ? 3 : 5} height="24" rx="1" style={{ fill: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }} />
      ))}
    </Paper>
  )
}

function CardDeco() {
  return (
    <Paper id="kar-p-advance">
      <rect x="10" y="70" width="180" height="116" rx="16" style={paperFill('kar-p-advance')} />
      <path d="M118 70h56a16 16 0 0 1 16 16v44z" style={tint(70)} />
      <rect x="28" y="96" width="34" height="26" rx="6" style={{ fill: 'color-mix(in srgb, var(--color-type-expense) 45%, var(--color-surface))' }} />
      <line x1="28" y1="148" x2="132" y2="148" strokeWidth={6} strokeDasharray="20 8" style={ink(30)} />
      <line x1="28" y1="166" x2="70" y2="166" strokeWidth={5} style={ink(16)} />
    </Paper>
  )
}

const DECO: Record<RequestType, () => ReactNode> = { leave: CalendarDeco, expense: ReceiptDeco, purchase: BagDeco, travel: PassDeco, advance: CardDeco }

export function NewRequestLens({ tiles, onSelect }: { tiles: TypeTile[]; onSelect: (key: RequestType) => void }) {
  const byKey = new Map(tiles.map((t) => [t.key, t]))
  return (
    <div className="kar-lens">
      {ORDER.map((key) => {
        const tile = byKey.get(key)
        if (!tile) return null
        return (
          <button key={key} type="button" data-k={key} className={`kar-obj kar-o-${key}`} onClick={() => onSelect(key)} onPointerMove={tilt} onPointerLeave={untilt}>
            <span className="kar-ic" aria-hidden="true">
              <Icon name={key} size={key === 'leave' ? 32 : 22} strokeWidth={1.9} />
            </span>
            {DECO[key]()}
            <span className="relative block min-w-0">
              <span className="ttl">{sub(key)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
