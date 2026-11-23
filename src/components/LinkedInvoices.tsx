import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { ConfirmDialog } from './ConfirmDialog'
import { InvoiceSheet } from './InvoiceSheet'
import { BeforeBooksPill, TitleRow } from './InvoicePill'
import { isBeforeBooks } from '#/lib/invoice'
import { dateLabel, linkInvoice, listInvoices, unlinkInvoice, type Invoice, type LinkedInvoice, type LinkKind } from '#/data/invoices'
import { formatMoney, isBaseCurrency } from '#/lib/money'
import { seesAllInvoices } from '#/lib/permissions'
import { useSession } from '#/lib/useSession'
import { intlLocale, t } from '#/i18n'
import { formatDate, formatNumber } from '#/i18n/format'

const shortDay = (iso: string) => formatDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric' })
const rate = (n: number) => formatNumber(n, { maximumFractionDigits: 4 })

export function InvoiceAmount({ i }: { i: Pick<LinkedInvoice, 'totalTry' | 'currency' | 'totalOrig' | 'fxRate' | 'date'> }) {
  if (isBaseCurrency(i.currency) || i.totalOrig == null || i.fxRate == null) return <span className="num text-link font-semibold whitespace-nowrap max-sm:basis-full">{formatMoney(i.totalTry)}</span>
  return (
    <span className="block text-right max-sm:basis-full max-sm:text-left">
      <span className="num block text-link font-semibold whitespace-nowrap">{formatMoney(i.totalOrig, i.currency)}</span>
      <span className="num block text-micro whitespace-nowrap text-faint">
        {t('invoices.linked.converted', { amount: formatMoney(i.totalTry), rate: rate(i.fxRate), date: shortDay(i.date) })}
      </span>
    </span>
  )
}

export function LinkedInvoices({
  kind,
  targetId,
  targetLabel,
  invoices,
  onChanged,
  className = '',
}: {
  kind: LinkKind
  targetId: string
  targetLabel: string
  invoices: LinkedInvoice[]
  onChanged: () => void
  className?: string
}) {
  const canLink = seesAllInvoices(useSession().user)
  const [picking, setPicking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<LinkedInvoice | null>(null)
  const total = invoices.reduce((s, i) => s + i.totalTry, 0)

  const unlink = async (i: LinkedInvoice) => {
    setConfirm(null)
    setBusy(i.id)
    setError('')
    const r = await unlinkInvoice({ invoiceId: i.id, kind, id: targetId })
    setBusy('')
    if (r.ok) onChanged()
    else setError(r.error)
  }

  return (
    <section aria-label={t('invoices.linked.title')} className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-label font-semibold text-muted">{t('invoices.linked.title')}</h2>
        {canLink && (
          <button type="button" data-k={`link-invoice-${targetId}`} aria-expanded={picking} onClick={() => setPicking((p) => !p)} className="btn-tint rounded-full px-3.5 py-1.5 text-micro">
            {t('invoices.linked.link')}
          </button>
        )}
      </div>

      {picking && (
        <Picker
          linked={new Set(invoices.map((i) => i.id))}
          onPick={async (inv) => {
            setError('')
            const r = await linkInvoice({ invoiceId: inv.id, kind, id: targetId })
            if (!r.ok) return setError(r.error)
            setPicking(false)
            onChanged()
          }}
          onUpload={() => {
            setPicking(false)
            setUploading(true)
          }}
        />
      )}

      <ul className="m-0 list-none kar rounded-3xl px-5">
        {invoices.length === 0 && <li className="py-3.5 text-link text-faint">{t('invoices.linked.empty')}</li>}
        {invoices.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline py-3.5 first:border-0">
            <Link to="/invoices" search={{ tab: i.direction, focus: i.id }} className="min-w-40 flex-1 text-ink no-underline hover:underline">
              <b className="block text-row font-medium">
                <TitleRow pills={isBeforeBooks(i.date) && <BeforeBooksPill direction={i.direction} />}>{i.counterparty}</TitleRow>
              </b>
              <span className="num block truncate text-micro text-faint">
                {dateLabel(i.date)} · {i.no}
              </span>
            </Link>
            <InvoiceAmount i={i} />
            <span className="flex items-center gap-3 max-sm:basis-full max-sm:justify-end">
              {i.fileUrl && (
                <a href={i.fileUrl} target="_blank" rel="noopener" aria-label={`${i.counterparty} ${i.no} PDF`} className="btn-tint rounded-full px-3 py-1 text-micro no-underline">
                  PDF
                </a>
              )}
              {canLink && (
                <button type="button" disabled={busy === i.id} onClick={() => setConfirm(i)} className="text-micro text-faint underline-offset-2 hover:text-ink hover:underline">
                  {t('invoices.linked.unlink')}
                </button>
              )}
            </span>
          </li>
        ))}
        {invoices.length > 0 && (
          <li className="flex items-baseline justify-between gap-4 border-t border-hairline py-3.5">
            <b className="text-row font-semibold">{t('invoices.linked.total')}</b>
            <span className="num text-row font-semibold">
              {formatMoney(total)} <span className="text-micro font-normal text-faint">{t('invoices.linked.inclVat')}</span>
            </span>
          </li>
        )}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-micro text-status-rejected">
          {error}
        </p>
      )}

      {confirm &&
        createPortal(
          <div onSubmit={(e) => e.stopPropagation()}>
            <ConfirmDialog
              open
              title={t('invoices.linked.confirmTitle')}
              body={t('invoices.linked.confirmBody', { firm: confirm.counterparty, no: confirm.no, target: targetLabel })}
              confirmLabel={t('invoices.linked.unlink')}
              onConfirm={() => void unlink(confirm)}
              onCancel={() => setConfirm(null)}
              danger
            />
          </div>,
          document.body,
        )}

      {uploading &&
        createPortal(
          <div onSubmit={(e) => e.stopPropagation()}>
            <InvoiceSheet
              open
              inOnly
              canLink
              preset={{ kind, id: targetId, label: targetLabel, sub: '' }}
              returnKey={`link-invoice-${targetId}`}
              onClose={() => setUploading(false)}
              onAdded={() => {
                setUploading(false)
                onChanged()
              }}
            />
          </div>,
          document.body,
        )}
    </section>
  )
}

