"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { z } from "zod"

import { withStaffAuth } from "@/lib/auth"
import { clinicConfigTag } from "@/lib/config"
import { db } from "@/lib/supabase/server"
import { WavePlanSchema } from "@/lib/wave-plan"

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const StaffRole = z.enum(["OWNER", "ADMIN", "FRONT_DESK"])

const SaveSettingsInput = z
  .object({
    clinicName: z.string().trim().min(1).max(120),
    timezone: z.string().min(1).refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format()
        return true
      } catch {
        return false
      }
    }),
    quietHoursStart: z.string().regex(timePattern),
    quietHoursEnd: z.string().regex(timePattern),
    maxMessagesPerWeek: z.number().int().min(1).max(20),
    estimatedChairValue: z.number().min(0).max(100_000),
    recallThresholdDays: z.number().int().min(1).max(3_650),
    recallCooldownDays: z.number().int().min(1).max(365),
    defaultWavePlan: WavePlanSchema,
    featureStripeDeposits: z.boolean(),
    featureRecalls: z.boolean(),
    featureReviews: z.boolean(),
  })
  .strict()
  .refine((value) => value.quietHoursStart !== value.quietHoursEnd)

const KillSwitchInput = z
  .object({ paused: z.boolean(), confirmation: z.string() })
  .strict()
  .refine(
    (value) =>
      value.confirmation === (value.paused ? "PAUSE" : "RESUME"),
  )

const SlotTemplateInput = z
  .object({
    id: z.string().uuid().nullable(),
    label: z.string().trim().min(1).max(120),
    procedureType: z.string().trim().min(1).max(80),
    durationMin: z.number().int().min(1).max(480),
    wavePlan: WavePlanSchema.nullable(),
    requiresDeposit: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict()

const ToggleTemplateInput = z
  .object({ id: z.string().uuid(), active: z.boolean() })
  .strict()
const InviteStaffInput = z
  .object({
    email: z.string().trim().email(),
    fullName: z.string().trim().max(120),
    role: StaffRole,
  })
  .strict()
const V2SettingsInput = z
  .object({
    depositAmount: z.number().min(0).max(100_000),
    reviewUrl: z.string().url().refine((value) => value.startsWith("https://")),
    reviewCooldownDays: z.number().int().min(1).max(3_650),
  })
  .strict()
const UpdateStaffInput = z
  .object({
    id: z.string().uuid(),
    email: z.string().trim().email(),
    fullName: z.string().trim().max(120),
    role: StaffRole,
    active: z.boolean(),
  })
  .strict()

type Failure = Readonly<{
  ok: false
  code: "INVALID_INPUT" | "DATABASE_ERROR" | "STATE_CONFLICT"
  error: string
}>

function fail(code: Failure["code"], error: string): Failure {
  return { ok: false, code, error }
}

function refreshSettings(): void {
  revalidateTag(clinicConfigTag)
  revalidatePath("/settings")
  revalidatePath("/dashboard")
}

export const saveClinicSettings = withStaffAuth(
  async (context, raw: unknown) => {
    const parsed = SaveSettingsInput.safeParse(raw)
    if (!parsed.success) return fail("INVALID_INPUT", "Review the clinic settings.")

    const value = parsed.data
    const { data, error } = await db.rpc("save_clinic_settings", {
      p_actor_id: context.staff.id,
      p_clinic_name: value.clinicName,
      p_timezone: value.timezone,
      p_quiet_hours_start: value.quietHoursStart,
      p_quiet_hours_end: value.quietHoursEnd,
      p_max_messages_per_week: value.maxMessagesPerWeek,
      p_estimated_chair_value: value.estimatedChairValue,
      p_recall_threshold_days: value.recallThresholdDays,
      p_recall_cooldown_days: value.recallCooldownDays,
      p_default_wave_plan: value.defaultWavePlan,
      p_feature_stripe_deposits: value.featureStripeDeposits,
      p_feature_recalls: value.featureRecalls,
      p_feature_reviews: value.featureReviews,
    })
    if (error) return fail("DATABASE_ERROR", "Couldn't save clinic settings.")
    if (data !== true) return fail("INVALID_INPUT", "The clinic settings are invalid.")
    refreshSettings()
    return { ok: true as const, data: { saved: true } }
  },
  { allowedRoles: ["OWNER", "ADMIN"] },
)

export const toggleAutomation = withStaffAuth(
  async (context, raw: unknown) => {
    const parsed = KillSwitchInput.safeParse(raw)
    if (!parsed.success) return fail("INVALID_INPUT", "Type the required confirmation.")

    const { data, error } = await db.rpc("set_automation_paused", {
      p_actor_id: context.staff.id,
      p_paused: parsed.data.paused,
    })
    if (error) return fail("DATABASE_ERROR", "Couldn't change automation state.")
    if (data !== true) return fail("STATE_CONFLICT", "Automation is already in that state.")
    refreshSettings()
    return { ok: true as const, data: { paused: parsed.data.paused } }
  },
  { allowedRoles: ["OWNER", "ADMIN"] },
)

export const saveSlotTemplate = withStaffAuth(
  async (context, raw: unknown) => {
    const parsed = SlotTemplateInput.safeParse(raw)
    if (!parsed.success) return fail("INVALID_INPUT", "Review the slot template.")

    const value = parsed.data
    const { data, error } = await db.rpc("upsert_slot_template", {
      p_id: value.id,
      p_actor_id: context.staff.id,
      p_label: value.label,
      p_procedure_type: value.procedureType,
      p_duration_min: value.durationMin,
      p_wave_plan: value.wavePlan,
      p_requires_deposit: value.requiresDeposit,
      p_sort_order: value.sortOrder,
    })
    if (error || !z.string().uuid().safeParse(data).success) {
      return fail("DATABASE_ERROR", "Couldn't save the slot template.")
    }
    revalidatePath("/settings")
    revalidatePath("/campaigns/new")
    return { ok: true as const, data: { id: String(data) } }
  },
  { allowedRoles: ["OWNER", "ADMIN"] },
)

export const setSlotTemplateActive = withStaffAuth(
  async (context, raw: unknown) => {
    const parsed = ToggleTemplateInput.safeParse(raw)
    if (!parsed.success) return fail("INVALID_INPUT", "Invalid slot template.")
    const { data, error } = await db.rpc("set_slot_template_active", {
      p_id: parsed.data.id,
      p_actor_id: context.staff.id,
      p_active: parsed.data.active,
    })
    if (error || data !== true) return fail("DATABASE_ERROR", "Couldn't update the template.")
    revalidatePath("/settings")
    revalidatePath("/campaigns/new")
    return { ok: true as const, data: { active: parsed.data.active } }
  },
  { allowedRoles: ["OWNER", "ADMIN"] },
)

export const inviteStaffMember = withStaffAuth(
  async (context, raw: unknown) => {
    const parsed = InviteStaffInput.safeParse(raw)
    if (!parsed.success) return fail("INVALID_INPUT", "Review the staff invitation.")

    const invited = await db.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: { full_name: parsed.data.fullName },
    })
    if (invited.error || !invited.data.user) {
      return fail("DATABASE_ERROR", "Couldn't send the staff invitation.")
    }

    const { data, error } = await db.rpc("upsert_staff_member", {
      p_staff_id: invited.data.user.id,
      p_actor_id: context.staff.id,
      p_email: parsed.data.email,
      p_full_name: parsed.data.fullName,
      p_role: parsed.data.role,
      p_active: true,
    })
    if (error || data !== true) return fail("DATABASE_ERROR", "Invitation sent, but staff setup failed.")
    revalidatePath("/settings")
    return { ok: true as const, data: { id: invited.data.user.id } }
  },
  { allowedRoles: ["OWNER"] },
)

