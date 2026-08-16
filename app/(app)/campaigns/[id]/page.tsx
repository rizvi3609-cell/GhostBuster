import { notFound } from "next/navigation"
import { z } from "zod"

import { CampaignActions } from "@/components/campaigns/campaign-actions"
import { CountdownTimer } from "@/components/campaigns/countdown-timer"
import { PhoneDisplay } from "@/components/patients/phone-display"
import { db } from "@/lib/supabase/server"
import { parseWavePlan } from "@/lib/wave-plan"

const Campaign = z.object({
  id: z.string().uuid(),
  appointment_time: z.string(),
  clinic_timezone: z.string(),
  procedure_type: z.string(),
  duration_min: z.number().int(),
  status: z.enum(["DRAFT", "OPEN", "ESCALATING", "PENDING_PAYMENT", "FILLED", "EXPIRED", "CANCELLED"]),
  wave_plan: z.unknown(),
  current_wave: z.number().int(),
  claimed_by: z.string().uuid().nullable(),
  claimed_at: z.string().nullable(),
  next_wave_at: z.string().nullable(),
})
const Recipient = z.object({
  patient_id: z.string().uuid(),
  wave_number: z.number().int(),
  send_order: z.number().int(),
  send_status: z.enum(["PENDING", "SENT", "FAILED", "SKIPPED"]),
  sent_at: z.string().nullable(),
})
const Patient = z.object({ id: z.string().uuid(), full_name: z.string(), phone_number: z.string() })
const SmsLog = z.object({
  patient_id: z.string().uuid().nullable(),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "UNDELIVERED", "FAILED", "RECEIVED"]),
  error_code: z.string().nullable(),
  created_at: z.string(),
})
const Audit = z.object({ event_type: z.string(), metadata: z.record(z.string(), z.unknown()), created_at: z.string() })

const statusLabels: Record<z.infer<typeof Campaign>["status"], string> = {
  DRAFT: "Draft / paused",
  OPEN: "Open",
  ESCALATING: "Escalating",
  PENDING_PAYMENT: "Awaiting deposit",
  FILLED: "Filled",
  EXPIRED: "Not filled",
  CANCELLED: "Cancelled",
}

function clinicDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value))
}

function auditText(event: z.infer<typeof Audit>, timezone: string): string {
  const labels: Record<string, string> = {
    CAMPAIGN_CREATED: "Campaign created",
    CAMPAIGN_PAUSED: "Campaign paused",
    CAMPAIGN_CANCELLED: "Campaign cancelled",
    SLOT_CLAIMED: "Slot claimed by SMS",
    SLOT_ASSIGNED_MANUALLY: "Slot assigned manually",
    WAVE_SENT: "Wave sent",
  }
  return `${labels[event.event_type] ?? event.event_type} · ${clinicDate(event.created_at, timezone)}`
}

type CampaignPageProps = Readonly<{ params: Promise<{ id: string }> }>

