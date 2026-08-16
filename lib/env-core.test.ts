import { describe, expect, it } from "vitest"

import { validateServerEnv } from "./env-core"

const validEnvironment: Readonly<Record<string, string>> = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  N8N_BASE_URL: "https://example.app.n8n.cloud",
  N8N_SHARED_SECRET: "shared-secret",
  CLINIC_NAME: "Example Dental",
  CLINIC_TIMEZONE: "America/New_York",
  QUIET_HOURS_START: "08:00",
  QUIET_HOURS_END: "20:00",
  MAX_MESSAGES_PER_WEEK: "3",
  ESTIMATED_CHAIR_VALUE: "350.00",
  FEATURE_STRIPE_DEPOSITS: "false",
  FEATURE_RECALLS: "false",
  FEATURE_REVIEWS: "TRUE",
}

function withEnvironment(
  changes: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return { ...validEnvironment, ...changes }
}

describe("server environment validation", () => {
  it("returns normalized typed values for valid configuration", () => {
    const result = validateServerEnv(validEnvironment)

    expect(result.MAX_MESSAGES_PER_WEEK).toBe(3)
    expect(result.ESTIMATED_CHAIR_VALUE).toBe(350)
    expect(result.FEATURE_STRIPE_DEPOSITS).toBe(false)
    expect(result.FEATURE_REVIEWS).toBe(true)
  })

  it("lists every missing variable in a readable error", () => {
    for (const variableName of Object.keys(validEnvironment)) {
      expect(() => validateServerEnv({})).toThrowError(variableName)
    }
  })

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      validateServerEnv(withEnvironment({ CLINIC_TIMEZONE: "Not/A_Timezone" })),
    ).toThrowError(/CLINIC_TIMEZONE: must be a valid IANA timezone/)
  })

  it("rejects non-HTTP service URLs", () => {
    expect(() =>
      validateServerEnv(withEnvironment({ N8N_BASE_URL: "ftp://example.com" })),
    ).toThrowError(/N8N_BASE_URL: must use http or https/)
  })

  it("rejects blank secrets and numeric values", () => {
    expect(() =>
      validateServerEnv(
        withEnvironment({
          SUPABASE_SERVICE_ROLE_KEY: "   ",
          ESTIMATED_CHAIR_VALUE: " ",
        }),
      ),
    ).toThrowError(/SUPABASE_SERVICE_ROLE_KEY: must not be empty/)

    expect(() =>
      validateServerEnv(withEnvironment({ ESTIMATED_CHAIR_VALUE: " " })),
    ).toThrowError(/ESTIMATED_CHAIR_VALUE: must be a nonnegative number/)
  })

  it("rejects malformed quiet hours and feature flags", () => {
    expect(() =>
      validateServerEnv(
        withEnvironment({
          QUIET_HOURS_START: "24:00",
          FEATURE_RECALLS: "enabled",
        }),
      ),
    ).toThrowError(/QUIET_HOURS_START: must use 24-hour HH:MM format/)

    expect(() =>
      validateServerEnv(withEnvironment({ FEATURE_RECALLS: "enabled" })),
    ).toThrowError(/FEATURE_RECALLS: must be either true or false/)
  })
})
