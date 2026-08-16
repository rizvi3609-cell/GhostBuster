import { describe, expect, it } from "vitest"

import { clinicLocalDateTimeToUtc } from "./timezone"

describe("clinicLocalDateTimeToUtc", () => {
  it("converts clinic-local wall time to UTC", () => {
    expect(
      clinicLocalDateTimeToUtc("2026-08-20T10:00", "America/New_York")?.toISOString(),
    ).toBe("2026-08-20T14:00:00.000Z")
  })

  it("rejects malformed and impossible local dates", () => {
    expect(clinicLocalDateTimeToUtc("2026-02-30T10:00", "America/New_York")).toBeNull()
    expect(clinicLocalDateTimeToUtc("not-a-date", "America/New_York")).toBeNull()
    expect(clinicLocalDateTimeToUtc("2026-08-20T24:00", "America/New_York")).toBeNull()
  })

  it("rejects a local time skipped by the spring DST gap", () => {
    expect(
      clinicLocalDateTimeToUtc("2026-03-08T02:30", "America/New_York"),
    ).toBeNull()
  })

  it("chooses the first occurrence in the autumn DST fold", () => {
    expect(
      clinicLocalDateTimeToUtc("2026-11-01T01:30", "America/New_York")?.toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z")
  })

  it("rejects an invalid IANA timezone", () => {
    expect(() => clinicLocalDateTimeToUtc("2026-08-20T10:00", "Invalid/Zone")).toThrow(
      RangeError,
    )
  })
})
