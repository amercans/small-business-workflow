import { useState } from 'react'
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { Avatar } from '#/components/Avatar'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { Field, fieldA11y } from '#/components/Field'
import { Icon } from '#/components/Icon'
import { RequestSheet, SheetAside, SheetLayout } from '#/components/RequestSheet'
import { Select } from '#/components/Select'
import { SummaryCard } from '#/components/SummaryCard'
import { assignAsset, assignSchema, loadPerson, setSeat } from '#/data/inventory'
import { OfficeDialog } from '#/components/AssetSheets'
import { dateLabel } from '#/data/invoices'
import { guard } from '#/lib/guard'
import { formatMoney } from '#/lib/money'
import { roleLabel } from '#/lib/permissions'
import { useSession } from '#/lib/useSession'
import { useSubmit } from '#/lib/useSubmit'
import { STATUS_LABEL } from '#/data/inventory'
import { t, tn } from '#/i18n'

export const Route = createFileRoute('/inventory/people/$userId')({
  beforeLoad: guard('inventory'),
  loader: async ({ params }) => {
    const p = await loadPerson(params.userId)
    if (!p) throw notFound()
    return p
  },
  notFoundComponent: () => (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('inventory.people.notFound')}</h1>
      <Link to="/inventory" search={{ tab: 'people' }} className="btn btn-sec mt-6 no-underline">
        {t('inventory.detail.back')}
      </Link>
    </section>
  ),
  component: Person,
})

type Data = NonNullable<Awaited<ReturnType<typeof loadPerson>>>

