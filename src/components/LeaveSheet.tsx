import { useState } from 'react'
import { DateRangePicker } from './DateRangePicker'
import { Field } from './Field'
import { FileField } from './FileField'
import { LeaveSummary } from './LeaveSummary'
import { RequestSheet, SheetAside, SheetLayout } from './RequestSheet'
import { Segmented } from './Segmented'
import { Select } from './Select'
import { halfHolidayDates, holidayDates } from '#/data/holidays'
import { partialMap, earliestLeaveDate, SICK_BACKDATE_DAYS, HALF_DAY, halfDayLabel, LEAVE_OVERDRAFT_DAYS, TIME_SLOTS, WORKDAY_HOURS, formatLeaveDays, hoursToDays, isWorkday, leaveHours, partialHours, returnDate, type HalfDay } from '#/lib/leave'
import { leaveKinds, submitLeaveRequest, type LeaveKind } from '#/data/leave'
import { EXCUSE_REASON_LABEL, excuseLegal, EXCUSE_REASONS, HALF_DAYS, LEAVE_KIND_TEXT, LEAVE_SPAN_LABEL, LEAVE_SPANS, leaveName, type ExcuseReason, type LeaveSpan } from '#/lib/requestSchemas'
import type { MyRequest, HomeData } from '#/data/home'
import { countWorkdays, formatDay, type LeaveCtx } from '#/lib/leave'
import { useMediaQuery } from '#/lib/useMediaQuery'
import { clientError } from '#/lib/clientError'
import { useSession } from '#/lib/useSession'
import { t } from '#/i18n'
import { formatNumber } from '#/i18n/format'

export interface SheetProps {
  open: boolean
  onClose: () => void
  onSubmitted: (requests: MyRequest[]) => void | Promise<void>
  home: HomeData
}

export function LeaveSheet({ open, onClose, onSubmitted, home }: SheetProps) {
  return (
    <RequestSheet open={open} onClose={onClose} returnFocusKey="leave">
      <LeaveForm onClose={onClose} onSubmitted={onSubmitted} home={home} />
    </RequestSheet>
  )
}

