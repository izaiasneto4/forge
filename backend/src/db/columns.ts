import { customType } from 'drizzle-orm/sqlite-core'

// Rails' SQLite adapter stores datetimes as UTC text ("2026-10-06 12:00:00.123456"),
// omitting the fraction when it is zero. Column type stays `numeric` to match the
// introspected Rails DDL.
const RAILS_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/

export function parseRailsDatetime(value: string): Date {
  const match = RAILS_DATETIME_PATTERN.exec(value)
  if (!match) {
    throw new Error(`Unrecognized Rails datetime: ${value}`)
  }

  const [, date, time, fraction = ''] = match
  const milliseconds = fraction.padEnd(3, '0').slice(0, 3)
  return new Date(`${date}T${time}.${milliseconds}Z`)
}

export function formatRailsDatetime(value: Date): string {
  const [date, timeWithMilliseconds = ''] = value.toISOString().replace('Z', '').split('T')
  const [time, milliseconds = '000'] = timeWithMilliseconds.split('.')
  if (milliseconds === '000') {
    return `${date} ${time}`
  }

  return `${date} ${time}.${milliseconds}000`
}

export const railsDatetime = customType<{ data: Date; driverData: string }>({
  dataType() {
    return 'numeric'
  },
  toDriver: formatRailsDatetime,
  fromDriver: parseRailsDatetime,
})

// Rails 8 stores booleans as 1/0.
export const railsBoolean = customType<{ data: boolean; driverData: number }>({
  dataType() {
    return 'numeric'
  },
  toDriver(value) {
    return value ? 1 : 0
  },
  fromDriver(value) {
    return Number(value) === 1
  },
})
