import { z } from "zod"

const PublicEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

const parsed = PublicEnv.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})

if (!parsed.success) {
  const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")
  throw new Error(`Invalid public environment configuration: ${names}`)
}

export const publicEnv = parsed.data
