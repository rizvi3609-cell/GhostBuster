"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { withStaffAuth } from "@/lib/auth"
import { sendManualReplyToN8n } from "@/lib/n8n/client"
import { db } from "@/lib/supabase/server"

const InboxMutationInput = z.object({ inboxId: z.string().uuid() }).strict()
const AssignInput = z
  .object({ inboxId: z.string().uuid(), staffId: z.string().uuid() })
  .strict()
const ThreadInput = z.object({ patientId: z.string().uuid() }).strict()
const ManualReplyInput = z
  .object({
    inboxId: z.string().uuid(),
    patientId: z.string().uuid(),
    requestId: z.string().uuid(),
    message: z.string().trim().min(1).max(480),
  })
  .strict()

const InboxRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid().nullable(),
  message_body: z.string(),
  status: z.enum(["UNREAD", "OPEN", "RESOLVED"]),
  assigned_to: z.string().uuid().nullable(),
  received_at: z.string(),
})
const PatientRow = z.object({ id: z.string().uuid(), full_name: z.string() })
const StaffRow = z.object({ id: z.string().uuid(), full_name: z.string().nullable(), email: z.string() })
const SmsRow = z.object({
  id: z.string().uuid(),
  direction: z.enum(["OUTBOUND", "INBOUND"]),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "UNDELIVERED", "FAILED", "RECEIVED"]),
  message_body: z.string().nullable(),
  error_code: z.string().nullable(),
  created_at: z.string(),
})

export type InboxConversation = Readonly<{
  assignedTo: string | null
  inboxId: string
  messagePreview: string
  patientId: string | null
  patientName: string
  receivedAt: string
  status: "UNREAD" | "OPEN"
}>

export type InboxThreadMessage = z.infer<typeof SmsRow>
export type InboxStaffOption = Readonly<{ id: string; label: string }>

type Failure = Readonly<{
  ok: false
  code: "INVALID_INPUT" | "DATABASE_ERROR" | "N8N_UNAVAILABLE" | "STATE_CONFLICT"
  error: string
}>

function fail(code: Failure["code"], error: string): Failure {
  return { ok: false, code, error }
}

