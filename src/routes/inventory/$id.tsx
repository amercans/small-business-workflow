import { useState } from 'react'
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { AssetEditSheet, AssignSheet, OfficeDialog } from '#/components/AssetSheets'
import { Icon } from '#/components/Icon'
import { LinkedInvoices } from '#/components/LinkedInvoices'
import { loadAsset, STATUS_LABEL, statusOf } from '#/data/inventory'
import { dateLabel } from '#/data/invoices'
import { guard } from '#/lib/guard'
import { stampLabelClient } from '#/lib/stamp'
import { StatusPill } from '#/components/AssetStatus'
import { t } from '#/i18n'

export const Route = createFileRoute('/inventory/$id')({
  beforeLoad: guard('inventory'),
  loader: async ({ params }) => {
    const { asset, users } = await loadAsset(params.id)
    if (!asset) throw notFound()
    return { a: asset, users }
  },
  notFoundComponent: () => (
    <section className="pb-10">
      <h1 className="text-display-sm font-semibold sm:text-display">{t('inventory.detail.notFound')}</h1>
      <Link to="/inventory" className="btn btn-sec mt-6 no-underline">
        {t('inventory.detail.back')}
      </Link>
    </section>
  ),
  component: Detail,
})

function Detail() {
  const { a, users } = Route.useLoaderData()
  const router = useRouter()
  const [assigning, setAssigning] = useState(false)
  const [office, setOffice] = useState(false)
  const [editing, setEditing] = useState(false)
  const s = statusOf(a)
  const inv = a.invoice
  const open = a.history.find((h) => h.to === null)
  const past = a.history.filter((h) => h.to !== null).reverse()

  const rows: [string, React.ReactNode][] = [
    [t('inventory.list.status'), <StatusPill key="s" s={s} />],
    [
      t('inventory.list.holder'),
      open ? (
        <Link key="h" to="/inventory/people/$userId" params={{ userId: open.userId }} className="underline-offset-2 hover:underline">
          {a.holderName}
        </Link>
      ) : (
        (s === 'stock' ? a.officeHolder : a.holderName) || '—'
      ),
    ],
    ...(open?.disputedAt
      ? [
          [
            t('inventory.detail.report'),
            <div key="d">
              <span className="kar-pill no">{t('inventory.disputed')}</span>
              <span className="ml-2 text-link text-muted">{stampLabelClient(open.disputedAt)}</span>
              <p className="mt-2 text-label break-words">{open.disputeNote ? `“${open.disputeNote}”` : <span className="text-faint">{t('inventory.detail.noNote')}</span>}</p>
            </div>,
          ] as [string, React.ReactNode],
        ]
      : []),
    [t('inventory.list.since'), open ? dateLabel(open.from) : a.holderOther && a.holderOtherOn ? dateLabel(a.holderOtherOn) : a.officeOn ? dateLabel(a.officeOn) : '—'],
    ...(a.category ? [[t('assets.category'), a.category] as [string, React.ReactNode]] : []),
    ...(a.quantity > 1 ? [[t('assets.quantity'), <span key="q" className="num">{a.quantity}</span>] as [string, React.ReactNode]] : []),
    [t('assets.serial'), a.serial || '—'],
    [t('assets.acquired'), a.acquiredOn ? dateLabel(a.acquiredOn) : '—'],
    [
      t('inventory.list.source'),
      inv ? (
        <Link key="k" to="/invoices" search={{ tab: 'in', focus: inv.id }} className="underline-offset-2 hover:underline">
          {inv.firm} · {inv.no}
        </Link>
      ) : (
        a.source || t('inventory.manual')
      ),
    ],
    [t('assets.note'), a.note || '—'],
  ]

  return (
    <article className="max-w-3xl pb-10">
      <Link to="/inventory" className="-my-2 inline-flex items-center gap-1.5 py-2 text-link font-medium text-muted no-underline hover:text-ink">
        <Icon name="chev" size={14} strokeWidth={2} className="rotate-180" />
        {t('inventory.title')}
      </Link>
      <h1 className="mt-4 text-sheet-title font-semibold sm:text-display-sm">{a.name}</h1>

      <dl className="m-0 mt-7 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 kar rounded-3xl p-5 text-label ">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <button type="button" data-k="edit-asset" onClick={() => setEditing(true)} className="btn btn-sec">
          {t('inventory.detail.edit')}
        </button>
        {s === 'stock' && (
          <button type="button" data-k={`assign-${a.id}`} onClick={() => setAssigning(true)} className="btn btn-pri">
            {t('assets.assign.title')}
          </button>
        )}
        <button type="button" onClick={() => setOffice(true)} className="btn btn-sec">
          {STATUS_LABEL.stock}
        </button>
      </div>

      <h2 className="mt-8 mb-3 text-label font-semibold text-muted">{t('inventory.detail.history')}</h2>
      <ul className="m-0 list-none kar rounded-3xl px-5 ">
        {open && (
          <li className="flex items-baseline justify-between gap-4 border-t border-hairline py-3.5 first:border-0">
            <span className="min-w-0">
              <b className="block text-row font-medium">{open.userName}</b>
              {open.note && <span className="block text-micro break-words text-faint">{t('inventory.notePrefix', { note: open.note })}</span>}
            </span>
            <span className="shrink-0 text-link text-muted">{dateLabel(open.from)} – {t('inventory.detail.now')}</span>
          </li>
        )}
        {past.map((h, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 border-t border-hairline py-3.5 first:border-0">
            <span className="min-w-0">
              <b className="block text-row font-medium">{h.userName}</b>
              {h.note && <span className="block text-micro break-words text-faint">{t('inventory.notePrefix', { note: h.note })}</span>}
            </span>
            <span className="shrink-0 text-right text-link text-muted">
              {dateLabel(h.from)} – {dateLabel(h.to as string)}
            </span>
          </li>
        ))}
        {!open && past.length === 0 && <li className="py-3.5 text-link text-faint">{t('inventory.detail.noHistory')}</li>}
      </ul>

      {a.invoices && <LinkedInvoices className="mt-8" kind="asset" targetId={a.id} targetLabel={a.name} invoices={a.invoices} onChanged={() => void router.invalidate()} />}

      <AssetEditSheet asset={editing ? a : null} onClose={() => setEditing(false)} onSaved={() => void router.invalidate()} />
      <AssignSheet asset={assigning ? a : null} users={users} onClose={() => setAssigning(false)} onDone={() => void router.invalidate()} />
      <OfficeDialog asset={office ? { id: a.id, name: a.name, holder: s === 'assigned' ? a.holderName : null, officeOn: a.officeOn } : null} onClose={() => setOffice(false)} onDone={() => void router.invalidate()} />
    </article>
  )
}
