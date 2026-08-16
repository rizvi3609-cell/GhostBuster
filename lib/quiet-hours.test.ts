import { describe, expect, it } from "vitest"

import { isWithinSendingWindow, nextAllowedSendTime } from "./quiet-hours"

const timezone = "America/New_York"

describe("isWithinSendingWindow", () => {
  it("uses an inclusive start and exclusive end", () => {
    expect(
      isWithinSendingWindow(new Date("2024-01-15T13:00:00Z"), timezone, "08:00", "20:00"),
    ).toBe(true)
    expect(
      isWithinSendingWindow(new Date("2024-01-16T00:59:59Z"), timezone, "08:00", "20:00"),
    ).toBe(true)
    expect(
      isWithinSendingWindow(new Date("2024-01-16T01:00:00Z"), timezone, "08:00", "20:00"),
    ).toBe(false)
    expect(
      isWithinSendingWindow(new Date("2024-01-15T12:59:00Z"), timezone, "08:00", "20:00"),
    ).toBe(false)
  })

  it("supports windows that cross midnight", () => {
    expect(
      isWithinSendingWindow(new Date("2024-01-16T04:00:00Z"), timezone, "22:00", "06:00"),
    ).toBe(true)
    expect(
      isWithinSendingWindow(new Date("2024-01-16T10:30:00Z"), timezone, "22:00", "06:00"),
    ).toBe(true)
    expect(
      isWithinSendingWindow(new Date("2024-01-16T17:00:00Z"), timezone, "22:00", "06:00"),
    ).toBe(false)
  })

  it("rejects an ambiguous zero-length sending window", () => {
    expect(() =>
      isWithinSendingWindow(
        new Date("2024-01-16T17:00:00Z"),
        timezone,
        "00:00",
        "00:00",
      ),
    ).toThrow("Sending window start and end must differ")
  })

  it("rejects invalid input", () => {
    expect(() =>
      isWithinSendingWindow(new Date("invalid"), timezone, "08:00", "20:00"),
    ).toThrow("nowUtc must be a valid Date")
    expect(() =>
      isWithinSendingWindow(new Date(), "Not/A_Timezone", "08:00", "20:00"),
    ).toThrow("Invalid IANA timezone")
    expect(() =>
      isWithinSendingWindow(new Date(), timezone, "8:00", "20:00"),
    ).toThrow("Invalid clock time")
    expect(() =>
      isWithinSendingWindow(new Date(), timezone, "08:00", "24:00"),
    ).toThrow("Invalid clock time")
  })
})

describe("nextAllowedSendTime", () => {
  it("returns a copy of the current instant when already allowed", () => {
    const now = new Date("2024-01-15T15:15:27.123Z")
    const result = nextAllowedSendTime(now, timezone, "08:00", "20:00")

    expect(result).toEqual(now)
    expect(result).not.toBe(now)
  })

  it("returns the next clinic-local opening minute", () => {
    expect(
      nextAllowedSendTime(
        new Date("2024-01-16T01:15:27Z"),
        timezone,
        "08:00",
        "20:00",
      ).toISOString(),
    ).toBe("2024-01-16T13:00:00.000Z")

    expect(
      nextAllowedSendTime(
        new Date("2024-01-16T17:00:00Z"),
        timezone,
        "22:00",
        "06:00",
      ).toISOString(),
    ).toBe("2024-01-17T03:00:00.000Z")
  })

  it("handles the March DST gap without inventing a local time", () => {
    const beforeGap = new Date("2024-03-10T06:59:00Z")

    expect(isWithinSendingWindow(beforeGap, timezone, "02:30", "04:00")).toBe(false)
    expect(
      nextAllowedSendTime(beforeGap, timezone, "02:30", "04:00").toISOString(),
    ).toBe("2024-03-10T07:00:00.000Z")
    expect(
      isWithinSendingWindow(
        new Date("2024-03-10T07:00:00Z"),
        timezone,
        "02:30",
        "04:00",
      ),
    ).toBe(true)
  })

  it("handles both occurrences of the November DST fold", () => {
    expect(
      isWithinSendingWindow(
        new Date("2024-11-03T05:45:00Z"),
        timezone,
        "01:30",
        "02:30",
      ),
    ).toBe(true)
    expect(
      isWithinSendingWindow(
        new Date("2024-11-03T06:15:00Z"),
        timezone,
        "01:30",
        "02:30",
      ),
    ).toBe(false)
    expect(
      nextAllowedSendTime(
        new Date("2024-11-03T06:15:00Z"),
        timezone,
        "01:30",
        "02:30",
      ).toISOString(),
    ).toBe("2024-11-03T06:30:00.000Z")
    expect(
      isWithinSendingWindow(
        new Date("2024-11-03T06:45:00Z"),
        timezone,
        "01:30",
        "02:30",
      ),
    ).toBe(true)
  })
})