export const getUnreadInboxCount = withStaffAuth(async () => {
  const { count, error } = await db
    .from("unhandled_inbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "UNREAD")
  if (error) return fail("DATABASE_ERROR", "Couldn't refresh the inbox count.")
  return { ok: true as const, data: { count: count ?? 0 } }
})

export const getInboxSnapshot = withStaffAuth(async () => {
  const [inboxResult, staffResult] = await Promise.all([
    db
      .from("unhandled_inbox")
      .select("id, patient_id, message_body, status, assigned_to, received_at")
      .in("status", ["UNREAD", "OPEN"])
      .order("received_at", { ascending: false })
      .limit(200),
    db
      .from("staff")
      .select("id, full_name, email")
      .eq("active", true)
      .order("full_name", { ascending: true }),
  ])
  if (inboxResult.error || staffResult.error) {
    return fail("DATABASE_ERROR", "Couldn't refresh inbox conversations.")
  }

  const inbox = z.array(InboxRow).safeParse(inboxResult.data)
  const staff = z.array(StaffRow).safeParse(staffResult.data)
  if (!inbox.success || !staff.success) return fail("DATABASE_ERROR", "Inbox data is invalid.")

  const patientIds = Array.from(
    new Set(inbox.data.flatMap((row) => (row.patient_id ? [row.patient_id] : []))),
  )
  const patientResult = patientIds.length
    ? await db.from("patients").select("id, full_name").in("id", patientIds)
    : { data: [], error: null }
  const patients = z.array(PatientRow).safeParse(patientResult.data)
  if (patientResult.error || !patients.success) {
    return fail("DATABASE_ERROR", "Couldn't load inbox patients.")
  }

  const names = new Map(patients.data.map((patient) => [patient.id, patient.full_name]))
  const conversations = new Map<string, InboxConversation>()
  for (const row of inbox.data) {
    const key = row.patient_id ?? `unknown:${row.id}`
    const existing = conversations.get(key)
    if (!existing) {
      conversations.set(key, {
        assignedTo: row.assigned_to,
        inboxId: row.id,
        messagePreview: row.message_body,
        patientId: row.patient_id,
        patientName: row.patient_id ? (names.get(row.patient_id) ?? "Unknown patient") : "Unknown sender",
        receivedAt: row.received_at,
        status: row.status === "UNREAD" ? "UNREAD" : "OPEN",
      })
    } else if (row.status === "UNREAD" && existing.status !== "UNREAD") {
      conversations.set(key, { ...existing, status: "UNREAD" })
    }
  }

  return {
    ok: true as const,
    data: {
      conversations: Array.from(conversations.values()),
      staff: staff.data.map((member) => ({
        id: member.id,
        label: member.full_name ?? member.email,
      })),
    },
  }
})

export const getInboxThread = withStaffAuth(async (_context, raw: unknown) => {
  const parsed = ThreadInput.safeParse(raw)
  if (!parsed.success) return fail("INVALID_INPUT", "Invalid patient conversation.")

  const { data, error } = await db
    .from("sms_logs")
    .select("id, direction, status, message_body, error_code, created_at")
    .eq("patient_id", parsed.data.patientId)
    .order("created_at", { ascending: true })
    .limit(200)
  if (error) return fail("DATABASE_ERROR", "Couldn't load the message thread.")

  const messages = z.array(SmsRow).safeParse(data)
  if (!messages.success) return fail("DATABASE_ERROR", "Message data is invalid.")
  return { ok: true as const, data: { messages: messages.data } }
})

export const assignInboxMessage = withStaffAuth(async (context, raw: unknown) => {
  const parsed = AssignInput.safeParse(raw)
  if (!parsed.success) return fail("INVALID_INPUT", "Choose a valid staff member.")

  const { data, error } = await db.rpc("assign_inbox_message", {
    p_inbox_id: parsed.data.inboxId,
    p_assigned_to: parsed.data.staffId,
    p_actor_id: context.staff.id,
  })
  if (error) return fail("DATABASE_ERROR", "Couldn't assign this conversation.")
  if (data !== true) return fail("STATE_CONFLICT", "This conversation is already resolved.")
  revalidatePath("/inbox")
  return { ok: true as const, data: { inboxId: parsed.data.inboxId } }
})

export const resolveInboxMessage = withStaffAuth(async (context, raw: unknown) => {
  const parsed = InboxMutationInput.safeParse(raw)
  if (!parsed.success) return fail("INVALID_INPUT", "Invalid conversation.")

  const { data, error } = await db.rpc("resolve_inbox_message", {
    p_inbox_id: parsed.data.inboxId,
    p_actor_id: context.staff.id,
  })
  if (error) return fail("DATABASE_ERROR", "Couldn't resolve this conversation.")
  if (data !== true) return fail("STATE_CONFLICT", "This conversation is already resolved.")
  revalidatePath("/inbox")
  return { ok: true as const, data: { inboxId: parsed.data.inboxId } }
})

export const sendManualInboxReply = withStaffAuth(async (context, raw: unknown) => {
  const parsed = ManualReplyInput.safeParse(raw)
  if (!parsed.success) return fail("INVALID_INPUT", "Enter a message under 480 characters.")

  const result = await sendManualReplyToN8n({
    inboxId: parsed.data.inboxId,
    patientId: parsed.data.patientId,
    requestId: parsed.data.requestId,
    staffId: context.staff.id,
    message: parsed.data.message,
  })
  if (!result.ok) return fail("N8N_UNAVAILABLE", "Couldn't send the reply. Try again.")
  revalidatePath("/inbox")
  return { ok: true as const, data: { requestId: parsed.data.requestId } }
})
