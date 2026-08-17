import { describe, expect, it } from "vitest"

import { computeTwilioSignature, verifyTwilioSignature } from "./twilio-signature"

describe("Twilio signature verification", () => {
  const token = "test-auth-token"
  const url = "https://n8n.example.test/webhook/twilio-inbound"
  const parameters = {
    Body: "YES",
    From: "+15005550006",
    MessageSid: "SM_TEST_001",
  }

  it("sorts form parameters and produces a SHA-1 base64 signature", () => {
    expect(computeTwilioSignature(token, url, parameters)).toMatch(
      /^[A-Za-z0-9+/]+={0,2}$/,
    )
    expect(computeTwilioSignature(token, url, parameters)).toBe(
      computeTwilioSignature(token, url, {
        MessageSid: "SM_TEST_001",
        Body: "YES",
        From: "+15005550006",
      }),
    )
  })

  it("accepts the exact request and rejects changed or malformed signatures", () => {
    const signature = computeTwilioSignature(token, url, parameters)
    expect(verifyTwilioSignature(token, url, parameters, signature)).toBe(true)
    expect(
      verifyTwilioSignature(token, url, { ...parameters, Body: "STOP" }, signature),
    ).toBe(false)
    expect(verifyTwilioSignature(token, url, parameters, "bad")).toBe(false)
  })
})
