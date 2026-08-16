import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({
  env: {
    N8N_BASE_URL: "https://n8n.example.test",
    N8N_SHARED_SECRET: "test-shared-secret",
  },
}))

import { signN8nPayload, triggerCampaignStart } from "./client"

describe("n8n campaign-start client", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("signs the timestamp and exact raw body", () => {
    const body = '{"campaignId":"campaign-id"}'
    const expected = createHmac("sha256", "secret")
      .update(`1700000000.${body}`)
      .digest("hex")

    expect(signN8nPayload(body, "1700000000", "secret")).toBe(expected)
  })

  it("sends a signed JSON request without exposing the secret", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000)
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, executionId: "execution-1" }), {
        status: 200,
      }),
    )

    await expect(triggerCampaignStart("campaign-id")).resolves.toEqual({
      ok: true,
      executionId: "execution-1",
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(options?.body).toBe('{"campaignId":"campaign-id"}')
    expect(options?.headers).toMatchObject({
      "X-Ghostbuster-Timestamp": "1700000000",
      "X-Ghostbuster-Signature": expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(options)).not.toContain("test-shared-secret")
  })

  it("returns error values for network, HTTP, and malformed responses", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"))
    await expect(triggerCampaignStart("campaign-id")).resolves.toEqual({
      ok: false,
      code: "N8N_UNAVAILABLE",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("no", { status: 500 }))
    await expect(triggerCampaignStart("campaign-id")).resolves.toEqual({
      ok: false,
      code: "N8N_UNAVAILABLE",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not-json"))
    await expect(triggerCampaignStart("campaign-id")).resolves.toEqual({
      ok: false,
      code: "INVALID_RESPONSE",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: true })),
    )
    await expect(triggerCampaignStart("campaign-id")).resolves.toEqual({
      ok: false,
      code: "INVALID_RESPONSE",
    })
  })
})
