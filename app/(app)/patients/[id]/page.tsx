import { notFound } from "next/navigation"
import { z } from "zod"

import { ConsentBadge } from "@/components/patients/consent-badge"
import { PhoneDisplay } from "@/components/patients/phone-display"
import { ReliabilityEditor } from "@/components/patients/reliability-editor"
import { db } from "@/lib/supabase/server"

const Patient = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  phone_number: z.string(),
  consent_status: z.enum(["UNKNOWN", "GRANTED", "REVOKED"]),
  opted_out: z.boolean(),
  reliability_score: z.number().int(),
  reliability_override: z.number().int().nullable(),
  reliability_override_reason: z.string().nullable(),
  last_visit_date: z.string().nullable(),
  preferred_procedures: z.array(z.string()),
})
const Components = z.object({
  successful_claims: z.coerce.number().int(),
  prior_claims_points: z.number().int(),
  days_since_last_visit: z.number().int(),
  recency_points: z.number().int(),
  procedure_match_points: z.number().int(),
  messages_last_7d: z.coerce.number().int(),
  contact_restraint_points: z.number().int(),
  computed_score: z.number().int(),
  override_score: z.number().int().nullable(),
  effective_score: z.number().int(),
  override_reason: z.string().nullable(),
})
const Sms = z.object({
  id: z.string().uuid(),
  direction: z.enum(["OUTBOUND", "INBOUND"]),
  status: z.string(),
  message_body: z.string().nullable(),
  created_at: z.string(),
})

function Points({ label, points, detail, maximum }: Readonly<{ label: string; points: number; detail: string; maximum: number }>) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-fg">{label}</p>
        <p className="font-semibold tabular-nums text-brand">{points}/{maximum}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-brand" style={{ width: `${maximum ? points / maximum * 100 : 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-fg-muted">{detail}</p>
    </div>
  )
}

type PatientPageProps = Readonly<{ params: Promise<{ id: string }> }>

export default async function PatientDetailPage({ params }: PatientPageProps) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()

  const [patientResult, componentResult, offeredResult, claimedResult, smsResult] = await Promise.all([
    db
      .from("patients")
      .select("id, full_name, phone_number, consent_status, opted_out, reliability_score, reliability_override, reliability_override_reason, last_visit_date, preferred_procedures")
      .eq("id", id)
      .maybeSingle(),
    db.rpc("get_patient_reliability_components", {
      p_patient_id: id,
      p_procedure_type: null,
    }),
    db
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", id),
    db
      .from("broadcast_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("claimed_by", id),
    db
      .from("sms_logs")
      .select("id, direction, status, message_body, created_at")
      .eq("patient_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  if (!patientResult.data || patientResult.error) notFound()
  if (componentResult.error || offeredResult.error || claimedResult.error || smsResult.error) {
    throw new Error("Unable to load patient details")
  }
  const patient = Patient.safeParse(patientResult.data)
  const components = z.array(Components).length(1).safeParse(componentResult.data)
  const messages = z.array(Sms).safeParse(smsResult.data)
  if (!patient.success || !components.success || !messages.success) {
    throw new Error("Patient details are invalid")
  }
  const score = components.data[0]

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-brand">Patient</p>
        <h1 className="mt-1 text-2xl font-semibold text-fg">{patient.data.full_name}</h1>
        <p className="mt-2 text-fg-muted"><PhoneDisplay phone={patient.data.phone_number} reveal /></p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-fg-muted">Consent</p><div className="mt-2"><ConsentBadge status={patient.data.consent_status} /></div></div>
        <div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-fg-muted">Campaigns offered</p><p className="mt-2 text-2xl font-semibold">{offeredResult.count ?? 0}</p></div>
        <div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-fg-muted">Slots claimed</p><p className="mt-2 text-2xl font-semibold">{claimedResult.count ?? 0}</p></div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-end justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-fg">Reliability score</h2><p className="mt-1 text-sm text-fg-muted">Transparent 100-point model</p></div>
          <p className="text-3xl font-semibold text-brand">{score.effective_score}</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Points label="Prior successful claims" points={score.prior_claims_points} maximum={40} detail={`${score.successful_claims} filled appointments × 10 points`} />
          <Points label="Time since last visit" points={score.recency_points} maximum={30} detail={`${score.days_since_last_visit} days since last visit`} />
          <Points label="Procedure fit" points={score.procedure_match_points} maximum={20} detail="Campaign-specific fit is applied during selection" />
          <Points label="Recent contact restraint" points={score.contact_restraint_points} maximum={10} detail={`${score.messages_last_7d} outbound messages in 7 days`} />
        </div>
        {score.override_score !== null ? <p className="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-fg">Staff override: {score.override_score}. {score.override_reason}</p> : null}
        <ReliabilityEditor patientId={patient.data.id} currentScore={score.effective_score} hasOverride={score.override_score !== null} />
      </section>

      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-fg">Recent messages</h2></div>
        {messages.data.length ? <div className="divide-y divide-border">{messages.data.map((message) => (
          <div key={message.id} className="px-5 py-3 text-sm"><p className="text-fg">{message.message_body ?? "Message body redacted"}</p><p className="mt-1 text-xs text-fg-muted">{message.direction} · {message.status} · {new Date(message.created_at).toLocaleString()}</p></div>
        ))}</div> : <p className="px-5 py-8 text-center text-sm text-fg-muted">No messages recorded.</p>}
      </section>
    </div>
  )
}
