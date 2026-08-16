import { describe, expect, it } from "vitest"
import type { CountryCode } from "libphonenumber-js"

import { normalizeToE164 } from "./phone"

describe("normalizeToE164", () => {
  it.each([
    ["2125551234", "+12125551234"],
    ["12125551234", "+12125551234"],
    ["(212) 555-1234", "+12125551234"],
    ["212-555-1234", "+12125551234"],
    [" 212.555.1234 ", "+12125551234"],
    ["+44 20 7946 0018", "+442079460018"],
  ])("normalizes %s to E.164", (input, expected) => {
    expect(normalizeToE164(input, "US")).toEqual({
      ok: true,
      phone: expected,
    })
  })

  it.each([
    "2125551234 ext 9",
    "2125551234 extension: 9",
    "2125551234 x9",
    "+12125551234;ext=9",
    "2125551234 #9",
  ])("rejects extensions in %s", (input) => {
    expect(normalizeToE164(input, "US")).toEqual({
      ok: false,
      reason: "EXTENSION_NOT_ALLOWED",
    })
  })

  it("rejects empty input", () => {
    expect(normalizeToE164("   ", "US")).toEqual({
      ok: false,
      reason: "EMPTY",
    })
  })

  it("rejects garbage and unsupported characters", () => {
    expect(normalizeToE164("not a phone", "US")).toEqual({
      ok: false,
      reason: "INVALID_CHARACTERS",
    })
    expect(normalizeToE164("+1/212/555/1234", "US")).toEqual({
      ok: false,
      reason: "INVALID_CHARACTERS",
    })
  })

  it("rejects numbers that cannot be parsed", () => {
    expect(normalizeToE164("123", "US")).toEqual({
      ok: false,
      reason: "INVALID_PHONE",
    })
    expect(normalizeToE164("999999999999999999999", "US")).toEqual({
      ok: false,
      reason: "INVALID_PHONE",
    })
  })

  it("rejects parseable but invalid numbers", () => {
    expect(normalizeToE164("+12005550006", "US")).toEqual({
      ok: false,
      reason: "INVALID_PHONE",
    })
  })

  it("reports an invalid default country", () => {
    expect(normalizeToE164("2125551234", "XX" as CountryCode)).toEqual({
      ok: false,
      reason: "INVALID_COUNTRY",
    })
  })
})
