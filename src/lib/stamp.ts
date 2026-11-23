import { monthName } from '#/i18n/format'
import { runtimeConfig } from '#/config/runtime'

const fmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: runtimeConfig().timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function stampLabelClient(ts: string): string {
  const p = Object.fromEntries(fmt().formatToParts(new Date(ts)).map((x) => [x.type, x.value]))
  return `${Number(p.day)} ${monthName(Number(p.month), 'short')} ${p.year}, ${p.hour}:${p.minute}`
}
