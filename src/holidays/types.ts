export interface HolidayDef {
  date: string
  key: string
  half?: boolean
}

export interface HolidayCalendar {
  years: readonly number[]
  days: readonly HolidayDef[]
  name: (key: string) => string
}
