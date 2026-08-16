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
  FEATURE_REVIEWS: "true",
}

describe("server environment validation", () => {
  it("returns typed numbers and feature flags for valid configuration", () => {
    const result = validateServerEnv(validEnvironment)

    expect(result.MAX_MESSAGES_PER_WEEK).toBe(3)
    expect(result.ESTIMATED_CHAIR_VALUE).toBe(350)
    expect(result.FEATURE_STRIPE_DEPOSITS).toBe(false)
    expect(result.FEATURE_REVIEWS).toBe(true)
  })

  it("lists missing variables in a readable error", () => {
    expect(() => validateServerEnv({})).toThrowError(
      /Invalid server environment configuration:\n- SUPABASE_URL: is required/,
    )
  })
})