function LeaveForm({ onClose, onSubmitted, home }: Omit<SheetProps, 'open'>) {
  const { todayISO, leave } = home
  const isAuto = useSession().autoApproveKinds.includes('leave')
  const isDesktop = useMediaQuery('(min-width: 64rem)', true)
  const ctx: LeaveCtx = { holidays: holidayDates, halfDays: halfHolidayDates, approved: leave.approvedRanges, partial: partialMap(leave.partialDays) }

  const [kind, setKind] = useState<LeaveKind>('annual')
  const [reason, setReason] = useState<ExcuseReason | null>(null)
  const [span, setSpan] = useState<LeaveSpan>('full_day')
  const [half, setHalf] = useState<HalfDay>('morning')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('12:00')
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [serverError, setServerError] = useState('')
  const [busy, setBusy] = useState(false)

  const partial = span !== 'full_day'
  const [t0, t1] = span === 'half_day' ? HALF_DAY[half] : [startTime, endTime]
  const hours = partial && start ? partialHours(start, t0, t1, ctx) : partial ? leaveHours(t0, t1) : 0
  const tooLong = span === 'hours' && hours >= WORKDAY_HOURS
  const days = !start ? 0 : partial ? (isWorkday(start, ctx) && hours > 0 && !tooLong ? hoursToDays(hours) : 0) : countWorkdays(start, end ?? start, ctx)
  const back = start && days > 0 ? returnDate(partial ? start : (end ?? start), ctx, partial ? t1 : null) : null
  const minISO = earliestLeaveDate(kind, todayISO)
  const available = leave.left - leave.pendingDays
  const deducts = kind === 'annual'
  const over = deducts && !leave.unlimited && !!start && days > available + LEAVE_OVERDRAFT_DAYS
  const noWorkday = !!start && days === 0 && !tooLong && !(partial && hours <= 0)
  const noteMissing = !note.trim()
  const reasonMissing = kind === 'excuse' && !reason
  const legal = kind === 'excuse' && reason ? excuseLegal(reason) : undefined
  const canSend = !!start && days > 0 && !over && !noteMissing && !reasonMissing && !busy

  const rangeText = !start ? t('leave.sheet.pickDate') : partial ? `${formatDay(start)}, ${t0}–${t1}` : end && end !== start ? `${formatDay(start)} – ${formatDay(end)}` : formatDay(start)
  const afterLeft = available - (deducts ? days : 0)
  const balanceText = !start ? formatLeaveDays(available) : deducts ? `${formatLeaveDays(available)} → ${formatLeaveDays(afterLeft)}` : t('leave.sheet.notDeducted', { balance: formatLeaveDays(available) })
  const newPending = deducts && start ? Math.min(days, available) : 0
  const segOn = Math.max(0, Math.floor(available - newPending))
  const segPending = Math.ceil(newPending + leave.pendingDays)

  const warning =
    serverError ||
    (over
      ? t('leave.sheet.overBalance', { days: formatLeaveDays(days), balance: formatLeaveDays(available) })
      : tooLong ? t('leave.sheet.useFullDay', { hours: WORKDAY_HOURS })
      : partial && hours <= 0 ? (start && halfHolidayDates.has(start) ? t('leave.sheet.eveAfternoon') : t('leave.sheet.endAfterStart'))
      : noWorkday ? (partial ? t('leave.sheet.notWorkday') : t('leave.sheet.noWorkdays')) : start && days > 0 && reasonMissing ? t('leave.sheet.pickReason') : start && days > 0 && noteMissing ? t('leave.sheet.writeNote') : deducts && start && afterLeft < 0 && !leave.unlimited ? t('leave.sheet.negative', { days: formatLeaveDays(-afterLeft) }) : '')

  async function send() {
    if (!start || !canSend) return
    setBusy(true)
    setServerError('')
    const res = await submitLeaveRequest({
      kind,
      reason: kind === 'excuse' ? (reason ?? undefined) : undefined,
      span,
      start,
      end: partial ? start : (end ?? start),
      half: span === 'half_day' ? half : undefined,
      startTime: span === 'hours' ? startTime : undefined,
      endTime: span === 'hours' ? endTime : undefined,
      note: note.trim(),
      attachmentName: kind === 'sick' ? file?.name : undefined,
      file: kind === 'sick' ? (file ?? undefined) : undefined,
    }).catch((e) => ({ ok: false as const, error: clientError(e) }))
    setBusy(false)
    if (!res.ok) {
      setServerError(res.error)
      return
    }
    onClose()
    await onSubmitted([res.request])
  }

  return (
    <SheetLayout
      title={t('leave.sheet.title')}
      onSubmit={send}
      onCancel={onClose}
      busy={busy}
      disabled={!canSend}
      summary={
        <LeaveSummary
          kindLabel={leaveName(kind, reason ?? undefined)}
          range={rangeText}
          big={partial ? formatNumber(hours, { maximumFractionDigits: 2 }) : days}
          unit={partial ? t('leave.sheet.unitHours') : t('leave.sheet.unitWorkdays')}
          back={back ? formatDay(back) : '—'}
          balance={balanceText}
          total={leave.total ?? 0}
          on={segOn}
          pending={segPending}
        />
      }
      aside={<SheetAside onay={isAuto ? t('leave.sheet.asideAuto') : t('leave.sheet.aside')} warning={warning} />}
    >
      <Segmented
        label={t('leave.sheet.kind')}
        autoFocusFirst
        className="mt-5"
        value={kind}
        options={leaveKinds.map((k) => ({ value: k, label: LEAVE_KIND_TEXT[k] }))}
        onChange={(k) => {
          setKind(k)
          setServerError('')
          if (k !== 'sick') setFile(null)
          if (start && start < earliestLeaveDate(k, todayISO)) {
            setStart(null)
            setEnd(null)
          }
          if (k !== 'excuse') setReason(null)
        }}
      />
      {kind === 'excuse' && (
        <div className="mt-3">
          <Segmented label={t('leave.sheet.reason')} value={reason ?? ('' as ExcuseReason)} options={EXCUSE_REASONS.map((r) => ({ value: r, label: EXCUSE_REASON_LABEL[r] }))} onChange={setReason} />
          {legal && (
            <p className="mt-2 text-small text-muted">
              {legal.note}
              {days > legal.days ? ` ${t('leave.sheet.legalOver', { days: formatLeaveDays(days) })}` : ''}
            </p>
          )}
        </div>
      )}

      <Segmented
        label={t('leave.sheet.span')}
        className="mt-4"
        value={span}
        options={LEAVE_SPANS.map((k) => ({ value: k, label: LEAVE_SPAN_LABEL[k] }))}
        onChange={(k) => {
          setSpan(k)
          setServerError('')
          if (k !== 'full_day' && start) setEnd(start)
        }}
      />

      <DateRangePicker
        id="leave-dates"
        label={partial ? t('leave.sheet.pickDay') : t('leave.sheet.pickRange')}
        mode={partial ? 'single' : 'range'}
        start={start}
        end={end}
        onChange={(s, e) => {
          setStart(s)
          setEnd(partial ? s : e)
          setServerError('')
        }}
        todayISO={todayISO}
        minISO={minISO}
        ctx={ctx}
        isDesktop={isDesktop}
        approvedLabel={leave.approvedLabel}
        extraLegend={kind === 'sick' ? <span>{t('leave.sheet.sickBackdate', { days: SICK_BACKDATE_DAYS })}</span> : undefined}
      />

      {span === 'half_day' && (
        <div className="mt-5.5 flex flex-col">
          <Segmented label={t('leave.sheet.halfDay')} value={half} options={HALF_DAYS.map((h) => ({ value: h, label: halfDayLabel(h) }))} onChange={setHalf} />
          <p className="mt-2 text-micro text-faint">
            {t('leave.sheet.halfDayHint')}
          </p>
        </div>
      )}

      {span === 'hours' && (
        <div className="mt-5.5 grid grid-cols-2 gap-3.5">
          <Field id="leave-from" label={t('leave.sheet.startTime')}>
            <Select
              id="leave-from"
              value={startTime}
              onChange={(e) => {
                const v = e.target.value
                setStartTime(v)
                if (endTime <= v) setEndTime(TIME_SLOTS[TIME_SLOTS.indexOf(v) + 1] ?? v)
              }}
            >
              {TIME_SLOTS.slice(0, -1).map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="leave-to" label={t('leave.sheet.endTime')}>
            <Select id="leave-to" value={endTime} onChange={(e) => setEndTime(e.target.value)}>
              {TIME_SLOTS.filter((slot) => slot > startTime).map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </Select>
          </Field>
          <p className="col-span-2 -mt-1 text-micro text-faint">{t('leave.sheet.hourlyHint', { hours: WORKDAY_HOURS })}</p>
        </div>
      )}

      <Field id="leave-note" label={t('leave.sheet.note')} className="mt-5.5">
        <textarea
          id="leave-note"
          required
          aria-required="true"
          value={note}
          maxLength={500}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('leave.sheet.notePlaceholder')}
          className="input min-h-13.5 resize-none"
        />
      </Field>

      {kind === 'sick' && (
        <Field id="leave-report" label={t('leave.sheet.report')} optional className="mt-5.5">
          <FileField id="leave-report" file={file} onChange={setFile} />
        </Field>
      )}
    </SheetLayout>
  )
}
