import { activeCalendar, fullHolidayDates, getHolidays, halfHolidaySet, holidayOn, holidayYears, type Holiday } from '#/holidays'

export type { Holiday } from '#/holidays'

class LiveSet<T> implements ReadonlySet<T> {
  constructor(private read: () => ReadonlySet<T>) {}
  has(v: T) {
    return this.read().has(v)
  }
  get size() {
    return this.read().size
  }
  forEach(cb: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown) {
    this.read().forEach((v) => cb.call(thisArg, v, v, this))
  }
  entries() {
    return this.read().entries()
  }
  keys() {
    return this.read().keys()
  }
  values() {
    return this.read().values()
  }
  [Symbol.iterator]() {
    return this.read()[Symbol.iterator]()
  }
}

class LiveHolidayMap implements ReadonlyMap<string, Holiday> {
  private read = () => new Map(getHolidays().map((h) => [h.date, h]))
  get(date: string) {
    return holidayOn(date)
  }
  has(date: string) {
    return holidayOn(date) !== undefined
  }
  get size() {
    return this.read().size
  }
  forEach(cb: (value: Holiday, key: string, map: ReadonlyMap<string, Holiday>) => void, thisArg?: unknown) {
    this.read().forEach((v, k) => cb.call(thisArg, v, k, this))
  }
  entries() {
    return this.read().entries()
  }
  keys() {
    return this.read().keys()
  }
  values() {
    return this.read().values()
  }
  [Symbol.iterator]() {
    return this.read()[Symbol.iterator]()
  }
}

class CoveredYears extends LiveSet<number> {
  has(year: number) {
    return activeCalendar().years.length === 0 || super.has(year)
  }
}

export const HOLIDAY_YEARS: ReadonlySet<number> = new CoveredYears(() => holidayYears())

export const holidayDates: ReadonlySet<string> = new LiveSet(() => fullHolidayDates())

export const halfHolidayDates: ReadonlySet<string> = new LiveSet(() => halfHolidaySet())

export const holidayByDate: ReadonlyMap<string, Holiday> = new LiveHolidayMap()
