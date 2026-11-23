import { useEffect, useRef, useState } from 'react'
import { Field, fieldA11y } from './Field'
import { FileField } from './FileField'
import { Icon } from './Icon'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Segmented } from './Segmented'
import { SummaryCard } from './SummaryCard'
import { Switch } from './Switch'
import { dateLabel, invoiceEditSchema, invoiceSchema, kindLabel, loadInvoiceHistory, loadLinkTargets, submitInvoice, updateInvoice, type Invoice, type InvoiceHistory, type LinkTarget } from '#/data/invoices'
import { useSession } from '#/lib/useSession'
import { configuredVatRates, grossTotal, isBeforeBooks, vatAmount } from '#/lib/invoice'
import { baseCurrency, CURRENCIES, CURRENCY_SYMBOL, currencyLabel, formatAmount, formatMoney, isBaseCurrency, parseMoney, type Currency } from '#/lib/money'
import { monthYear } from '#/lib/finance'
import { intlLocale, t, tn } from '#/i18n'
import { formatDate, formatNumber } from '#/i18n/format'
import { useSubmit } from '#/lib/useSubmit'

interface Row {
  key: number
  name: string
  qty: string
  serial: string
}

export function InvoiceSheet({
  open,
  onClose,
  onAdded,
  inOnly,
  returnKey,
  canLink = false,
  preset,
  edit,
  onUpdated,
}: {
  open: boolean
  onClose: () => void
  onAdded: (i: Invoice, assets: number) => void
  edit?: Invoice
  onUpdated?: (i: Invoice) => void
  inOnly: boolean
  returnKey: string
  canLink?: boolean
  preset?: LinkTarget
}) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey={returnKey}>
      <InvoiceForm key={edit?.id ?? 'new'} onClose={onClose} onAdded={onAdded} inOnly={inOnly} canLink={canLink} preset={preset} edit={edit} onUpdated={onUpdated} />
    </RequestSheet>
  )
}

