import { useState } from 'react'
import { DateRangePicker } from './DateRangePicker'
import { Field, fieldA11y } from './Field'
import { MoneyInput } from './MoneyInput'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Switch } from './Switch'
import { SummaryCard } from './SummaryCard'
import type { SheetProps } from './LeaveSheet'
import { holidayDates } from '#/data/holidays'
import { submitTravelRequest, travelSchema } from '#/data/requests'
import { addDays, formatRange, isApprovedDay, partialMap } from '#/lib/leave'
import { formatMoney, parseMoney } from '#/lib/money'
import { nights } from '#/lib/trip'
import { useMediaQuery } from '#/lib/useMediaQuery'
import { useSubmit } from '#/lib/useSubmit'
import { t, tn } from '#/i18n'

export function TravelSheet({ open, onClose, onSubmitted, home }: SheetProps) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="travel">
      <TravelForm onClose={onClose} onSubmitted={onSubmitted} home={home} />
    </RequestSheet>
  )
}

function TravelForm({ onClose, onSubmitted, home }: Omit<SheetProps, 'open'>) {
  const isDesktop = useMediaQuery('(min-width: 64rem)', true)
  const ctx = { holidays: holidayDates, approved: home.leave.approvedRanges, partial: partialMap(home.leave.partialDays) }
  const [place, setPlace] = useState('')
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [purpose, setPurpose] = useState('')
  const [project, setProject] = useState('')
  const [budget, setBudget] = useState('')
  const [wantAdvance, setWantAdvance] = useState(false)
  const [advance, setAdvance] = useState('')

  const to = end ?? start
  const { errors, warning, busy, run, clear } = useSubmit({
    schema: travelSchema,
    submit: submitTravelRequest,
    onClose,
    onSubmitted: (r) => onSubmitted(r.requests),
    build: () => ({
      place,
      start: start ?? undefined,
      end: to ?? undefined,
      purpose,
      project: project || undefined,
      budget: parseMoney(budget) ?? undefined,
      wantAdvance,
      advanceAmount: wantAdvance ? (parseMoney(advance) ?? undefined) : undefined,
    }),
  })

  const nightCount = start && to ? nights(start, to) : 0
  const dayCount = start && to ? nightCount + 1 : 0
  const range = start && to ? formatRange(start, to) : ''
  const budgetValue = parseMoney(budget)
  const advanceValue = wantAdvance ? parseMoney(advance) : null

  let overlaps = false
  if (start && to) {
    for (let d = start; d <= to && !overlaps; d = addDays(d, 1)) overlaps = isApprovedDay(d, ctx)
  }

  const rows = [
    ...(range ? [{ label: t('travel.sheet.dates'), value: range }] : []),
    ...(budgetValue ? [{ label: t('travel.sheet.budget'), value: formatMoney(budgetValue) }] : []),
    ...(advanceValue ? [{ label: t('travel.sheet.advanceShort'), value: formatMoney(advanceValue) }] : []),
  ]

  return (
    <SheetLayout
      title={t('travel.sheet.title')}
      onSubmit={run}
      onCancel={onClose}
      busy={busy}
      summary={<SummaryCard tone="travel" kicker={t('travel.sheet.kicker')} headline={place.trim() || t('travel.sheet.place')} big={dayCount || '—'} unit={dayCount ? tn('travel.sheet.dayUnit', dayCount) : undefined} rows={rows} />}
      aside={
        <SheetAside
          onay={
            wantAdvance
              ? t('travel.sheet.asideAdvance')
              : t('travel.sheet.aside')
          }
          extra={
            overlaps ? (
              <p className="mt-2 text-small leading-normal text-muted">{t('travel.sheet.overlap', { leave: home.leave.approvedLabel ?? '' })}</p>
            ) : undefined
          }
          warning={warning}
        />
      }
    >
      <Field id="trv-place" label={t('travel.sheet.place')} error={errors.place} className="mt-5">
        <input
          {...fieldA11y('trv-place', errors.place)}
          type="text"
          maxLength={120}
          value={place}
          onChange={(e) => {
            setPlace(e.target.value)
            clear('place')
          }}
          placeholder={t('travel.sheet.placePlaceholder')}
          className="input"
        />
      </Field>

      <DateRangePicker
        id="trv-dates"
        label={t('travel.sheet.pickRange')}
        mode="range"
        start={start}
        end={end}
        onChange={(s, e) => {
          setStart(s)
          setEnd(e)
          clear('start')
          clear('end')
        }}
        todayISO={home.todayISO}
        ctx={ctx}
        isDesktop={isDesktop}
        approvedLabel={home.leave.approvedLabel}
        error={errors.start ?? errors.end}
      />

      <Field id="trv-purpose" label={t('travel.sheet.purpose')} error={errors.purpose} className="mt-5.5">
        <textarea
          {...fieldA11y('trv-purpose', errors.purpose)}
          value={purpose}
          maxLength={300}
          rows={2}
          onChange={(e) => {
            setPurpose(e.target.value)
            clear('purpose')
          }}
          placeholder={t('travel.sheet.purposePlaceholder')}
          className="input min-h-13.5 resize-none"
        />
      </Field>

      <Field id="trv-project" label={t('travel.sheet.project')} optional className="mt-5.5">
        <input id="trv-project" type="text" maxLength={120} value={project} onChange={(e) => setProject(e.target.value)} className="input" />
      </Field>

      <Field id="trv-budget" label={t('travel.sheet.budget')} optional error={errors.budget} className="mt-5.5">
        <MoneyInput
          {...fieldA11y('trv-budget', errors.budget)}
          value={budget}
          onChange={(v) => {
            setBudget(v)
            clear('budget')
          }}
        />
      </Field>

      <div className="mt-5.5">
        <Switch id="trv-adv-switch" checked={wantAdvance} onChange={setWantAdvance} label={t('travel.sheet.wantAdvance')} />
        {wantAdvance && (
          <>
            <Field id="trv-adv" label={t('travel.sheet.advanceAmount')} error={errors.advanceAmount} className="mt-3.5" hint={t('travel.sheet.advanceHint')}>
              <MoneyInput
                {...fieldA11y('trv-adv', errors.advanceAmount, 'x')}
                value={advance}
                onChange={(v) => {
                  setAdvance(v)
                  clear('advanceAmount')
                }}
              />
            </Field>
          </>
        )}
      </div>
    </SheetLayout>
  )
}
