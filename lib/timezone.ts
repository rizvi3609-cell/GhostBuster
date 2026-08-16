type LocalDateTimeParts = Readonly<{
  day: number
  hour: number
  minute: number
  month: number
  year: number
}>

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const minuteMs = 60_000

function parseLocalDateTime(value: string): LocalDateTimeParts | null {
  const match = localDateTimePattern.exec(value)
  if (!match) return null

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  }
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))

  if (
    parts.hour > 23 ||
    parts.minute > 59 ||
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    return null
  }

  return parts
}

function zonedParts(
  date: Date,
  formatter: Intl.DateTimeFormat,
): LocalDateTimeParts {
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => ["year", "month", "day", "hour", "minute"].includes(part.type))
      .map((part) => [part.type, Number(part.value)]),
  )

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  }
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  )
}

export function clinicLocalDateTimeToUtc(
  localDateTime: string,
  timezone: string,
): Date | null {
  const target = parseLocalDateTime(localDateTime)
  if (!target) return null

  const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const center = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  )

  for (let offsetMinutes = -18 * 60; offsetMinutes <= 18 * 60; offsetMinutes += 1) {
    const candidate = new Date(center + offsetMinutes * minuteMs)
    if (sameParts(zonedParts(candidate, formatter), target)) return candidate
  }

  return null
}