export const saveV2Settings = withStaffAuth(
  async (context, raw: unknown) => {
    const parsed = V2SettingsInput.safeParse(raw)
    if (!parsed.success) return fail("INVALID_INPUT", "Review the V2 settings.")
    const { data, error } = await db.rpc("save_v2_settings", {
      p_actor_id: context.staff.id,
      p_deposit_amount: parsed.data.depositAmount,
      p_review_url: parsed.data.reviewUrl,
      p_review_cooldown_days: parsed.data.reviewCooldownDays,
    })
    if (error || data !== true) return fail("DATABASE_ERROR", "Couldn't save V2 settings.")
    refreshSettings()
    return { ok: true as const, data: { saved: true } }
  },
  { allowedRoles: ["OWNER", "ADMIN"] },
)

export const updateStaffMember = withStaffAuth(
  async (context, raw: unknown) => {
    const parsed = UpdateStaffInput.safeParse(raw)
    if (!parsed.success) return fail("INVALID_INPUT", "Review the staff settings.")
    const value = parsed.data
    const { data, error } = await db.rpc("upsert_staff_member", {
      p_staff_id: value.id,
      p_actor_id: context.staff.id,
      p_email: value.email,
      p_full_name: value.fullName,
      p_role: value.role,
      p_active: value.active,
    })
    if (error) return fail("DATABASE_ERROR", "Couldn't update the staff member.")
    if (data !== true) return fail("STATE_CONFLICT", "You cannot deactivate your own account.")
    revalidatePath("/settings")
    return { ok: true as const, data: { id: value.id } }
  },
  { allowedRoles: ["OWNER"] },
)
