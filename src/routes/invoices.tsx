import { useEffect, useState } from 'react'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { DataList, type Column } from '#/components/DataList'
import { Icon } from '#/components/Icon'
import { InvoiceSheet } from '#/components/InvoiceSheet'
import { Segmented } from '#/components/Segmented'
import { ApprovalPill, BeforeBooksPill, TitleRow } from '#/components/InvoicePill'
import { dateLabel, kindLabel, listInvoices, settleInvoice, type Invoice } from '#/data/invoices'
import { guard } from '#/lib/guard'
import { isOverdue } from '#/lib/invoice'
import { formatMoney, isBaseCurrency } from '#/lib/money'
import { seesAllInvoices } from '#/lib/permissions'
import { useSheetState } from '#/lib/useSheetState'
import { t, tn } from '#/i18n'
import { formatNumber } from '#/i18n/format'

type Tab = 'in' | 'out'

export const Route = createFileRoute('/invoices')({
  validateSearch: (s: Record<string, unknown>): { new?: 1; tab?: Tab; focus?: string } => ({
    ...(s.new === 1 || s.new === '1' ? { new: 1 as const } : {}),
    ...(s.tab === 'in' || s.tab === 'out' ? { tab: s.tab } : {}),
    ...(typeof s.focus === 'string' ? { focus: s.focus } : {}),
  }),
  beforeLoad: guard('invoices'),
  loader: () => listInvoices(),
  component: Invoices,
})

const rootApi = getRouteApi('__root__')

function SettleBadge({ i, today }: { i: Invoice; today: string }) {
  const overdue = isOverdue(i.due, i.settledOn, today)
  const [text, dot] = i.settledOn ? [t('invoices.settle.collected'), 'bg-status-approved'] : overdue ? [t('invoices.settle.overdue'), 'bg-status-rejected'] : [t('invoices.settle.awaiting'), 'bg-status-pending']
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-micro font-medium">
      <span className={`size-1.75 rounded-full ${dot}`} />
      {text}
      {i.settledOn && <span className="font-normal text-faint"> · {dateLabel(i.settledOn)}</span>}
      {i.due && !i.settledOn && <span className="font-normal text-faint"> · {t('invoices.settle.dueOn', { date: dateLabel(i.due) })}</span>}
    </span>
  )
}

function SettleCell({ i, today, onChange }: { i: Invoice; today: string; onChange: (settledOn: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (value: string | null) => {
    setBusy(true)
    setError('')
    const r = await settleInvoice({ id: i.id, settledOn: value })
    setBusy(false)
    if (r.ok) {
      onChange(r.settledOn)
      setEditing(false)
    } else setError(r.error)
  }
  if (editing)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          aria-label={t('invoices.settle.dateLabel', { firm: i.firm })}
          className="input h-8! min-h-0! w-auto! px-2! py-0! text-micro"
          value={date}
          min={i.date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="button" disabled={busy || !date} onClick={() => void save(date)} className="btn-tint rounded-full px-3 py-1 text-micro">
          {t('invoices.sheet.save')}
        </button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)} className="px-1.5 py-1 text-micro text-faint hover:text-ink">
          {t('invoices.settle.cancel')}
        </button>
        {error && (
          <span role="alert" className="basis-full text-micro text-status-rejected">
            {error}
          </span>
        )}
      </span>
    )
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <SettleBadge i={i} today={today} />
      {i.settledOn ? (
        <button type="button" disabled={busy} onClick={() => void save(null)} className="text-micro text-faint underline-offset-2 hover:text-ink hover:underline">
          {t('invoices.settle.undo')}
        </button>
      ) : (
        <button type="button" onClick={() => { setDate(today); setEditing(true) }} className="btn-tint rounded-full px-2.5 py-0.5 text-micro">
          {t('invoices.settle.markCollected')}
        </button>
      )}
      {error && (
        <span role="alert" className="basis-full text-micro text-status-rejected">
          {error}
        </span>
      )}
    </span>
  )
}

