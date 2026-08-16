type SendingWindow = Readonly<{
  formatter: Intl.DateTimeFormat
  startMinute: number
  endMinute: number
}>

const clockTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const millisecondsPerMinute = 60_000

function parseClockTime(value: string): number {
  if (!clockTimePattern.test(value)) {
    throw new RangeError(`Invalid clock time: ${value}`)
  }

  const [hour, minute] = value.split(":").map(Number)
  return hour * 60 + minute
}

function createFormatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${timezone}`)
  }
}

function createSendingWindow(
  nowUtc: Date,
  timezone: string,
  startTime: string,
  endTime: string,
): SendingWindow {
  if (Number.isNaN(nowUtc.getTime())) {
    throw new RangeError("nowUtc must be a valid Date")
  }

  const startMinute = parseClockTime(startTime)
  const endMinute = parseClockTime(endTime)

  if (startMinute === endMinute) {
    throw new RangeError("Sending window start and end must differ")
  }

  return {
    formatter: createFormatter(timezone),
    startMinute,
    endMinute,
  }
}

function getLocalMinute(date: Date, formatter: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type === "hour" || part.type === "minute")
      .map((part) => [part.type, Number(part.value)]),
  )

  return parts.hour * 60 + parts.minute
}

function containsMinute(localMinute: number, window: SendingWindow): boolean {
  if (window.startMinute < window.endMinute) {
    return localMinute >= window.startMinute && localMinute < window.endMinute
  }

  return localMinute >= window.startMinute || localMinute < window.endMinute
}

export function isWithinSendingWindow(
  nowUtc: Date,
  timezone: string,
  startTime: string,
  endTime: string,
): boolean {
  const window = createSendingWindow(nowUtc, timezone, startTime, endTime)
  return containsMinute(getLocalMinute(nowUtc, window.formatter), window)
}

export function nextAllowedSendTime(
  nowUtc: Date,
  timezone: string,
  startTime: string,
  endTime: string,
): Date {
  const window = createSendingWindow(nowUtc, timezone, startTime, endTime)

  if (containsMinute(getLocalMinute(nowUtc, window.formatter), window)) {
    return new Date(nowUtc.getTime())
  }

  const candidate = new Date(
    Math.floor(nowUtc.getTime() / millisecondsPerMinute) * millisecondsPerMinute +
      millisecondsPerMinute,
  )

  for (;;) {
    if (containsMinute(getLocalMinute(candidate, window.formatter), window)) {
      return candidate
    }

    candidate.setTime(candidate.getTime() + millisecondsPerMinute)
  }
}