export default async function CampaignDetailPage({ params }: CampaignPageProps) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()

  const [campaignResult, recipientResult, smsResult, auditResult] = await Promise.all([
    db
      .from("broadcast_campaigns")
      .select("id, appointment_time, clinic_timezone, procedure_type, duration_min, status, wave_plan, current_wave, claimed_by, claimed_at, next_wave_at")
      .eq("id", id)
      .maybeSingle(),
    db
      .from("campaign_recipients")
      .select("patient_id, wave_number, send_order, send_status, sent_at")
      .eq("campaign_id", id)
      .order("wave_number", { ascending: true })
      .order("send_order", { ascending: true }),
    db
      .from("sms_logs")
      .select("patient_id, status, error_code, created_at")
      .eq("campaign_id", id)
      .eq("direction", "OUTBOUND")
      .order("created_at", { ascending: false }),
    db
      .from("audit_events")
      .select("event_type, metadata, created_at")
      .eq("entity_type", "campaign")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
  ])

  if (campaignResult.error || !campaignResult.data) notFound()
  if (recipientResult.error || smsResult.error || auditResult.error) throw new Error("Unable to load campaign")

  const campaign = Campaign.safeParse(campaignResult.data)
  const recipients = z.array(Recipient).safeParse(recipientResult.data)
  const logs = z.array(SmsLog).safeParse(smsResult.data)
  const audits = z.array(Audit).safeParse(auditResult.data)
  if (!campaign.success || !recipients.success || !logs.success || !audits.success) {
    throw new Error("Campaign data is invalid")
  }

  const patientIds = Array.from(new Set([
    ...recipients.data.map((recipient) => recipient.patient_id),
    ...(campaign.data.claimed_by ? [campaign.data.claimed_by] : []),
  ]))
  const patientResult = patientIds.length
    ? await db.from("patients").select("id, full_name, phone_number").in("id", patientIds)
    : { data: [], error: null }
  const patients = z.array(Patient).safeParse(patientResult.data)
  if (patientResult.error || !patients.success) throw new Error("Unable to load campaign patients")

  const patientMap = new Map(patients.data.map((patient) => [patient.id, patient]))
  const latestStatus = new Map<string, z.infer<typeof SmsLog>>()
  logs.data.forEach((log) => {
    if (log.patient_id && !latestStatus.has(log.patient_id)) latestStatus.set(log.patient_id, log)
  })
  const plan = parseWavePlan(campaign.data.wave_plan)
  if (!plan.ok) throw new Error("Campaign wave plan is invalid")
  const winner = campaign.data.claimed_by ? patientMap.get(campaign.data.claimed_by) : null

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand">{campaign.data.procedure_type}</p>
            <h1 className="mt-1 text-2xl font-semibold text-fg">{clinicDate(campaign.data.appointment_time, campaign.data.clinic_timezone)}</h1>
            <p className="mt-1 text-base text-fg-muted">{campaign.data.duration_min} minutes</p>
          </div>
          <span className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold text-fg">{statusLabels[campaign.data.status]}</span>
        </div>
        <CampaignActions
          campaignId={campaign.data.id}
          status={campaign.data.status}
          recipients={recipients.data.map((recipient) => {
            const patient = patientMap.get(recipient.patient_id)
            return { id: recipient.patient_id, label: patient ? `${patient.full_name} · ${patient.phone_number.slice(-4)}` : "Unknown patient" }
          })}
        />
      </header>

      {campaign.data.status === "DRAFT" && campaign.data.next_wave_at ? (
        <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-fg">
          Outside sending hours. Scheduled start: <CountdownTimer target={campaign.data.next_wave_at} />
        </div>
      ) : null}
      {campaign.data.status === "ESCALATING" || campaign.data.status === "OPEN" ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-fg">
          Next wave: <CountdownTimer target={campaign.data.next_wave_at} />
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Wave timeline</h2>
        <div className="mt-5 space-y-6">
          {plan.plan.map((wave, index) => {
            const waveNumber = index + 1
            const waveRecipients = recipients.data.filter((recipient) => recipient.wave_number === waveNumber)
            return (
              <div key={waveNumber} className="grid grid-cols-[24px_1fr] gap-3">
                <div className={`mt-1 size-4 rounded-full border-2 ${waveRecipients.length ? "border-brand bg-brand" : "border-border-strong bg-surface"}`} />
                <div>
                  <p className="font-semibold text-fg">Wave {waveNumber} · {wave.size} patients · wait {wave.delay_min} min</p>
                  {waveRecipients.length ? (
                    <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                      {waveRecipients.map((recipient) => {
                        const patient = patientMap.get(recipient.patient_id)
                        const delivery = latestStatus.get(recipient.patient_id)
                        return (
                          <li key={recipient.patient_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                            <span className="font-medium text-fg">{patient?.full_name ?? "Unknown"} {patient ? <PhoneDisplay phone={patient.phone_number} /> : null}</span>
                            <span className={delivery?.status === "FAILED" || delivery?.status === "UNDELIVERED" ? "text-danger" : "text-fg-muted"}>
                              {delivery?.status ?? recipient.send_status}{delivery?.error_code ? ` · ${delivery.error_code}` : ""}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : <p className="mt-2 text-sm text-fg-subtle">Not sent</p>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {winner ? (
        <section className="rounded-xl border border-success/30 bg-success/10 p-5">
          <h2 className="text-lg font-semibold text-fg">Winner</h2>
          <p className="mt-2 font-medium text-fg">{winner.full_name} · <PhoneDisplay phone={winner.phone_number} /></p>
          {campaign.data.claimed_at ? <p className="mt-1 text-sm text-fg-muted">Filled {clinicDate(campaign.data.claimed_at, campaign.data.clinic_timezone)}</p> : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-fg">Audit trail</h2>
        {audits.data.length ? <ul className="mt-3 space-y-2 text-sm text-fg-muted">{audits.data.map((event, index) => <li key={`${event.created_at}-${index}`}>{auditText(event, campaign.data.clinic_timezone)}</li>)}</ul> : <p className="mt-2 text-sm text-fg-subtle">No activity recorded.</p>}
      </section>
    </div>
  )
}