function InvoiceForm({ onClose, onAdded, inOnly, canLink, preset, edit, onUpdated }: { onClose: () => void; onAdded: (i: Invoice, assets: number) => void; inOnly: boolean; canLink: boolean; preset?: LinkTarget; edit?: Invoice; onUpdated?: (i: Invoice) => void }) {
  const session = useSession()
  const TODAY = session.todayISO
  const selfApproves = session.user.role === 'approver'
  const keys = useRef(1)
  const [direction, setDirection] = useState<'in' | 'out'>(edit?.direction ?? 'in')
  const [file, setFile] = useState<File | null>(null)
  const [firm, setFirm] = useState(edit?.firm ?? '')
  const [no, setNo] = useState(edit?.no ?? '')
  const [date, setDate] = useState(edit?.date ?? TODAY)
  const [net, setNet] = useState(edit ? formatAmount(edit.netOrig) : '')
  const vatList = configuredVatRates()
  const [vatRate, setVatRate] = useState(edit?.vatRate ?? vatList[vatList.length - 1] ?? 0)
  const [due, setDue] = useState(edit?.due ?? '')
  const [toInventory, setToInventory] = useState(false)
  const [costKind, setCostKind] = useState<'direct' | 'overhead' | ''>(edit?.costKind ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [currency, setCurrency] = useState<Currency>(edit?.currency ?? baseCurrency())
  const [fxRate, setFxRate] = useState('')
  const [picked, setPicked] = useState<LinkTarget[]>(preset ? [preset] : [])
  const foreign = !isBaseCurrency(currency)

  const { errors, warning, busy, run, clear } = useSubmit<{ ok: true; invoice: Invoice; assets?: number }>({
    schema: edit ? invoiceEditSchema : invoiceSchema,
    submit: (input) => (edit ? updateInvoice(input) : submitInvoice(input)),
    onClose,
    onSubmitted: (r) => (edit ? onUpdated?.(r.invoice) : onAdded(r.invoice, r.assets ?? 0)),
    build: () => (edit ? {
      id: edit.id,
      version: edit.version,
      firm,
      no,
      date: date || undefined,
      currency,
      fxRate: foreign ? parseRate(fxRate) : undefined,
      net: parseMoney(net) ?? undefined,
      vatRate,
      due: direction === 'out' ? due || undefined : undefined,
      costKind: direction === 'in' ? costKind || undefined : undefined,
    } : {
      direction,
      fileName: file?.name,
      file: file ?? undefined,
      firm,
      no,
      date: date || undefined,
      currency,
      fxRate: foreign ? parseRate(fxRate) : undefined,
      links: canLink && direction === 'in' && picked.length ? picked.map((p) => ({ kind: p.kind, id: p.id })) : undefined,
      net: parseMoney(net) ?? undefined,
      vatRate,
      due: direction === 'out' ? due || undefined : undefined,
      toInventory: direction === 'in' && toInventory,
      costKind: direction === 'in' ? costKind || undefined : undefined,
      items: direction === 'in' && toInventory ? rows.map((r) => ({ name: r.name, qty: r.qty.trim() === '' ? undefined : Number(r.qty), serial: r.serial || undefined })) : [],
    }),
  })

  const netV = parseMoney(net) ?? 0
  const vat = vatAmount(netV, vatRate)
  const total = grossTotal(netV, vatRate)
  const addRow = () => setRows((l) => [...l, { key: keys.current++, name: '', qty: '1', serial: '' }])
  const patchRow = (i: number, p: Partial<Row>) => setRows((l) => l.map((r, idx) => (idx === i ? { ...r, ...p } : r)))

  return (
    <SheetLayout
      title={edit ? t('invoices.sheet.editTitle') : t('invoices.sheet.newTitle')}
      subtitle={edit ? (direction === 'in' ? t('invoices.sheet.subIn') : t('invoices.sheet.subOut')) : inOnly ? t('invoices.sheet.subIn') : t('invoices.sheet.subAny')}
      submitLabel={busy && foreign && !fxRate.trim() ? t('invoices.sheet.fetchingRate') : edit ? t('invoices.sheet.save') : t('invoices.sheet.submit')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone={direction === 'in' ? 'expense' : 'advance'}
          kicker={direction === 'in' ? t('invoices.incoming') : t('invoices.outgoing')}
          headline={firm.trim() || t('invoices.sheet.firm')}
          big={formatMoney(total, currency)}
          rows={[
            { label: t('invoices.sheet.netAmount'), value: formatMoney(netV, currency) },
            { label: t('invoices.sheet.vatLine', { rate: vatRate }), value: formatMoney(vat, currency) },
            ...(foreign ? [{ label: t('invoices.sheet.rate'), value: fxRate.trim() ? fxRate : edit ? t('invoices.sheet.rateSaved', { rate: rate4(edit.fxRate ?? 0) }) : t('invoices.sheet.rateOfDay') }] : []),
            ...(date ? [{ label: t('invoices.sheet.date'), value: dateLabel(date) }] : []),
            ...(direction === 'out' && due ? [{ label: t('invoices.sheet.due'), value: dateLabel(due) }] : []),
            ...(direction === 'in' && toInventory && rows.length ? [{ label: t('invoices.sheet.toInventoryShort'), value: tn('invoices.sheet.units', rows.reduce((s, r) => s + (Number(r.qty) || 0), 0)) }] : []),
          ]}
        />
      }
      aside={
        <SheetAside
          onay={
            direction === 'in'
              ? date && isBeforeBooks(date)
                ? t('invoices.sheet.asideBeforeBooks')
                : edit
                  ? t('invoices.sheet.asideEdit')
                  : selfApproves
                    ? t('invoices.sheet.asideSelf')
                    : t('invoices.sheet.asidePending')
              : t('invoices.sheet.asideOut')
          }
          warning={warning}
        />
      }
    >
      {!inOnly && !edit && (
        <div className="mt-5">
          <span className="mb-2.5 block text-micro font-semibold text-muted">{t('invoices.sheet.type')}</span>
          <Segmented
            label={t('invoices.sheet.typeLabel')}
            autoFocusFirst
            value={direction}
            options={[
              { value: 'in', label: t('invoices.sheet.typeIn') },
              { value: 'out', label: t('invoices.sheet.typeOut') },
            ]}
            onChange={(v) => {
              setDirection(v)
              clear('due')
            }}
          />
        </div>
      )}

      {!edit && (
        <Field id="inv-file" label={t('invoices.sheet.file')} className="mt-5.5">
          <FileField id="inv-file" capture file={file} invalid={!!errors.fileName} error={errors.fileName} onChange={(f) => { setFile(f); clear('fileName') }} />
        </Field>
      )}

      <Field id="inv-firm" label={t('invoices.sheet.firm')} error={errors.firm} className="mt-5.5">
        <input {...fieldA11y('inv-firm', errors.firm)} type="text" maxLength={200} value={firm} onChange={(e) => { setFirm(e.target.value); clear('firm') }} className="input" />
      </Field>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-2">
        <Field id="inv-no" label={t('invoices.sheet.no')} error={errors.no}>
          <input {...fieldA11y('inv-no', errors.no)} type="text" maxLength={60} value={no} onChange={(e) => { setNo(e.target.value); clear('no') }} className="input" />
        </Field>
        <Field id="inv-date" label={t('invoices.sheet.date')} error={errors.date}>
          <input {...fieldA11y('inv-date', errors.date)} type="date" max={TODAY} value={date} onChange={(e) => { setDate(e.target.value); clear('date') }} className="input" />
        </Field>
      </div>

      <div className="mt-5.5">
        <span className="mb-2.5 block text-micro font-semibold text-muted">{t('invoices.sheet.currency')}</span>
        <Segmented
          label={t('invoices.sheet.currency')}
          value={currency}
          options={CURRENCIES.map((c) => ({ value: c, label: currencyLabel(c) }))}
          onChange={(v) => {
            setCurrency(v)
            clear('fxRate')
          }}
        />
      </div>

      <div className="mt-5.5 grid gap-3.5 sm:grid-cols-[1fr_auto] sm:items-start">
        <Field id="inv-net" label={foreign ? t('invoices.sheet.netAmountIn', { currency }) : t('invoices.sheet.netAmount')} error={errors.net}>
          <MoneyInput {...fieldA11y('inv-net', errors.net)} suffix={CURRENCY_SYMBOL[currency]} value={net} onChange={(v) => { setNet(v); clear('net') }} />
        </Field>
        <div>
          <span className="mb-2.5 block text-micro font-semibold text-muted">{t('invoices.sheet.vatRate')}</span>
          <Segmented label={t('invoices.sheet.vatRate')} value={String(vatRate) as '0'} options={(vatList.includes(vatRate) ? vatList : [...vatList, vatRate].sort((a, b) => a - b)).map((r) => ({ value: String(r) as '0', label: `%${formatNumber(r)}` }))} onChange={(v) => setVatRate(Number(v))} />
        </div>
      </div>
      <p className="num mt-2 text-small text-muted" aria-live="polite">
        {t('invoices.sheet.vatShort')} {formatMoney(vat, currency)} · {t('invoices.sheet.total')} <b className="font-semibold text-ink">{formatMoney(total, currency)}</b>
      </p>

      {foreign && (
        <Field id="inv-fx" label={t('invoices.sheet.rateField', { base: currencyLabel(baseCurrency()) })} optional error={errors.fxRate} hint={edit ? t('invoices.sheet.rateHintEdit', { rate: rate4(edit.fxRate ?? 0) }) : t('invoices.sheet.rateHintNew')} className="mt-5.5">
          <input {...fieldA11y('inv-fx', errors.fxRate, 'x')} type="text" inputMode="decimal" autoComplete="off" placeholder={t('invoices.sheet.ratePlaceholder')} value={fxRate} onChange={(e) => { setFxRate(e.target.value.replace(/[^\d.,]/g, '')); clear('fxRate') }} className="input num" />
        </Field>
      )}

      {direction === 'out' && (
        <Field id="inv-due" label={t('invoices.sheet.dueDate')} error={errors.due} className="mt-5.5">
          <input {...fieldA11y('inv-due', errors.due)} type="date" min={date || undefined} value={due} onChange={(e) => { setDue(e.target.value); clear('due') }} className="input" />
        </Field>
      )}

      {direction === 'in' && (
        <div className="mt-5.5">
          <span className="mb-2.5 block text-micro font-semibold text-muted">{t('invoices.sheet.costKind')}</span>
          <Segmented
            label={t('invoices.sheet.costKind')}
            invalid={!!errors.costKind}
            value={costKind as 'direct'}
            options={[
              { value: 'direct', label: t('invoices.cost.direct') },
              { value: 'overhead', label: t('invoices.cost.overhead') },
            ]}
            onChange={(v) => {
              setCostKind(v)
              clear('costKind')
            }}
          />
          {errors.costKind ? (
            <p role="alert" className="mt-1.5 text-micro text-status-rejected">{errors.costKind}</p>
          ) : (
            <p className="mt-1.5 text-micro text-faint">{t('invoices.sheet.costHint')}</p>
          )}
        </div>
      )}

      {direction === 'in' && !inOnly && !edit && (
        <div className="mt-5.5">
          <Switch checked={toInventory} onChange={(v) => { setToInventory(v); if (v && rows.length === 0) addRow() }} label={t('invoices.sheet.toInventory')} />
          {toInventory && (
            <div className="mt-3.5">
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {rows.map((r, i) => {
                  const p = (k: string) => `items.${i}.${k}`
                  const q = Number(r.qty)
                  return (
                    <li key={r.key} className="rounded-glass border border-hairline p-3.5">
                      <div className="mb-2.5 flex items-center justify-between">
                        <b className="text-link font-semibold">{t('invoices.sheet.item', { n: i + 1 })}</b>
                        {rows.length > 1 && (
                          <button type="button" aria-label={t('invoices.sheet.removeItem', { n: i + 1 })} onClick={() => setRows((l) => l.filter((_, idx) => idx !== i))} className="inline-flex items-center gap-1.5 rounded-full bg-wash px-3 py-1.5 text-micro font-medium text-muted">
                            <Icon name="x" size={12} strokeWidth={2} />
                            {t('invoices.sheet.remove')}
                          </button>
                        )}
                      </div>
                      <Field id={`inv-r${r.key}-name`} label={t('invoices.sheet.itemName')} error={errors[p('name')]}>
                        <input {...fieldA11y(`inv-r${r.key}-name`, errors[p('name')])} type="text" maxLength={300} value={r.name} onChange={(e) => { patchRow(i, { name: e.target.value }); clear(p('name')) }} className="input" />
                      </Field>
                      <div className="mt-3 grid grid-cols-[6rem_1fr] gap-3">
                        <Field id={`inv-r${r.key}-qty`} label={t('invoices.sheet.qty')} error={errors[p('qty')]}>
                          <input {...fieldA11y(`inv-r${r.key}-qty`, errors[p('qty')])} type="text" inputMode="numeric" value={r.qty} onChange={(e) => { patchRow(i, { qty: e.target.value.replace(/[^\d]/g, ''), serial: Number(e.target.value) > 1 ? '' : r.serial }); clear(p('qty')) }} className="input num" />
                        </Field>
                        <Field id={`inv-r${r.key}-serial`} label={t('invoices.sheet.serial')} optional error={errors[p('serial')]} hint={q > 1 ? t('invoices.sheet.serialHint') : undefined}>
                          <input {...fieldA11y(`inv-r${r.key}-serial`, errors[p('serial')], q > 1 ? 'x' : undefined)} type="text" maxLength={100} disabled={q > 1} value={r.serial} onChange={(e) => { patchRow(i, { serial: e.target.value }); clear(p('serial')) }} className="input disabled:opacity-50" />
                        </Field>
                      </div>
                    </li>
                  )
                })}
              </ol>
              {errors.items && <p role="alert" className="mt-1.5 text-micro text-status-rejected">{errors.items}</p>}
              <button type="button" onClick={addRow} className="mt-3 inline-flex items-center gap-2 rounded-full bg-wash px-4 py-2 text-link font-medium">
                <Icon name="plus" size={14} strokeWidth={2} />
                {t('invoices.sheet.addItem')}
              </button>
            </div>
          )}
        </div>
      )}
      {canLink && direction === 'in' && !edit && <LinkPicker picked={picked} onChange={setPicked} error={errors.links} />}
      {edit && edit.links.length > 0 && (
        <section aria-label={t('invoices.sheet.linked')} className="mt-8 border-t border-hairline pt-5">
          <h4 className="text-label font-semibold text-muted">{t('invoices.sheet.linked')}</h4>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {edit.links.map((l) => (
              <li key={`${l.kind}:${l.id}`} className="flex items-baseline gap-2 text-link text-ink">
                <span className="inline-block min-w-18 shrink-0 rounded-full bg-wash px-2.5 py-0.5 text-center text-micro font-medium text-muted">{kindLabel(l.kind)}</span>
                <span className="min-w-0 break-words">{l.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-micro text-faint">{t('invoices.sheet.linkedHint')}</p>
        </section>
      )}
      {edit && <InvoiceHistoryPanel id={edit.id} />}
    </SheetLayout>
  )
}

const rate4 = (n: number) => formatNumber(n, { maximumFractionDigits: 4 })

function parseRate(s: string): number | undefined {
  const raw = s.trim()
  const v = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  const n = Number(v)
  return v && Number.isFinite(n) && n > 0 ? n : undefined
}

function LinkPicker({ picked, onChange, error }: { picked: LinkTarget[]; onChange: (l: LinkTarget[]) => void; error?: string }) {
  const [targets, setTargets] = useState<LinkTarget[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    loadLinkTargets().then((t) => live && setTargets(t)).catch(() => live && setTargets([]))
    return () => {
      live = false
    }
  }, [])
  if (targets && targets.length === 0 && picked.length === 0) return null
  const term = q.trim().toLocaleLowerCase(intlLocale())
  const has = (x: LinkTarget) => picked.some((p) => p.kind === x.kind && p.id === x.id)
  const hits = term ? (targets ?? []).filter((x) => !has(x) && `${x.label} ${x.sub} ${kindLabel(x.kind)}`.toLocaleLowerCase(intlLocale()).includes(term)).slice(0, 8) : []
  return (
    <div className="mt-5.5">
      <label htmlFor="inv-links" className="mb-2.5 block text-micro font-semibold text-muted">
        {t('invoices.sheet.linkLabel')} <span className="font-normal">{t('invoices.sheet.optional')}</span>
      </label>
      {picked.length > 0 && (
        <ul className="m-0 mb-2.5 flex list-none flex-wrap gap-2 p-0">
          {picked.map((p) => (
            <li key={`${p.kind}:${p.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-wash py-1 pr-1.5 pl-3 text-link">
              <span className="text-micro text-faint">{kindLabel(p.kind)}</span>
              <span className="truncate font-medium">{p.label}</span>
              <button type="button" aria-label={t('invoices.sheet.unlink', { label: p.label })} onClick={() => onChange(picked.filter((x) => x !== p))} className="grid size-5 place-items-center rounded-full text-muted hover:bg-surface">
                <Icon name="x" size={11} strokeWidth={2.2} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id="inv-links"
        type="search"
        autoComplete="off"
        placeholder={t('invoices.sheet.linkSearch')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        className="input"
      />
      {hits.length > 0 && (
        <ul className="m-0 mt-2 max-h-56 list-none overflow-y-auto rounded-glass border border-hairline p-1">
          {hits.map((x) => (
            <li key={`${x.kind}:${x.id}`}>
              <button
                type="button"
                onClick={() => {
                  onChange([...picked, x])
                  setQ('')
                }}
                className="flex w-full items-baseline gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-wash"
              >
                <span className="w-14 shrink-0 text-micro font-medium text-faint">{kindLabel(x.kind)}</span>
                <span className="min-w-0">
                  <b className="block truncate text-link font-medium">{x.label}</b>
                  {x.sub && <span className="block truncate text-micro text-faint">{x.sub}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {term && targets && hits.length === 0 && <p className="mt-1.5 text-micro text-faint">{t('invoices.sheet.noMatch')}</p>}
      {error ? <p role="alert" className="mt-1.5 text-micro text-status-rejected">{error}</p> : <p className="mt-1.5 text-micro text-faint">{t('invoices.sheet.linkHint')}</p>}
    </div>
  )
}

const when = (iso: string): string => formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function InvoiceHistoryPanel({ id }: { id: string }) {
  const [h, setH] = useState<InvoiceHistory | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    loadInvoiceHistory(id).then((r) => live && setH(r)).catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [id])
  const month = h?.mailed ? monthYear(h.mailed.month) : ''
  return (
    <section aria-label={t('invoices.history.title')} className="mt-8 border-t border-hairline pt-5">
      {h?.mailed && (
        <p role="note" className="mb-4 rounded-glass bg-wash px-3.5 py-2.5 text-link text-muted">
          {h.mailed.state === 'sent'
            ? t('invoices.history.mailedSent', { month })
            : t('invoices.history.mailedQueued', { month })}
        </p>
      )}
      <h4 className="text-label font-semibold text-muted">{t('invoices.history.title')}</h4>
      {failed && <p className="mt-2 text-link text-status-rejected">{t('invoices.history.failed')}</p>}
      {!failed && !h && <p className="mt-2 text-link text-faint">{t('invoices.history.loading')}</p>}
      {h && h.entries.length === 0 && <p className="mt-2 text-link text-faint">{t('invoices.history.empty')}</p>}
      {h && h.entries.length > 0 && (
        <ol className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
          {h.entries.map((e, i) => (
            <li key={i} className="text-link text-ink">
              <span className="num text-faint">
                {when(e.at)} · {e.who} ·
              </span>{' '}
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