function Picker({ linked, onPick, onUpload }: { linked: Set<string>; onPick: (i: Invoice) => void; onUpload: () => void }) {
  const [all, setAll] = useState<Invoice[] | null>(null)
  const [q, setQ] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    listInvoices()
      .then((l) => live && setAll(l.filter((i) => i.direction === 'in')))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])
  const rows = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(intlLocale())
    return (all ?? [])
      .filter((i) => !linked.has(i.id))
      .filter((i) => !term || [i.firm, i.no, i.date, dateLabel(i.date), shortDay(i.date)].join(' ').toLocaleLowerCase(intlLocale()).includes(term))
      .slice(0, 30)
  }, [all, q, linked])
  return (
    <div className="mb-3 kar rounded-3xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          data-autofocus
          aria-label={t('invoices.linked.search')}
          placeholder={t('invoices.linked.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          className="input min-w-0 flex-1"
        />
        <button type="button" onClick={onUpload} className="btn btn-sec shrink-0">
          {t('invoices.linked.upload')}
        </button>
      </div>
      <ul className="m-0 mt-3 max-h-64 list-none overflow-y-auto p-0" aria-label={t('invoices.linked.incoming')}>
        {failed && <li className="py-2 text-link text-status-rejected">{t('invoices.linked.failed')}</li>}
        {!failed && all === null && <li className="py-2 text-link text-faint">{t('invoices.history.loading')}</li>}
        {all && rows.length === 0 && <li className="py-2 text-link text-faint">{q ? t('invoices.linked.noMatch') : t('invoices.linked.noneAvailable')}</li>}
        {rows.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onPick(i)} className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-0.5 rounded-xl px-2.5 py-2.5 text-left hover:bg-wash">
              <span className="min-w-0">
                <b className="block truncate text-link font-medium">{i.firm}</b>
                <span className="num text-micro text-faint">
                  {dateLabel(i.date)} · {i.no}
                </span>
              </span>
              <span className="num text-link text-muted">{isBaseCurrency(i.currency) ? formatMoney(i.total) : formatMoney(i.totalOrig, i.currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
