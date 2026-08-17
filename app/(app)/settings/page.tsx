import { z } from "zod"

import { ClinicSettingsForm } from "@/components/settings/clinic-settings-form"
import { KillSwitchCard } from "@/components/settings/kill-switch-card"
import {
  SlotTemplateSettings,
  type SlotTemplateSetting,
} from "@/components/settings/slot-template-settings"
import { StaffSettings, type StaffSetting } from "@/components/settings/staff-settings"
import { EmptyState } from "@/components/ui/empty-state"
import { resolveStaffAuth } from "@/lib/auth"
import { getClinicConfig } from "@/lib/config"
import { db } from "@/lib/supabase/server"
import { parseWavePlan } from "@/lib/wave-plan"

export const dynamic = "force-dynamic"

const Template = z.object({
  id: z.string().uuid(),
  label: z.string(),
  procedure_type: z.string(),
  duration_min: z.number().int(),
  wave_plan: z.unknown().nullable(),
  requires_deposit: z.boolean(),
  sort_order: z.number().int(),
  active: z.boolean(),
})
const Staff = z.object({
  id: z.string().uuid(),
  email: z.string(),
  full_name: z.string().nullable(),
  role: z.enum(["OWNER", "ADMIN", "FRONT_DESK"]),
  active: z.boolean(),
})
const KillAudit = z.object({ actor_id: z.string().uuid().nullable(), created_at: z.string() })

export default async function SettingsPage() {
  const auth = await resolveStaffAuth()
  if (!auth.ok) throw new Error("Unable to verify settings access")
  const canConfigure = auth.data.staff.role === "OWNER" || auth.data.staff.role === "ADMIN"

  if (!canConfigure) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-fg">Settings</h1>
        <EmptyState title="Administrator access required" description="Ask a clinic owner or administrator to change operational settings." />
      </div>
    )
  }

  const [config, templatesResult, staffResult, auditResult] = await Promise.all([
    getClinicConfig(),
    db
      .from("slot_templates")
      .select("id, label, procedure_type, duration_min, wave_plan, requires_deposit, sort_order, active")
      .order("sort_order", { ascending: true }),
    db
      .from("staff")
      .select("id, email, full_name, role, active")
      .order("created_at", { ascending: true }),
    db
      .from("audit_events")
      .select("actor_id, created_at")
      .eq("event_type", "KILL_SWITCH_TOGGLED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const templates = z.array(Template).safeParse(templatesResult.data)
  const staff = z.array(Staff).safeParse(staffResult.data)
  const audit = auditResult.data ? KillAudit.safeParse(auditResult.data) : null
  if (templatesResult.error || staffResult.error || auditResult.error || !templates.success || !staff.success || (audit && !audit.success)) {
    throw new Error("Unable to load settings")
  }

  const templateSettings: SlotTemplateSetting[] = templates.data.map((template) => {
    const plan = template.wave_plan ? parseWavePlan(template.wave_plan) : null
    if (plan && !plan.ok) throw new Error("Slot template wave plan is invalid")
    return {
      id: template.id,
      label: template.label,
      procedureType: template.procedure_type,
      durationMin: template.duration_min,
      wavePlan: plan?.ok ? plan.plan : null,
      requiresDeposit: template.requires_deposit,
      sortOrder: template.sort_order,
      active: template.active,
    }
  })
  const staffSettings: StaffSetting[] = staff.data.map((member) => ({
    id: member.id,
    email: member.email,
    fullName: member.full_name,
    role: member.role,
    active: member.active,
  }))
  const auditData = audit?.success ? audit.data : null
  const enabledBy = auditData?.actor_id
    ? staff.data.find((member) => member.id === auditData.actor_id)?.full_name ?? null
    : null

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="mt-1 text-base text-fg-muted">Clinic operations, messaging limits, templates, and staff access.</p>
      </header>
      <ClinicSettingsForm config={config} />
      <SlotTemplateSettings templates={templateSettings} />
      {auth.data.staff.role === "OWNER" ? <StaffSettings members={staffSettings} /> : null}
      <KillSwitchCard
        paused={config.automation_paused}
        enabledAt={config.automation_paused ? auditData?.created_at ?? null : null}
        enabledBy={config.automation_paused ? enabledBy : null}
      />
    </div>
  )
}