function LinksCell({ i }: { i: Invoice }) {
  const toInv = i.items.some((x) => x.toInventory)
  if (i.links.length === 0) return toInv ? <span className="text-micro font-medium text-status-approved">{t('invoices.list.inInventory')}</span> : <span className="text-faint">—</span>
  const kinds = [...new Set(i.links.map((l) => kindLabel(l.kind)))].join(', ')
  return (
    <span className="block min-w-0" title={i.links.map((l) => `${kindLabel(l.kind)}: ${l.label}`).join('\n')}>
      <span className="block truncate text-link font-medium">
        {i.links[0].label}
        {i.links.length > 1 && <span className="text-muted"> +{i.links.length - 1}</span>}
      </span>
      <span className="block truncate text-micro text-faint">
        {kinds}
        {toInv && <span className="text-status-approved"> · {t('invoices.list.inInventory')}</span>}
      </span>
    </span>
  )
}

const rate = (n: number) => formatNumber(n, { maximumFractionDigits: 4 })

const base = (onEdit?: (i: Invoice) => void): Column<Invoice>[] => [
  {
    key: 'firm',
    header: t('invoices.sheet.firm'),
    primary: true,
    cell: (i) => (
      <>
        <b className="block text-row font-semibold">
          <TitleRow pills={<>{i.beforeBooks && <BeforeBooksPill direction={i.direction} />}<ApprovalPill status={i.approval} note={i.rejectNote} /></>}>{i.firm}</TitleRow>
        </b>
        <span className="num flex items-center gap-x-1.5 text-micro text-faint">
          <span className="min-w-0 truncate whitespace-nowrap" title={i.no}>
            {i.no}
          </span>
          {i.fileId && (
            <>
              <span aria-hidden="true">·</span>
              <a href={`/files/${i.fileId}`} target="_blank" rel="noopener" className="-my-1.5 inline-block shrink-0 py-1.5 text-muted underline-offset-2 hover:text-ink">
                {t('invoices.list.file')}
              </a>
            </>
          )}
          {onEdit && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" data-k={`edit-invoice-${i.id}`} onClick={() => onEdit(i)} className="-my-1.5 inline-block shrink-0 py-1.5 text-muted underline-offset-2 hover:text-ink hover:underline">
                {t('invoices.list.edit')}
              </button>
            </>
          )}
        </span>
      </>
    ),
  },
  { key: 'date', header: t('invoices.list.date'), cell: (i) => <span className="text-link">{dateLabel(i.date)}</span> },
  { key: 'net', header: t('invoices.sheet.netAmount'), right: true, cell: (i) => <span className="num text-link">{formatMoney(i.netOrig, i.currency)}</span> },
  { key: 'vat', header: t('invoices.sheet.vatShort'), right: true, cell: (i) => <span className="num text-link text-muted">{formatMoney(i.vatOrig, i.currency)}</span> },
  {
    key: 'total',
    header: t('invoices.linked.total'),
    right: true,
    cell: (i) =>
      isBaseCurrency(i.currency) ? (
        <span className="num text-link font-semibold">{formatMoney(i.total)}</span>
      ) : (
        <span className="block" title={t('invoices.list.rateTitle', { rate: i.fxRate ? rate(i.fxRate) : '' })}>
          <span className="num block text-link font-semibold">{formatMoney(i.totalOrig, i.currency)}</span>
          <span className="num block text-micro whitespace-nowrap text-faint">{formatMoney(i.total)}</span>
          {i.fxRate ? <span className="num block text-micro whitespace-nowrap text-faint">{t('invoices.list.rateShort', { rate: rate(i.fxRate) })}</span> : null}
        </span>
      ),
  },
]

