"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { withStaffAuth } from "@/lib/auth"
import { triggerCampaignStart } from "@/lib/n8n/client"
import { isWithinSendingWindow, nextAllowedSendTime } from "@/lib/quiet-hours"
import {
  CampaignIdInput,
  CampaignPreviewInput,
  CancelCampaignInput,
  CreateCampaignInput,
  ManualAssignInput,
} from "@/lib/schemas"
import { db } from "@/lib/supabase/server"
import { clinicLocalDateTimeToUtc } from "@/lib/timezone"
import { parseWavePlan } from "@/lib/wave-plan"

const Template = z.object({
  id: z.string().uuid(),
  label: z.string(),
  procedure_type: z.string(),
  duration_min: z.number().int().positive(),
  wave_plan: z.unknown().nullable(),
})

const Config = z.object({
  timezone: z.string(),
  quiet_hours_start: z.string(),
  quiet_hours_end: z.string(),
  default_wave_plan: z.unknown(),
})

const CampaignId = z.string().uuid()
const EligibleCount = z.coerce.number().int().nonnegative()

type CampaignActionCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DATABASE_ERROR"
  | "N8N_UNAVAILABLE"
  | "STATE_CONFLICT"

type CampaignFailure = Readonly<{
  ok: false
  code: CampaignActionCode
  error: string
  campaignId?: string
}>

function failure(code: CampaignActionCode, error: string, campaignId?: string): CampaignFailure {
  return { ok: false, code, error, campaignId }
}

async function loadTemplateAndConfig(templateId: string) {
  const [templateResult, configResult] = await Promise.all([
    db
      .from("slot_templates")
      .select("id, label, procedure_type, duration_min, wave_plan")
      .eq("id", templateId)
      .eq("active", true)
      .maybeSingle(),
    db
      .from("clinic_config")
      .select("timezone, quiet_hours_start, quiet_hours_end, default_wave_plan")
      .eq("id", true)
      .single(),
  ])

  if (templateResult.error || configResult.error) return null
  const template = Template.safeParse(templateResult.data)
  const config = Config.safeParse(configResult.data)
  if (!template.success || !config.success) return null
  return { template: template.data, config: config.data }
}

export const getCampaignPreview = withStaffAuth(async (_context, raw: unknown) => {
  const parsed = CampaignPreviewInput.safeParse(raw)
  if (!parsed.success) return failure("INVALID_INPUT", "Choose a valid slot template.")

  const loaded = await loadTemplateAndConfig(parsed.data.templateId)
  if (!loaded) return failure("NOT_FOUND", "The selected slot template is unavailable.")

  const plan = parseWavePlan(
    loaded.template.wave_plan ?? loaded.config.default_wave_plan,
  )
  if (!plan.ok) return failure("DATABASE_ERROR", "The configured wave plan is invalid.")

  const { data, error } = await db.rpc("count_eligible_patients", {
    p_procedure_type: loaded.template.procedure_type,
  })
  const count = EligibleCount.safeParse(data)
  if (error || !count.success) {
    return failure("DATABASE_ERROR", "Couldn't count eligible patients.")
  }

  return {
    ok: true as const,
    data: {
      eligibleCount: count.data,
      firstWaveSize: Math.min(plan.plan[0].size, count.data),
      defaultWavePlan: plan.plan,
      timezone: loaded.config.timezone,
    },
  }
})