function Person() {
  const d = Route.useLoaderData()
  const router = useRouter()
  const refresh = () => void router.invalidate()
  const [assigning, setAssigning] = useState(false)
  const [returning, setReturning] = useState<Data['holding'][number] | null>(null)
  const [removing, setRemoving] = useState<Data['seats'][number] | null>(null)
  const [seatPick, setSeatPick] = useState('')
  const [seatError, setSeatError] = useState('')
  const p = d.person

  const addSeat = async () => {
    if (!seatPick) return
    const r = await setSeat({ assetId: seatPick, userId: p.id, on: true })
    if (!r.ok) return setSeatError(r.error ?? t('inventory.people.addFailed'))
    setSeatPick('')
    setSeatError('')
    refresh()
  }

  return (
    <article className="flex flex-col gap-5 pb-10">
      <div>
        <Link to="/inventory" search={{ tab: 'people' }} className="-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink">
          <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
          {t('inventory.list.people')}
        </Link>
        <div className="mt-4 flex items-center gap-4">
          <Avatar name={p.displayName} hue={0} className="size-14 text-[1.125rem]" />
          <div>
            <h1 className="text-sheet-title font-semibold sm:text-display-sm">{p.displayName}</h1>
            <p className="mt-1 text-label text-muted">
              {roleLabel(p.role)}
              {!p.canLogin && ` · ${t('inventory.people.noLogin')}`}
              {!p.active && ` · ${t('inventory.people.inactive')}`}
            </p>
          </div>
        </div>
      </div>

      <section className="kar px-5 py-5 sm:px-6.5 sm:py-6" aria-labelledby="p-phys">
        <div className="kar-h">
          <h2 id="p-phys">{t('inventory.people.holding')} · {d.holding.length}</h2>
          {p.active && (
            <button type="button" data-k="person-assign" onClick={() => setAssigning(true)} className="btn-tint rounded-full px-3.5 py-1.5 text-micro" disabled={d.stock.length === 0}>
              {t('inventory.people.assign')}
            </button>
          )}
        </div>
        {d.holding.length === 0 ? (
          <p className="pt-3 text-link text-faint">{t('inventory.people.noHolding')}</p>
        ) : (
          <ul className="m-0 mt-2 list-none p-0">
            {d.holding.map((a) => {
              const since = a.history.find((h) => h.to === null)?.from
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 border-t border-kar-line-2 py-3 first:border-0">
                  <Link to="/inventory/$id" params={{ id: a.id }} className="min-w-0 text-ink no-underline hover:underline">
                    <b className="block text-row font-semibold">
                      {a.name}
                      {a.quantity > 1 && <span className="num ml-1.5 font-normal text-muted">× {a.quantity}</span>}
                    </b>
                    <span className="text-micro text-faint">{[a.category, a.serial, since ? t('inventory.people.since', { date: dateLabel(since) }) : ''].filter(Boolean).join(' · ')}</span>
                  </Link>
                  <button type="button" onClick={() => setReturning(a)} className="shrink-0 rounded-full bg-wash px-3.5 py-1.5 text-micro font-semibold text-ink">
                    {STATUS_LABEL.stock}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="kar px-5 py-5 sm:px-6.5 sm:py-6" aria-labelledby="p-dig">
        <div className="kar-h">
          <h2 id="p-dig">{t('inventory.people.software')} · {d.seats.length}</h2>
          {d.seatTotal.monthly > 0 && (
            <span className="num text-link text-muted">
              {t('inventory.people.monthlyPerPerson')}: <b className="font-semibold text-ink">{formatMoney(d.seatTotal.monthly)}</b>
              {d.seatTotal.missingFx > 0 && <span className="text-status-rejected"> · {tn('inventory.people.missingFx', d.seatTotal.missingFx)}</span>}
            </span>
          )}
        </div>
        {d.seats.length === 0 ? (
          <p className="pt-3 text-link text-faint">{t('inventory.people.noSeats')}</p>
        ) : (
          <ul className="m-0 mt-2 list-none p-0">
            {d.seats.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 border-t border-kar-line-2 py-3 first:border-0">
                <span className="min-w-0">
                  <b className="block text-row font-semibold">
                    {s.name}
                    {s.status === 'cancelled' && <span className="kar-pill no ml-2 align-[1px] text-tab">{t('digital.status.cancelled')}</span>}
                  </b>
                  {s.monthlyShare != null && (
                    <span className="num block text-micro text-muted">
                      {t('inventory.people.monthlyPerPerson')} <b className="font-semibold text-ink">{formatMoney(s.monthlyShare)}</b>
                    </span>
                  )}
                </span>
                <button type="button" onClick={() => setRemoving(s)} className="shrink-0 rounded-full bg-wash px-3.5 py-1.5 text-micro font-semibold text-ink">
                  {t('inventory.people.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {p.active && d.openSeats.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-2.5 border-t border-kar-line-2 pt-4">
            <Field id="seat-pick" label={t('inventory.people.addSeat')} className="min-w-56 flex-1" error={seatError}>
              <Select {...fieldA11y('seat-pick', seatError)} value={seatPick} onChange={(e) => { setSeatPick(e.target.value); setSeatError('') }}>
                <option value="">{t('inventory.people.pickSeat')}</option>
                {d.openSeats.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.plan ? ` · ${o.plan}` : ''}
                    {o.free ? ` · ${tn('inventory.people.freeSeats', o.free)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <button type="button" onClick={addSeat} disabled={!seatPick} className="btn btn-pri">
              {t('inventory.people.add')}
            </button>
          </div>
        )}
        {d.owned.length > 0 && (
          <p className="mt-4 text-link text-muted">
            {t('inventory.people.owned')}: <span className="text-ink">{d.owned.map((o) => o.name).join(', ')}</span>
          </p>
        )}
      </section>

      {d.past.length > 0 && (
        <section className="kar px-5 py-5 sm:px-6.5 sm:py-6" aria-labelledby="p-past">
          <div className="kar-h">
            <h2 id="p-past">{t('inventory.people.past')}</h2>
          </div>
          <ul className="m-0 mt-2 list-none p-0">
            {d.past.map((h) => (
              <li key={`${h.assetId}-${h.from}`} className="flex items-center justify-between gap-3 border-t border-kar-line-2 py-2.5 text-link first:border-0">
                <Link to="/inventory/$id" params={{ id: h.assetId }} className="min-w-0 truncate text-ink no-underline hover:underline">
                  {h.name}
                </Link>
                <span className="num shrink-0 text-faint">
                  {dateLabel(h.from)} – {dateLabel(h.to)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PersonAssignSheet open={assigning} person={p} stock={d.stock} onClose={() => setAssigning(false)} onDone={refresh} />
      <OfficeDialog asset={returning ? { id: returning.id, name: returning.name, holder: p.displayName, officeOn: '' } : null} onClose={() => setReturning(null)} onDone={refresh} />
      <ConfirmDialog
        open={!!removing}
        title={t('inventory.people.removeTitle')}
        body={removing ? t('inventory.people.removeBody', { person: p.displayName, name: removing.name }) : ''}
        confirmLabel={t('inventory.people.remove')}
        onConfirm={async () => {
          if (removing) await setSeat({ assetId: removing.id, userId: p.id, on: false })
          setRemoving(null)
          refresh()
        }}
        onCancel={() => setRemoving(null)}
      />
    </article>
  )
}

function PersonAssignSheet({ open, person, stock, onClose, onDone }: { open: boolean; person: Data['person']; stock: Data['stock']; onClose: () => void; onDone: () => void }) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="person-assign">
      {open && <PersonAssignForm person={person} stock={stock} onClose={onClose} onDone={onDone} />}
    </RequestSheet>
  )
}

function PersonAssignForm({ person, stock, onClose, onDone }: { person: Data['person']; stock: Data['stock']; onClose: () => void; onDone: () => void }) {
  const TODAY = useSession().todayISO
  const [assetId, setAssetId] = useState('')
  const [date, setDate] = useState(TODAY)
  const [note, setNote] = useState('')
  const { errors, warning, busy, run, clear } = useSubmit({
    schema: assignSchema,
    submit: assignAsset,
    onClose,
    onSubmitted: () => onDone(),
    build: () => ({ assetId: assetId || undefined, userId: person.id, date: date || undefined, note: note || undefined }),
  })
  const picked = stock.find((s) => s.id === assetId)
  return (
    <SheetLayout
      title={t('inventory.people.assign')}
      subtitle={person.displayName}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      submitLabel={t('assets.assign.title')}
      summary={
        <SummaryCard
          tone="leave"
          kicker={t('assets.assign.kicker')}
          headline={person.displayName}
          big={picked ? picked.name : t('inventory.people.pickEquipment')}
          rows={[...(picked?.serial ? [{ label: t('assets.serial'), value: picked.serial }] : []), ...(date ? [{ label: t('assets.handoverDate'), value: dateLabel(date) }] : [])]}
        />
      }
      aside={<SheetAside onay={t('inventory.people.assignAside')} warning={warning} />}
    >
      <Field id="pa-asset" label={t('inventory.people.equipmentInOffice')} error={errors.assetId} className="mt-5">
        <Select {...fieldA11y('pa-asset', errors.assetId)} value={assetId} onChange={(e) => { setAssetId(e.target.value); clear('assetId') }}>
          <option value="">{t('assets.choose')}</option>
          {stock.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.quantity > 1 ? ` × ${s.quantity}` : ''}
              {s.serial ? ` · ${s.serial}` : s.category ? ` · ${s.category}` : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="pa-date" label={t('assets.handoverDate')} error={errors.date} className="mt-5.5">
        <input {...fieldA11y('pa-date', errors.date)} type="date" max={TODAY} value={date} onChange={(e) => { setDate(e.target.value); clear('date') }} className="input" />
      </Field>
      <Field id="pa-note" label={t('assets.note')} optional className="mt-5.5">
        <textarea id="pa-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
      </Field>
    </SheetLayout>
  )
}
