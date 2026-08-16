import { z } from "zod"

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const nonnegativeDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const positiveIntegerPattern = /^[1-9]\d*$/

const requiredText = z.string().trim().min(1)

const requiredSecret = z
  .string()
  .refine((value) => value.trim().length > 0, "must not be empty")

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  }, "must use http or https")

const ianaTimezone = requiredText.refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}, "must be a valid IANA timezone")

const featureFlag = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.enum(["true", "false"], {
      error: "must be either true or false",
    }),
  )
  .transform((value) => value === "true")

const positiveInteger = z
  .string()
  .trim()
  .regex(positiveIntegerPattern, "must be a positive integer")
  .transform(Number)

const nonnegativeDecimal = z
  .string()
  .trim()
  .regex(nonnegativeDecimalPattern, "must be a nonnegative number")
  .transform(Number)

export const serverEnvSchema = z.object({
  SUPABASE_URL: httpUrl,
  SUPABASE_SERVICE_ROLE_KEY: requiredSecret,
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredSecret,
  N8N_BASE_URL: httpUrl,
  N8N_SHARED_SECRET: requiredSecret,
  CLINIC_NAME: requiredText,
  CLINIC_TIMEZONE: ianaTimezone,
  QUIET_HOURS_START: z.string().trim().regex(timePattern, "must use 24-hour HH:MM format"),
  QUIET_HOURS_END: z.string().trim().regex(timePattern, "must use 24-hour HH:MM format"),
  MAX_MESSAGES_PER_WEEK: positiveInteger,
  ESTIMATED_CHAIR_VALUE: nonnegativeDecimal,
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
