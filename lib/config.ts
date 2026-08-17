import "server-only"

import { unstable_cache } from "next/cache"
import { z } from "zod"

import { db } from "@/lib/supabase/server"
import { WavePlanSchema } from "@/lib/wave-plan"

const ClinicConfig = z.object({
  clinic_name: z.string(),
  timezone: z.string(),
  quiet_hours_start: z.string(),
  quiet_hours_end: z.string(),
  max_messages_per_week: z.number().int(),
  estimated_chair_value: z.coerce.number(),
  recall_threshold_days: z.number().int(),
  recall_cooldown_days: z.number().int(),
  default_wave_plan: WavePlanSchema,
  automation_paused: z.boolean(),
  feature_stripe_deposits: z.boolean(),
  feature_recalls: z.boolean(),
  feature_reviews: z.boolean(),
  deposit_amount: z.coerce.number(),
  review_url: z.string().url(),
  review_cooldown_days: z.number().int(),
  updated_at: z.string(),
})

export type ClinicConfig = z.infer<typeof ClinicConfig>
export const clinicConfigTag = "clinic-config"

const readClinicConfig = unstable_cache(
  async (): Promise<ClinicConfig> => {
    const { data, error } = await db
      .from("clinic_config")
      .select(
        "clinic_name, timezone, quiet_hours_start, quiet_hours_end, max_messages_per_week, estimated_chair_value, recall_threshold_days, recall_cooldown_days, default_wave_plan, automation_paused, feature_stripe_deposits, feature_recalls, feature_reviews, deposit_amount, review_url, review_cooldown_days, updated_at",
      )
      .eq("id", true)
      .single()
    if (error) throw new Error("Unable to load clinic configuration")
    const parsed = ClinicConfig.safeParse(data)
    if (!parsed.success) throw new Error("Clinic configuration is invalid")
    return parsed.data
  },
  ["clinic-config-v1"],
  { tags: [clinicConfigTag] },
)

export function getClinicConfig(): Promise<ClinicConfig> {
  return readClinicConfig()
}