export const createCampaign = withStaffAuth(async (context, raw: unknown) => {
  const parsed = CreateCampaignInput.safeParse(raw)
  if (!parsed.success) return failure("INVALID_INPUT", "Review the slot details and try again.")

  const loaded = await loadTemplateAndConfig(parsed.data.templateId)
  if (!loaded) return failure("NOT_FOUND", "The selected slot template is unavailable.")

  const plan = parseWavePlan(
    parsed.data.wavePlan ?? loaded.template.wave_plan ?? loaded.config.default_wave_plan,
  )
  if (!plan.ok) return failure("INVALID_INPUT", "The wave plan is invalid.")

  const appointment = clinicLocalDateTimeToUtc(
    parsed.data.appointmentLocal,
    loaded.config.timezone,
  )
  if (!appointment || appointment.getTime() <= Date.now()) {
    return failure("INVALID_INPUT", "Choose a future appointment time in the clinic timezone.")
  }

  const { data, error } = await db.rpc("create_broadcast_campaign", {
    p_appointment_time: appointment.toISOString(),
    p_clinic_timezone: loaded.config.timezone,
    p_procedure_type: loaded.template.procedure_type,
    p_duration_min: loaded.template.duration_min,
    p_wave_plan: plan.plan,
    p_created_by: context.staff.id,
  })
  const campaignId = CampaignId.safeParse(data)
  if (error || !campaignId.success) {
    return failure("DATABASE_ERROR", "The campaign could not be created.")
  }

  const quietStart = loaded.config.quiet_hours_start.slice(0, 5)
  const quietEnd = loaded.config.quiet_hours_end.slice(0, 5)
  const now = new Date()
  const withinWindow = isWithinSendingWindow(
    now,
    loaded.config.timezone,
    quietStart,
    quietEnd,
  )
  const nextAllowedAt = withinWindow
    ? null
    : nextAllowedSendTime(now, loaded.config.timezone, quietStart, quietEnd).toISOString()

  if (nextAllowedAt) {
    const scheduled = await db.rpc("schedule_campaign_start", {
      p_campaign_id: campaignId.data,
      p_next_wave_at: nextAllowedAt,
    })
    if (scheduled.error || scheduled.data !== true) {
      return failure(
        "DATABASE_ERROR",
        "The campaign was saved, but its scheduled start could not be recorded.",
        campaignId.data,
      )
    }
  }

  const triggered = await triggerCampaignStart(campaignId.data)
  revalidatePath("/dashboard")

  if (!triggered.ok) {
    return failure(
      "N8N_UNAVAILABLE",
      "The campaign was saved as a draft, but automation could not start.",
      campaignId.data,
    )
  }

  return {
    ok: true as const,
    data: { campaignId: campaignId.data, nextAllowedAt },
  }
})

export const pauseCampaign = withStaffAuth(async (context, raw: unknown) => {
  const parsed = CampaignIdInput.safeParse(raw)
  if (!parsed.success) return failure("INVALID_INPUT", "Invalid campaign.")

  const { data, error } = await db.rpc("pause_campaign", {
    p_campaign_id: parsed.data.campaignId,
    p_actor_id: context.staff.id,
  })
  if (error) return failure("DATABASE_ERROR", "The campaign could not be paused.")
  if (data !== true) return failure("STATE_CONFLICT", "This campaign can no longer be paused.")

  revalidatePath(`/campaigns/${parsed.data.campaignId}`)
  revalidatePath("/dashboard")
  return { ok: true as const, data: { campaignId: parsed.data.campaignId } }
})

export const cancelCampaign = withStaffAuth(async (context, raw: unknown) => {
  const parsed = CancelCampaignInput.safeParse(raw)
  if (!parsed.success) return failure("INVALID_INPUT", "Enter a cancellation reason.")

  const { data, error } = await db.rpc("cancel_campaign", {
    p_campaign_id: parsed.data.campaignId,
    p_actor_id: context.staff.id,
    p_reason: parsed.data.reason,
  })
  if (error) return failure("DATABASE_ERROR", "The campaign could not be cancelled.")
  if (data !== true) return failure("STATE_CONFLICT", "This campaign is already resolved.")

  revalidatePath(`/campaigns/${parsed.data.campaignId}`)
  revalidatePath("/dashboard")
  return { ok: true as const, data: { campaignId: parsed.data.campaignId } }
})

export const assignCampaignManually = withStaffAuth(async (context, raw: unknown) => {
  const parsed = ManualAssignInput.safeParse(raw)
  if (!parsed.success) return failure("INVALID_INPUT", "Choose a valid patient.")

  const { data, error } = await db.rpc("assign_slot_manually", {
    p_campaign_id: parsed.data.campaignId,
    p_patient_id: parsed.data.patientId,
    p_actor_id: context.staff.id,
  })
  if (error) return failure("DATABASE_ERROR", "The slot could not be assigned.")
  if (data !== true) return failure("STATE_CONFLICT", "Another patient already filled this slot.")

  revalidatePath(`/campaigns/${parsed.data.campaignId}`)
  revalidatePath("/dashboard")
  return { ok: true as const, data: { campaignId: parsed.data.campaignId } }
})
