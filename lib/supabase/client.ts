"use client"

import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

import { publicEnv } from "@/lib/public-env"

let realtimeClient: SupabaseClient | undefined

export function getRealtimeClient(): SupabaseClient {
  realtimeClient ??= createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )

  return realtimeClient
}
