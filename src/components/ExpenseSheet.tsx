import { useRef, useState } from 'react'
import { Field, fieldA11y } from './Field'
import { FileField } from './FileField'
import { Icon } from './Icon'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Select } from './Select'
import { SummaryCard } from './SummaryCard'
import type { SheetProps } from './LeaveSheet'
import { EXPENSE_CATEGORIES, expenseSchema, submitExpenseRequest } from '#/data/requests'
import { advanceOffset, estimateExpense } from '#/lib/expense'
import { runtimeConfig } from '#/config/runtime'
import { baseCurrency, CURRENCIES, CURRENCY_SYMBOL, currencyLabel, formatMoney, isBaseCurrency, parseMoney, type Currency } from '#/lib/money'
import { useSession } from '#/lib/useSession'
import { useSubmit } from '#/lib/useSubmit'
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from '#/lib/requestSchemas'
import { t, tn } from '#/i18n'

interface Item {
  key: number
  date: string
  amount: string
  currency: Currency
  rate: string
  category: string
  description: string
  docNo: string
  vat: string
  file: File | null
}

export function ExpenseSheet({ open, onClose, onSubmitted, home }: SheetProps) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="expense">
      <ExpenseForm onClose={onClose} onSubmitted={onSubmitted} home={home} />
    </RequestSheet>
  )
}

