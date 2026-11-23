import { Segments } from './Segments'
import { SummaryCard } from './SummaryCard'
import { t } from '#/i18n'

interface Props {
  kindLabel: string
  range: string
  big: number | string
  unit: string
  balance: string
  back: string
  total: number
  on: number
  pending: number
}

export function LeaveSummary({ kindLabel, range, big, unit, balance, back, total, on, pending }: Props) {
  return (
    <SummaryCard
      tone="leave"
      kicker={kindLabel}
      headline={range}
      big={big}
      unit={unit}
      rows={[
        { label: t('calendar.backAtWork'), value: back },
        { label: t('calendar.balance'), value: balance },
      ]}
    >
      <Segments className="relative z-1 mt-2.5 max-w-none" total={total} on={on} pending={pending} label={t('calendar.balanceLabel', { balance })} />
    </SummaryCard>
  )
}
