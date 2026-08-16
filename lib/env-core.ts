import { z } from "zod"

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const featureFlag = z
  .enum(["true", "false"], {
    error: "must be either true or false",
  })
  .transform((value) => value === "true")

export const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  N8N_BASE_URL: z.string().url(),
  N8N_SHARED_SECRET: z.string().min(1),
  CLINIC_NAME: z.string().min(1),
  CLINIC_TIMEZONE: z.string().min(1),
  QUIET_HOURS_START: z.string().regex(timePattern, "must use 24-hour HH:MM format"),
  QUIET_HOURS_END: z.string().regex(timePattern, "must use 24-hour HH:MM format"),
  MAX_MESSAGES_PER_WEEK: z.coerce.number().int().positive(),
  ESTIMATED_CHAIR_VALUE: z.coerce.number().nonnegative(),
  FEATURE_STRIPE_DEPOSITS: featureFlag,
  FEATURE_RECALLS: featureFlag,
  FEATURE_REVIEWS: featureFlag,
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function validateServerEnv(
  source: Readonly<Record<string, string | undefined>>,
): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source)

  if (parsed.success) return parsed.data

  const details = parsed.error.issues.map((issue) => {
    const name = issue.path.join(".") || "environment"
    const missing = issue.code === "invalid_type" && issue.input === undefined
    return `- ${name}: ${missing ? "is required" : issue.message}`
  })

  throw new Error(
    ["Invalid server environment configuration:", ...details].join("\n"),
  )
}