function ExpenseForm({ onClose, onSubmitted, home }: Omit<SheetProps, 'open'>) {
  const isAuto = useSession().autoApproveKinds.includes('expense')
  const nextKey = useRef(1)
  const blank = (): Item => ({ key: nextKey.current++, date: home.todayISO, amount: '', currency: baseCurrency(), rate: '', category: '', description: '', docNo: '', vat: '', file: null })
  const [items, setItems] = useState<Item[]>(() => [blank()])
  const [project, setProject] = useState('')
  const [note, setNote] = useState('')

  const patch = (i: number, p: Partial<Item>) => setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...p } : it)))

  const { errors, warning, busy, run, clear } = useSubmit({
    schema: expenseSchema,
    submit: submitExpenseRequest,
    onClose,
    onSubmitted: (r) => onSubmitted(r.requests),
    build: () => ({
      items: items.map((it) => ({
        date: it.date,
        amount: parseMoney(it.amount) ?? undefined,
        currency: it.currency,
        rate: isBaseCurrency(it.currency) ? undefined : (parseMoney(it.rate) ?? undefined),
        category: it.category || undefined,
        description: it.description,
        docNo: it.docNo.trim() || undefined,
        vat: it.vat ? (parseMoney(it.vat) ?? undefined) : undefined,
        fileName: it.file?.name,
        file: it.file ?? undefined,
      })),
      project: project || undefined,
      note: note || undefined,
    }),
  })

  const lines = items.map((it) => ({ amount: parseMoney(it.amount) ?? 0, currency: it.currency, rate: parseMoney(it.rate) ?? undefined }))
  const estimate = estimateExpense(lines, runtimeConfig().fxRates)
  const total = estimate.total
  const foreign = estimate.groups.filter((g) => !isBaseCurrency(g.currency))
  const big = estimate.unconverted ? (estimate.groups.length === 1 ? formatMoney(estimate.groups[0].amount, estimate.groups[0].currency) : '—') : formatMoney(total)
  const advance = home.advance.openAmount
  const off = advanceOffset(total, advance)

  const advanceText =
    total > 0 && advance > 0 && !estimate.unconverted
      ? off.advanceLeft > 0
        ? t('expense.sheet.advanceLeft', { advance: formatMoney(advance), left: formatMoney(off.advanceLeft) })
        : off.payable > 0
          ? t('expense.sheet.advancePayable', { advance: formatMoney(advance), payable: formatMoney(off.payable) })
          : t('expense.sheet.advanceCovered', { advance: formatMoney(advance) })
      : ''

  return (
    <SheetLayout
      title={t('expense.sheet.title')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={
        <SummaryCard
          tone="expense"
          kicker={t('expense.sheet.title')}
          headline={tn('expense.sheet.items', items.length)}
          big={big}
          rows={
            total > 0 || foreign.length
              ? [
                  ...foreign.map((g) => ({
                    label: t('expense.sheet.inCurrency', { currency: currencyLabel(g.currency) }),
                    value: g.base === null ? `${formatMoney(g.amount, g.currency)} · ${t('expense.sheet.rateOnSubmit')}` : `${formatMoney(g.amount, g.currency)} ≈ ${formatMoney(g.base)}`,
                  })),
                  ...(estimate.unconverted
                    ? []
                    : [
                        { label: foreign.length ? t('expense.sheet.subtotalBase', { currency: currencyLabel(baseCurrency()) }) : t('expense.sheet.subtotal'), value: formatMoney(total) },
                        ...(advance > 0 ? [{ label: t('expense.sheet.advanceOffset'), value: `−${formatMoney(off.offset)}` }] : []),
                        { label: t('expense.sheet.netPayable'), value: formatMoney(off.payable) },
                      ]),
                ]
              : undefined
          }
        />
      }
      aside={
        <SheetAside
          onay={isAuto ? t('expense.sheet.asideAuto') : t('expense.sheet.aside')}
          extra={advanceText && <p className="mt-2 text-small leading-normal text-muted">{advanceText}</p>}
          warning={warning}
        />
      }
    >
      <ol className="flex list-none flex-col gap-3.5 p-0">
        {items.map((it, i) => {
          const p = (k: string) => `items.${i}.${k}`
          const id = (k: string) => `exp-${it.key}-${k}`
          return (
            <li key={it.key} className="rounded-glass border border-hairline p-4">
              <div className="mb-3 flex items-center justify-between">
                <b className="text-row font-semibold">{t('expense.sheet.item', { n: i + 1 })}</b>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems((l) => l.filter((_, idx) => idx !== i))}
                    aria-label={t('expense.sheet.removeItem', { n: i + 1 })}
                    className="inline-flex items-center gap-1.5 rounded-full bg-wash px-3 py-1.5 text-micro font-medium text-muted"
                  >
                    <Icon name="x" size={12} strokeWidth={2} />
                    {t('expense.sheet.remove')}
                  </button>
                )}
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field id={id('date')} label={t('expense.sheet.date')} error={errors[p('date')]}>
                  <input
                    {...fieldA11y(id('date'), errors[p('date')])}
                    type="date"
                    max={home.todayISO}
                    value={it.date}
                    onChange={(e) => {
                      patch(i, { date: e.target.value })
                      clear(p('date'))
                    }}
                    className="input"
                  />
                </Field>
                <Field id={id('amount')} label={t('expense.sheet.amount')} error={errors[p('amount')]}>
                  <MoneyInput
                    {...fieldA11y(id('amount'), errors[p('amount')])}
                    suffix={CURRENCY_SYMBOL[it.currency]}
                    value={it.amount}
                    onChange={(v) => {
                      patch(i, { amount: v })
                      clear(p('amount'))
                    }}
                  />
                </Field>
              </div>
              <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
                <Field id={id('currency')} label={t('expense.sheet.currency')} error={errors[p('currency')]}>
                  <Select
                    {...fieldA11y(id('currency'), errors[p('currency')])}
                    value={it.currency}
                    onChange={(e) => {
                      patch(i, { currency: e.target.value as Currency, rate: '' })
                      clear(p('currency'))
                      clear(p('rate'))
                    }}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {currencyLabel(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {!isBaseCurrency(it.currency) && (
                  <Field id={id('rate')} label={t('expense.sheet.rate', { currency: it.currency, base: currencyLabel(baseCurrency()) })} optional error={errors[p('rate')]} hint={t('expense.sheet.rateHint')}>
                    <MoneyInput
                      {...fieldA11y(id('rate'), errors[p('rate')], 'x')}
                      value={it.rate}
                      onChange={(v) => {
                        patch(i, { rate: v })
                        clear(p('rate'))
                      }}
                    />
                  </Field>
                )}
              </div>
              <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
                <Field id={id('category')} label={t('expense.sheet.category')} error={errors[p('category')]}>
                  <Select
                    {...fieldA11y(id('category'), errors[p('category')])}
                    value={it.category}
                    onChange={(e) => {
                      patch(i, { category: e.target.value })
                      clear(p('category'))
                    }}
                  >
                    <option value="">{t('forms.choose')}</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {EXPENSE_CATEGORY_LABEL[c as ExpenseCategory]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={id('description')} label={t('expense.sheet.description')} error={errors[p('description')]}>
                  <input
                    {...fieldA11y(id('description'), errors[p('description')])}
                    type="text"
                    maxLength={200}
                    value={it.description}
                    onChange={(e) => {
                      patch(i, { description: e.target.value })
                      clear(p('description'))
                    }}
                    placeholder={t('expense.sheet.descriptionPlaceholder')}
                    className="input"
                  />
                </Field>
              </div>
              <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
                <Field id={id('docNo')} label={t('expense.sheet.docNo')} optional error={errors[p('docNo')]}>
                  <input
                    {...fieldA11y(id('docNo'), errors[p('docNo')])}
                    type="text"
                    maxLength={60}
                    value={it.docNo}
                    onChange={(e) => {
                      patch(i, { docNo: e.target.value })
                      clear(p('docNo'))
                    }}
                    placeholder={t('expense.sheet.docNoPlaceholder')}
                    className="input"
                  />
                </Field>
                <Field id={id('vat')} label={t('expense.sheet.vat')} optional error={errors[p('vat')]}>
                  <MoneyInput
                    {...fieldA11y(id('vat'), errors[p('vat')])}
                    suffix={CURRENCY_SYMBOL[it.currency]}
                    value={it.vat}
                    onChange={(v) => {
                      patch(i, { vat: v })
                      clear(p('vat'))
                    }}
                  />
                </Field>
              </div>
              <Field id={id('file')} label={t('expense.sheet.receipt')} className="mt-3.5">
                <FileField
                  id={id('file')}
                  capture
                  file={it.file}
                  invalid={!!errors[p('fileName')]}
                  error={errors[p('fileName')]}
                  onChange={(f) => {
                    patch(i, { file: f })
                    clear(p('fileName'))
                  }}
                />
              </Field>
            </li>
          )
        })}
      </ol>

      <button
        type="button"
        onClick={() => setItems((l) => [...l, blank()])}
        disabled={items.length >= 20}
        className="mt-3.5 inline-flex items-center gap-2 self-start rounded-full bg-wash px-4 py-2 text-link font-medium text-ink disabled:opacity-40"
      >
        <Icon name="plus" size={14} strokeWidth={2} />
        {t('expense.sheet.addItem')}
      </button>

      <Field id="exp-project" label={t('expense.sheet.project')} optional className="mt-5.5">
        <input id="exp-project" type="text" maxLength={120} value={project} onChange={(e) => setProject(e.target.value)} placeholder={t('expense.sheet.projectPlaceholder')} className="input" />
      </Field>
      <Field id="exp-note" label={t('expense.sheet.note')} optional className="mt-5.5">
        <textarea id="exp-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} className="input min-h-13.5 resize-none" />
      </Field>
    </SheetLayout>
  )
}
