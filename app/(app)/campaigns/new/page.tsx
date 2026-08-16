import { z } from "zod"

import { NewCampaignForm } from "@/components/campaigns/new-campaign-form"
import { db } from "@/lib/supabase/server"
import { parseWavePlan } from "@/lib/wave-plan"

export const dynamic = "force-dynamic"

const Template = z.object({
  id: z.string().uuid(),
  label: z.string(),
  procedure_type: z.string(),
  duration_min: z.number().int().positive(),
})

const Config = z.object({
  timezone: z.string(),
  default_wave_plan: z.unknown(),
})

function suggestedLocalTime(timezone: string): string {
  const rounded = new Date(Math.ceil((Date.now() + 30 * 60_000) / 1_800_000) * 1_800_000)
  const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(rounded)
      .filter((part) => ["year", "month", "day", "hour", "minute"].includes(part.type))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export default async function NewCampaignPage() {
  const [templatesResult, configResult] = await Promise.all([
    db
      .from("slot_templates")
      .select("id, label, procedure_type, duration_min")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    db
      .from("clinic_config")
      .select("timezone, default_wave_plan")
      .eq("id", true)
      .single(),
  ])

  const templates = z.array(Template).safeParse(templatesResult.data)
  const config = Config.safeParse(configResult.data)
  if (templatesResult.error || configResult.error || !templates.success || !config.success) {
    throw new Error("Unable to load campaign setup")
  }
  const plan = parseWavePlan(config.data.default_wave_plan)
  if (!plan.ok) throw new Error("The configured wave plan is invalid")

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-brand">Fill a chair</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">New opening</h1>
        <p className="mt-1 text-base text-fg-muted">Choose the slot, time, and wave plan.</p>
      </header>
      <NewCampaignForm
        templates={templates.data}
        timezone={config.data.timezone}
        initialLocalTime={suggestedLocalTime(config.data.timezone)}
        defaultWavePlan={plan.plan}
      />
    </div>
  )
}
