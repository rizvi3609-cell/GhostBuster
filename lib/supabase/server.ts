import "server-only"

import { createClient } from "@supabase/supabase-js"

import { env } from "@/lib/env"

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
})
