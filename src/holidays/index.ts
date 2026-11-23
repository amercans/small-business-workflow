import { runtimeConfig } from '#/config/runtime'
import { tr } from './tr'
import type { HolidayCalendar, HolidayDef } from './types'

export type { HolidayCalendar, HolidayDef } from './types'

export const HOLIDAY_CALENDARS: Record<string, HolidayCalendar> = {
  TR: tr,
}

export interface Holiday {
  date: string
  name: string
  half?: boolean
}

const EMPTY: HolidayCalendar = { years: [], days: [], name: (k) => k }

export const activeCalendar = (country: string = runtimeConfig().holidayCountry): HolidayCalendar => HOLIDAY_CALENDARS[country.trim().toUpperCase()] ?? EMPTY

const toHoliday = (cal: HolidayCalendar, d: HolidayDef): Holiday => ({
  date: d.date,
  half: d.half,
  get name() {
    return cal.name(d.key)
  },
})

export function getHolidays(year?: number, country?: string): Holiday[] {
  const cal = activeCalendar(country)
  return cal.days.filter((d) => year === undefined || d.date.startsWith(`${year}-`)).map((d) => toHoliday(cal, d))
}

export const holidayYears = (country?: string): ReadonlySet<number> => new Set(activeCalendar(country).years)

export const fullHolidayDates = (country?: string): ReadonlySet<string> => new Set(activeCalendar(country).days.filter((d) => !d.half).map((d) => d.date))

export const halfHolidaySet = (country?: string): ReadonlySet<string> => new Set(activeCalendar(country).days.filter((d) => d.half).map((d) => d.date))

export function holidayOn(date: string, country?: string): Holiday | undefined {
  const cal = activeCalendar(country)
  const d = cal.days.find((x) => x.date === date)
  return d ? toHoliday(cal, d) : undefined
}