function Invoices() {
  const session = rootApi.useRouteContext().session
  const { user } = session
  const initial = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [list, setList] = useState<Invoice[]>(initial)
  const [tab, setTab] = useState<Tab>(search.tab ?? 'in')
  const [flash, setFlash] = useState('')
  const all = seesAllInvoices(user)
  const sheet = useSheetState(search.new === 1, (open, replace) => void navigate({ search: (p) => ({ ...p, new: open ? (1 as const) : undefined }), replace }))

  const [editing, setEditing] = useState<Invoice | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const openEdit = (i: Invoice) => {
    setEditing(i)
    setEditOpen(true)
  }

  const mine = list.filter((i) => i.uploadedBy === user.id && i.direction === 'in')
  const shown = all ? list.filter((i) => i.direction === tab) : mine

  useEffect(() => {
    if (!search.focus) return
    const align = () => {
      const el = document.querySelector(`[data-id="${CSS.escape(search.focus!)}"]`)
      if (!el) return
      const r = el.getBoundingClientRect()
      if (Math.abs(r.top + r.height / 2 - window.innerHeight / 2) > 48) el.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
    const timers = [0, 120, 350, 800].map((ms) => window.setTimeout(() => requestAnimationFrame(align), ms))
    return () => timers.forEach(clearTimeout)
  }, [search.focus, tab])

  const columns: Column<Invoice>[] = all
    ? tab === 'out'
      ? [...base(openEdit), { key: 'settle', header: t('invoices.list.collection'), cell: (i) => <SettleCell i={i} today={session.todayISO} onChange={(settledOn) => setList((l) => l.map((x) => (x.id === i.id ? { ...x, settledOn } : x)))} /> }]
      : [...base(openEdit), { key: 'inv', header: t('invoices.list.links'), className: 'lg:pl-4', cell: (i) => <LinksCell i={i} /> }]
    : base().filter((c) => c.key !== 'vat' && c.key !== 'net')

  const template = all
    ? 'minmax(0,1.9fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,.9fr) minmax(0,1.3fr) minmax(0,1.9fr)'
    : 'minmax(0,2fr) minmax(0,1.2fr) minmax(0,1.2fr)'

  const onAdded = (inv: Invoice, assets: number) => {
    setList((l) => [inv, ...l])
    setTab(inv.direction)
    setFlash(assets > 0 ? tn('invoices.list.uploadedAssets', assets) : t('invoices.list.uploaded'))
  }

  const upload = (
    <button type="button" data-k="upload-invoice" onClick={sheet.openSheet} className="btn btn-pri">
      <Icon name="paper" size={16} strokeWidth={1.8} />
      {t('invoices.list.upload')}
    </button>
  )

  return (
    <section className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm font-semibold sm:text-display">{all ? t('invoices.list.title') : t('invoices.list.mine')}</h1>
          {all && <p className="mt-2.5 text-label text-muted">{t('invoices.list.vatNote')}</p>}
        </div>
        {(all || mine.length > 0) && upload}
      </div>

      {all && (
        <Segmented
          label={t('invoices.sheet.typeLabel')}
          className="mt-6 mb-4"
          value={tab}
          options={[
            { value: 'in', label: `${t('invoices.sheet.typeIn')} · ${list.filter((i) => i.direction === 'in').length}` },
            { value: 'out', label: `${t('invoices.sheet.typeOut')} · ${list.filter((i) => i.direction === 'out').length}` },
          ]}
          onChange={setTab}
        />
      )}

      {flash && (
        <p role="status" className="mt-4 mb-2 text-link font-medium text-status-approved">
          {flash}
        </p>
      )}

      <div className={all ? '' : 'mt-6'}>
        {!all && mine.length === 0 ? (
          <div className="glass flex flex-col items-start gap-4 p-8">
            <p className="text-label font-medium text-muted">{t('invoices.list.noneYet')}</p>
            {upload}
          </div>
        ) : (
          <DataList label={t('invoices.list.title')} rows={shown} columns={columns} template={template} rowKey={(i) => i.id} highlightKey={search.focus} empty={t('invoices.list.emptyType')} />
        )}
      </div>

      <InvoiceSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        edit={editing ?? undefined}
        onAdded={() => {}}
        onUpdated={(inv) => {
          setList((l) => l.map((x) => (x.id === inv.id ? inv : x)))
          setFlash(t('invoices.list.updated'))
        }}
        inOnly={false}
        returnKey={editing ? `edit-invoice-${editing.id}` : 'upload-invoice'}
      />

      <InvoiceSheet
        open={sheet.open}
        onClose={sheet.closeSheet}
        onAdded={onAdded}
        inOnly={!all}
        canLink={all}
        returnKey="upload-invoice"
      />
    </section>
  )
}
