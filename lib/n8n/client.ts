import "server-only"

import { createHmac } from "node:crypto"
import { z } from "zod"

import { env } from "@/lib/env"

const CampaignStartResponse = z.object({
  accepted: z.literal(true),
  executionId: z.string().optional(),
})

export type N8nCallResult =
  | { ok: true; executionId: string | null }
  | { ok: false; code: "N8N_UNAVAILABLE" | "INVALID_RESPONSE" }

export function signN8nPayload(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")
}

export async function triggerCampaignStart(campaignId: string): Promise<N8nCallResult> {
  const rawBody = JSON.stringify({ campaignId })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signN8nPayload(rawBody, timestamp, env.N8N_SHARED_SECRET)

  let response: Response
  try {
    response = await fetch(new URL("/webhook/campaign-start", env.N8N_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ghostbuster-Signature": signature,
        "X-Ghostbuster-Timestamp": timestamp,
      },
      body: rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { ok: false, code: "N8N_UNAVAILABLE" }
  }

  if (!response.ok) return { ok: false, code: "N8N_UNAVAILABLE" }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, code: "INVALID_RESPONSE" }
  }

  const parsed = CampaignStartResponse.safeParse(body)
  if (!parsed.success) return { ok: false, code: "INVALID_RESPONSE" }

  return {
    ok: true,
    executionId: parsed.data.executionId ?? null,
  }
}
