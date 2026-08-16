import { z } from "zod"

const PublicEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol
      return protocol === "http:" || protocol === "https:"
    }, "must use http or https"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .refine((value) => value.trim().length > 0, "must not be empty"),
})

const parsed = PublicEnv.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => {
    const name = issue.path.join(".") || "environment"
    return `- ${name}: ${issue.message}`
  })

  throw new Error(
    ["Invalid public environment configuration:", ...details].join("\n"),
  )
}

export const publicEnv = parsed.data
